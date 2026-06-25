import { useState, useEffect, useRef, useCallback } from "react";
import {
  DURATIONS, buildInitialQueue, buildDivisionQueue, buildThreeMinQueue, shuffle,
  type Pair, type SessionMode, type FactStat,
} from "./curriculum";
import { checkStudent, logFact, logSession, fetchMistakes, fetchFactStats, updateFactProgress, fetchInitialTestDone, markInitialTestDone, fetchSetting } from "./supabase";
import "./App.css";

// ─── localStorage helpers ─────────────────────────────────────────────────────

const NAME_KEY    = "multianki_student";
const STORAGE_KEY = "multianki_v3";

function loadStudentName(): string | null { return localStorage.getItem(NAME_KEY); }
function saveStudentName(n: string) { localStorage.setItem(NAME_KEY, n); }
function clearStudentName() { localStorage.removeItem(NAME_KEY); }

interface Progress { mistakes: Pair[]; divMistakes: Pair[]; }
function loadProgress(): Progress {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch { /**/ }
  return { mistakes: [], divMistakes: [] };
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /**/ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppPhase = "lobby" | "initial-welcome" | "loading" | "practice" | "review" | "session-done";

interface PracticeFeedback { correct: boolean; answer: number; }

interface SessionResult {
  mode: SessionMode | "review";
  correct: number;
  total: number;
  newMistakeCount: number;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [studentName, setStudentName]         = useState<string | null>(loadStudentName);
  const [progress, setProgress]               = useState<Progress>(loadProgress);
  const [initialDone, setInitialDone]         = useState<boolean>(false);
  const [practiceDurationSecs, setPracticeDurationSecs] = useState<number>(300);
  const [phase, setPhase]                     = useState<AppPhase>("lobby");
  const [activeMode, setActiveMode]           = useState<SessionMode>("practice");

  // Practice state
  const [queue, setQueue]                     = useState<Pair[]>([]);
  const [sessionMistakes, setSessionMistakes] = useState<Pair[]>([]);
  const [pracPhase, setPracPhase]             = useState<"question" | "feedback">("question");
  const [pracInput, setPracInput]             = useState("");
  const [pracFeedback, setPracFeedback]       = useState<PracticeFeedback | null>(null);
  const [sessionCorrect, setSessionCorrect]   = useState(0);
  const [sessionTotal, setSessionTotal]       = useState(0);
  const [secondsLeft, setSecondsLeft]         = useState<number | null>(null);
  const [sessionResult, setSessionResult]     = useState<SessionResult | null>(null);

  const inputRef        = useRef<HTMLInputElement>(null);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFinishingRef  = useRef(false);
  const questionStartRef = useRef<number>(Date.now());

  // Stable refs for timer/endSession callback
  const sessionMistakesRef  = useRef<Pair[]>([]);
  const activeModeRef       = useRef<SessionMode>("practice");
  const activeOpRef         = useRef<"mult" | "div">("mult");
  const sessionExpiredRef   = useRef(false);
  const sessionCorrectRef  = useRef(0);
  const sessionTotalRef    = useRef(0);
  const studentNameRef     = useRef<string | null>(null);
  const phaseRef           = useRef<AppPhase>("lobby");

  useEffect(() => { sessionMistakesRef.current = sessionMistakes; },  [sessionMistakes]);
  useEffect(() => { activeModeRef.current = activeMode; },             [activeMode]);
  useEffect(() => { sessionCorrectRef.current = sessionCorrect; },     [sessionCorrect]);
  useEffect(() => { sessionTotalRef.current = sessionTotal; },         [sessionTotal]);
  useEffect(() => { studentNameRef.current = studentName; },           [studentName]);
  useEffect(() => { phaseRef.current = phase; },                       [phase]);
  useEffect(() => { saveProgress(progress); },                         [progress]);

  useEffect(() => {
    if ((phase === "practice" || phase === "review") && pracPhase === "question") {
      inputRef.current?.focus();
      questionStartRef.current = Date.now();
    }
  }, [phase, pracPhase, queue]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // ── End session ────────────────────────────────────────────────────────────

  const endSession = useCallback(() => {
    if (isFinishingRef.current) return;
    isFinishingRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const mistakes  = sessionMistakesRef.current;
    const mode      = activeModeRef.current;
    const op        = activeOpRef.current;
    const correct   = sessionCorrectRef.current;
    const total     = sessionTotalRef.current;
    const student   = studentNameRef.current ?? "";
    const curPhase  = phaseRef.current;

    if (curPhase === "practice") {
      if (mode === "initial") {
        markInitialTestDone(student);
        setInitialDone(true);
        setProgress((prev) => ({ ...prev, mistakes: [...prev.mistakes, ...mistakes] }));
      } else if (op === "div") {
        setProgress((prev) => ({ ...prev, divMistakes: [...prev.divMistakes, ...mistakes] }));
      } else {
        setProgress((prev) => ({ ...prev, mistakes: [...prev.mistakes, ...mistakes] }));
      }
    } else {
      // review: retain only still-wrong pairs
      if (op === "div") {
        setProgress((prev) => ({
          ...prev,
          divMistakes: prev.divMistakes.filter((p) =>
            mistakes.some((m) => m.a === p.a && m.b === p.b)
          ),
        }));
      } else {
        setProgress((prev) => ({
          ...prev,
          mistakes: prev.mistakes.filter((p) =>
            mistakes.some((m) => m.a === p.a && m.b === p.b)
          ),
        }));
      }
    }

    logSession({
      student_name: student,
      session_type: curPhase === "review" ? "review" : mode,
      lesson: mode === "initial" ? "Initial Test" : curPhase === "review" ? `${op === "div" ? "Division" : "Multiplication"} Review` : op === "div" ? "Division" : "Multiplication",
      correct,
      total,
    });

    setSessionResult({
      mode: curPhase === "review" ? "review" : mode,
      correct,
      total,
      newMistakeCount: mistakes.length,
    });
    setPhase("session-done");
  }, []);

  // ── Start session ──────────────────────────────────────────────────────────

  const startSession = async (op: "mult" | "div", mode: SessionMode) => {
    isFinishingRef.current = false;
    setPhase("loading");

    let q: Pair[];
    if (mode === "initial") {
      q = buildInitialQueue();
    } else if (op === "div") {
      q = buildDivisionQueue();
    } else if (mode === "3min") {
      // weighted learn (legacy path — unused in simplified lobby but kept for initial)
      const stats = await fetchFactStats(studentName ?? "", "Practice") as FactStat[];
      const fakLesson = { id: "all", label: "Practice", multipliers: Array.from({length:12},(_,i)=>i+1), tag: "1–12" };
      q = buildThreeMinQueue(fakLesson, stats);
    } else {
      q = buildInitialQueue(); // "practice" mode: all 78 unique pairs
    }

    activeOpRef.current = op;
    sessionExpiredRef.current = false;
    setActiveMode(mode);
    setQueue(q);
    setSessionMistakes([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);

    if (timerRef.current) clearInterval(timerRef.current);

    if (mode === "initial") {
      // Hard timer: auto-ends at 10 min regardless of question boundary
      setSecondsLeft(DURATIONS["initial"]);
      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s === null || s <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            endSession();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else if (mode === "practice") {
      // Soft timer: marks expired, ends at next question boundary
      setSecondsLeft(practiceDurationSecs);
      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s === null || s <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            sessionExpiredRef.current = true;
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      setSecondsLeft(null);
    }

    setPhase("practice");
  };

  // ── Start review ───────────────────────────────────────────────────────────

  const startReview = (op: "mult" | "div") => {
    const pool = op === "div" ? progress.divMistakes : progress.mistakes;
    if (pool.length === 0) return;
    isFinishingRef.current = false;
    const expanded = pool.flatMap((p) =>
      p.a === p.b ? [p] : [p, { ...p, a: p.b, b: p.a }]
    );
    activeOpRef.current = op;
    setQueue(shuffle(expanded));
    setSessionMistakes([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setSecondsLeft(300); // 5 minutes
    setPhase("review");

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s === null || s <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          endSession();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  // ── Submit / skip ──────────────────────────────────────────────────────────

  const pracSubmit = () => {
    const answer   = parseInt(pracInput.trim(), 10);
    const pair     = queue[0];
    // Division pair: (a*b) ÷ b = a, so the expected answer is pair.a
    const expected = pair.op === "div" ? pair.a : pair.a * pair.b;
    const correct  = answer === expected;

    if (!correct) setSessionMistakes((m) => [...m, pair]);
    setSessionCorrect((c) => c + (correct ? 1 : 0));
    setSessionTotal((t) => t + 1);

    const elapsed = Math.round((Date.now() - questionStartRef.current) / 1000);
    const sessionMode = phaseRef.current === "review" ? "review" : activeModeRef.current;
    const lessonLabel = activeModeRef.current === "initial" ? "Initial Test" : activeOpRef.current === "div" ? "Division" : "Multiplication";
    logFact({ student_name: studentName ?? "", lesson: lessonLabel, session_mode: sessionMode, a: pair.a, b: pair.b, answer_given: answer, correct, time_seconds: correct ? elapsed : null });
    updateFactProgress(studentName ?? "", pair.a, pair.b, correct);
    setPracFeedback({ correct, answer: expected });
    setPracPhase("feedback");
  };

  const pracSkip = () => {
    const pair = queue[0];
    setSessionMistakes((m) => [...m, pair]);
    setSessionTotal((t) => t + 1);

    const sessionMode = phaseRef.current === "review" ? "review" : activeModeRef.current;
    const lessonLabel = activeModeRef.current === "initial" ? "Initial Test" : activeOpRef.current === "div" ? "Division" : "Multiplication";
    logFact({ student_name: studentName ?? "", lesson: lessonLabel, session_mode: sessionMode, a: pair.a, b: pair.b, answer_given: null, correct: false, time_seconds: null });
    updateFactProgress(studentName ?? "", pair.a, pair.b, false);
    setPracFeedback({ correct: false, answer: pair.op === "div" ? pair.a : pair.a * pair.b });
    setPracPhase("feedback");
  };

  // ── Next ───────────────────────────────────────────────────────────────────

  const pracNext = useCallback(() => {
    const pair       = queue[0];
    const wasCorrect = pracFeedback?.correct ?? false;

    let newQueue: Pair[];

    if (phase === "review" && !wasCorrect) {
      // Review: re-queue wrong answers until correct
      newQueue = [...queue.slice(1), pair];
    } else {
      newQueue = queue.slice(1);
    }

    if (newQueue.length === 0 || sessionExpiredRef.current) {
      endSession();
    } else {
      setQueue(newQueue);
      setPracPhase("question");
      setPracInput("");
      setPracFeedback(null);
    }
  }, [queue, pracFeedback, phase, endSession]);

  const pracKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (pracPhase === "question" && pracInput.trim()) pracSubmit();
      else if (pracPhase === "feedback" && pracFeedback && !pracFeedback.correct) pracNext();
    }
  };

  // ── Back ───────────────────────────────────────────────────────────────────

  const handleBack = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (phase === "practice" && sessionMistakes.length > 0) {
      if (activeOpRef.current === "div") {
        setProgress((prev) => ({ ...prev, divMistakes: [...prev.divMistakes, ...sessionMistakes] }));
      } else {
        setProgress((prev) => ({ ...prev, mistakes: [...prev.mistakes, ...sessionMistakes] }));
      }
    }
    setSecondsLeft(null);
    isFinishingRef.current = false;
    setPhase(initialDone ? "lobby" : "initial-welcome");
  };

  // ── Sign in ────────────────────────────────────────────────────────────────

  const handleSignIn = async (name: string) => {
    saveStudentName(name);
    setStudentName(name);
    const [done, mistakes, durationStr] = await Promise.all([
      fetchInitialTestDone(name),
      fetchMistakes(name),
      fetchSetting("practice_duration_secs", "300"),
    ]);
    setInitialDone(done);
    setProgress({ mistakes, divMistakes: [] });
    setPracticeDurationSecs(parseInt(durationStr, 10) || 300);
    setPhase(done ? "lobby" : "initial-welcome");
  };

  // ─── Auth gate ─────────────────────────────────────────────────────────────

  if (!studentName) return <NameGate onSignIn={handleSignIn} />;

  // ─── Render ────────────────────────────────────────────────────────────────

  const signOut = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearStudentName();
    setStudentName(null);
    setInitialDone(false);
    setPhase("lobby");
    setProgress({ mistakes: [], divMistakes: [] });
  };

  return (
    <div className="shell">
      <header className="site-header">
        <span className="logo">MultiAnki</span>
        <button className="btn-signout" onClick={signOut}>{studentName} ✕</button>
      </header>

      {phase === "initial-welcome" && (
        <InitialWelcomeView
          name={studentName}
          onStart={() => startSession("mult", "initial")}
          onSkip={() => setPhase("lobby")}
        />
      )}

      {phase === "lobby" && (
        <LobbyView
          multMistakeCount={progress.mistakes.length}
          divMistakeCount={progress.divMistakes.length}
          initialDone={initialDone}
          onPractice={(op) => startSession(op, "practice")}
          onReview={startReview}
          onInitialTest={() => setPhase("initial-welcome")}
        />
      )}

      {phase === "loading" && (
        <div className="card loading-card"><p className="loading-text">Getting ready…</p></div>
      )}

      {(phase === "practice" || phase === "review") && queue.length > 0 && (
        <PracticeView
          label={phase === "review"
            ? (activeOpRef.current === "div" ? "Division Review" : "Multiplication Review")
            : activeMode === "initial"
              ? "Initial Test"
              : activeOpRef.current === "div" ? "Division" : "Multiplication"}
          tag=""
          secondsLeft={secondsLeft}
          pair={queue[0]}
          input={pracInput}
          onInput={setPracInput}
          onKeyDown={pracKeyDown}
          pracPhase={pracPhase}
          feedback={pracFeedback}
          onSubmit={pracSubmit}
          onSkip={pracSkip}
          onNext={pracNext}
          onBack={handleBack}
          inputRef={inputRef}
        />
      )}

      {phase === "session-done" && sessionResult && (
        <SessionDoneView result={sessionResult} onContinue={() => setPhase("lobby")} />
      )}
    </div>
  );
}

// ─── Name gate ────────────────────────────────────────────────────────────────

function NameGate({ onSignIn }: { onSignIn: (name: string) => void }) {
  const [input, setInput]   = useState("");
  const [error, setError]   = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const attempt = async () => {
    if (!input.trim()) return;
    setLoading(true); setError(false);
    const approved = await checkStudent(input);
    setLoading(false);
    if (approved) onSignIn(input.trim());
    else { setError(true); setInput(""); inputRef.current?.focus(); }
  };

  return (
    <div className="shell">
      <header className="site-header"><span className="logo">MultiAnki</span></header>
      <div className="card gate-card">
        <p className="gate-heading">What's your name?</p>
        <input ref={inputRef} className="answer-input gate-input" type="text" value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) attempt(); }}
          placeholder="your name" autoComplete="off" disabled={loading} />
        {error && <p className="gate-error">Name not recognised. Check with your teacher.</p>}
        <div className="actions">
          <button className="btn-primary" onClick={attempt} disabled={!input.trim() || loading}>
            {loading ? "Checking…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Initial welcome ──────────────────────────────────────────────────────────

function InitialWelcomeView({ name, onStart, onSkip }: { name: string; onStart: () => void; onSkip: () => void }) {
  return (
    <div className="card gate-card">
      <p className="gate-heading">Welcome, {name}!</p>
      <p className="gate-desc">
        Before you start, we want to see what you already know.
        You'll have 10 minutes to work through as many facts as you can.
        There's no pressure — just do your best.
      </p>
      <div className="actions">
        <button className="btn-primary" onClick={onStart}>Start</button>
        <button className="btn-ghost" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ multMistakeCount, divMistakeCount, initialDone, onPractice, onReview, onInitialTest }: {
  multMistakeCount: number;
  divMistakeCount: number;
  initialDone: boolean;
  onPractice: (op: "mult" | "div") => void;
  onReview: (op: "mult" | "div") => void;
  onInitialTest: () => void;
}) {
  return (
    <div className="lobby">
      {!initialDone && (
        <button className="btn-initial-test" onClick={onInitialTest}>
          Take the initial test
        </button>
      )}

      <div className="op-section">
        <p className="lobby-heading">Multiplication</p>
        <div className="op-btns">
          <button className="btn-op btn-practice" onClick={() => onPractice("mult")}>Practice</button>
          <button
            className={`btn-op btn-review-op ${multMistakeCount === 0 ? "disabled" : ""}`}
            onClick={() => onReview("mult")}
            disabled={multMistakeCount === 0}
          >
            Review
            {multMistakeCount > 0 && <span className="review-count">{multMistakeCount}</span>}
          </button>
        </div>
      </div>

      <div className="op-section">
        <p className="lobby-heading">Division</p>
        <div className="op-btns">
          <button className="btn-op btn-practice" onClick={() => onPractice("div")}>Practice</button>
          <button
            className={`btn-op btn-review-op ${divMistakeCount === 0 ? "disabled" : ""}`}
            onClick={() => onReview("div")}
            disabled={divMistakeCount === 0}
          >
            Review
            {divMistakeCount > 0 && <span className="review-count">{divMistakeCount}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-advance on correct ──────────────────────────────────────────────────

function AutoAdvance({ correct, onNext, children }: {
  correct: boolean;
  onNext: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!correct) return;
    const t = setTimeout(onNext, 800);
    return () => clearTimeout(t);
  }, [correct, onNext]);
  return <>{children}</>;
}

// ─── Practice ─────────────────────────────────────────────────────────────────

function PracticeView({ label, tag, secondsLeft, pair, input, onInput, onKeyDown, pracPhase, feedback, onSubmit, onSkip, onNext, onBack, inputRef }: {
  label: string; tag: string; secondsLeft: number | null;
  pair: Pair; input: string; onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  pracPhase: "question" | "feedback"; feedback: PracticeFeedback | null;
  onSubmit: () => void; onSkip: () => void; onNext: () => void; onBack: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const isDiv = pair.op === "div";
  const question = isDiv
    ? <>{pair.a * pair.b} &divide; {pair.b} = ?</>
    : <>{pair.a} &times; {pair.b} = ?</>;
  const fullFact = isDiv
    ? `${pair.a * pair.b} ÷ ${pair.b} = ${pair.a}`
    : `${pair.a} × ${pair.b} = ${pair.a * pair.b}`;

  return (
    <div className="card">
      <div className="session-meta">
        <button className="btn-back" onClick={onBack} aria-label="Back">←</button>
        <span className="session-label">{label}</span>
        <span className="session-tag">{tag}</span>
        {secondsLeft !== null && (
          <span className="session-timer">{formatTime(secondsLeft)}</span>
        )}
      </div>

      {pracPhase === "question" ? (
        <>
          <p className="problem">{question}</p>
          <input ref={inputRef} className="answer-input" type="number" inputMode="numeric"
            value={input} onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown}
            placeholder="your answer" />
          <div className="actions">
            <button className="btn-primary" onClick={onSubmit} disabled={!input.trim()}>Submit</button>
            <button className="btn-ghost" onClick={onSkip}>I don&apos;t know</button>
          </div>
        </>
      ) : (
        feedback && (
          <AutoAdvance correct={feedback.correct} onNext={onNext}>
            <p className="problem">{isDiv ? <>{pair.a * pair.b} &divide; {pair.b} = {feedback.answer}</> : <>{pair.a} &times; {pair.b} = {feedback.answer}</>}</p>
            <p className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}>
              {feedback.correct ? "Correct." : fullFact}
            </p>
            {!feedback.correct && (
              <div className="actions">
                <button className="btn-primary" onClick={onNext}>Next</button>
              </div>
            )}
          </AutoAdvance>
        )
      )}
    </div>
  );
}

// ─── Session done ─────────────────────────────────────────────────────────────

function SessionDoneView({ result, onContinue }: { result: SessionResult; onContinue: () => void }) {
  const isInitial = result.mode === "initial";
  const isReview  = result.mode === "review";

  const headline = isInitial
    ? `Amazing work — you answered ${result.total} facts!`
    : isReview
      ? `Nice job — you reviewed ${result.total} fact${result.total !== 1 ? "s" : ""}!`
      : `Well done — you got through ${result.total} fact${result.total !== 1 ? "s" : ""}!`;

  const detail = isInitial
    ? `You got ${result.correct} right. Practice is ready below.`
    : result.newMistakeCount === 0
      ? `You got every single one right. Keep it up!`
      : `You got ${result.correct} right. ${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} still need a little work.`;

  return (
    <div className="card done-card">
      <p className="done-headline">{headline}</p>
      <p className="done-stat">{result.correct} / {result.total}</p>
      <p className="done-detail">{detail}</p>
      <button className="btn-primary" onClick={onContinue}>
        {isInitial ? "Go to practice" : "Back"}
      </button>
    </div>
  );
}
