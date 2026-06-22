import { useState, useEffect, useRef, useCallback } from "react";
import {
  LESSONS, DURATIONS, buildInitialQueue, buildFiveMinQueue, buildThreeMinQueue, shuffle,
  type Pair, type Lesson, type SessionMode, type FactStat,
} from "./curriculum";
import { checkStudent, logFact, logSession, fetchMistakes, fetchFactStats, updateFactProgress, fetchInitialTestDone, markInitialTestDone } from "./supabase";
import "./App.css";

// ─── localStorage helpers ─────────────────────────────────────────────────────

const NAME_KEY     = "multianki_student";
const PRETEST_KEY  = "multianki_pretests";
const STORAGE_KEY  = "multianki_v2";

function loadStudentName(): string | null { return localStorage.getItem(NAME_KEY); }
function saveStudentName(n: string) { localStorage.setItem(NAME_KEY, n); }
function clearStudentName() { localStorage.removeItem(NAME_KEY); }

function loadPretests(): Set<string> {
  try { const r = localStorage.getItem(PRETEST_KEY); if (r) return new Set(JSON.parse(r)); } catch { /**/ }
  return new Set();
}
function savePretests(s: Set<string>) { localStorage.setItem(PRETEST_KEY, JSON.stringify([...s])); }


interface Progress { mistakes: Pair[]; }
function loadProgress(): Progress {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch { /**/ }
  return { mistakes: [] };
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
  lessonLabel?: string;
  correct: number;
  total: number;
  newMistakeCount: number;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [studentName, setStudentName]         = useState<string | null>(loadStudentName);
  const [progress, setProgress]               = useState<Progress>(loadProgress);
  const [completedPretests, setCompletedPretests] = useState<Set<string>>(loadPretests);
  const [initialDone, setInitialDone]         = useState<boolean>(false);
  const [phase, setPhase]                     = useState<AppPhase>("lobby");
  const [activeLesson, setActiveLesson]       = useState<Lesson | null>(null);
  const [activeMode, setActiveMode]           = useState<SessionMode>("5min");

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
  const sessionMistakesRef = useRef<Pair[]>([]);
  const activeLessonRef    = useRef<Lesson | null>(null);
  const activeModeRef      = useRef<SessionMode>("5min");
  const sessionCorrectRef  = useRef(0);
  const sessionTotalRef    = useRef(0);
  const studentNameRef     = useRef<string | null>(null);
  const phaseRef           = useRef<AppPhase>("lobby");

  useEffect(() => { sessionMistakesRef.current = sessionMistakes; },  [sessionMistakes]);
  useEffect(() => { activeLessonRef.current = activeLesson; },         [activeLesson]);
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

    const mistakes = sessionMistakesRef.current;
    const lesson   = activeLessonRef.current;
    const mode     = activeModeRef.current;
    const correct  = sessionCorrectRef.current;
    const total    = sessionTotalRef.current;
    const student  = studentNameRef.current ?? "";
    const curPhase = phaseRef.current;

    if (curPhase === "practice") {
      setProgress((prev) => ({ mistakes: [...prev.mistakes, ...mistakes] }));

      if (mode === "initial") {
        markInitialTestDone(student);
        setInitialDone(true);
      } else if (mode === "5min" && lesson) {
        setCompletedPretests((prev) => {
          const next = new Set(prev);
          next.add(lesson.id);
          savePretests(next);
          return next;
        });
      }
    } else {
      setProgress((prev) => ({
        mistakes: prev.mistakes.filter((p) =>
          mistakes.some((m) => m.a === p.a && m.b === p.b)
        ),
      }));
    }

    logSession({
      student_name: student,
      session_type: curPhase === "review" ? "review" : mode,
      lesson: lesson?.label ?? (mode === "initial" ? "Initial Test" : "Review"),
      correct,
      total,
    });

    setSessionResult({
      mode: curPhase === "review" ? "review" : mode,
      lessonLabel: lesson?.label,
      correct,
      total,
      newMistakeCount: mistakes.length,
    });
    setPhase("session-done");
  }, []);

  // ── Start session ──────────────────────────────────────────────────────────

  const startSession = async (lesson: Lesson | null, mode: SessionMode) => {
    isFinishingRef.current = false;
    setPhase("loading");

    let q: Pair[];
    if (mode === "initial") {
      q = buildInitialQueue();
    } else if (mode === "5min") {
      q = buildFiveMinQueue(lesson!);
    } else {
      const stats = await fetchFactStats(studentName ?? "", lesson!.label) as FactStat[];
      q = buildThreeMinQueue(lesson!, stats);
    }

    setActiveLesson(lesson);
    setActiveMode(mode);
    setQueue(q);
    setSessionMistakes([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    const timed = mode !== "3min";
    setSecondsLeft(timed ? DURATIONS[mode] : null);
    setPhase("practice");

    if (timerRef.current) clearInterval(timerRef.current);
    if (timed) {
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
    }
  };

  // ── Start review ───────────────────────────────────────────────────────────

  const startReview = () => {
    if (progress.mistakes.length === 0) return;
    isFinishingRef.current = false;
    // Mistakes are stored normalized (smaller×larger).
    // Expand to both directions so students see e.g. both 3×7 and 7×3.
    const expanded = progress.mistakes.flatMap((p) =>
      p.a === p.b ? [p] : [p, { a: p.b, b: p.a }]
    );
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
    const expected = pair.a * pair.b;
    const correct  = answer === expected;

    if (!correct) setSessionMistakes((m) => [...m, pair]);
    setSessionCorrect((c) => c + (correct ? 1 : 0));
    setSessionTotal((t) => t + 1);

    const elapsed = Math.round((Date.now() - questionStartRef.current) / 1000);
    const sessionMode = phaseRef.current === "review" ? "review" : activeModeRef.current;
    logFact({ student_name: studentName ?? "", lesson: activeLessonRef.current?.label ?? (activeModeRef.current === "initial" ? "Initial Test" : "Review"), session_mode: sessionMode, a: pair.a, b: pair.b, answer_given: answer, correct, time_seconds: correct ? elapsed : null });
    updateFactProgress(studentName ?? "", pair.a, pair.b, correct);
    setPracFeedback({ correct, answer: expected });
    setPracPhase("feedback");
  };

  const pracSkip = () => {
    const pair = queue[0];
    setSessionMistakes((m) => [...m, pair]);
    setSessionTotal((t) => t + 1);

    const sessionMode = phaseRef.current === "review" ? "review" : activeModeRef.current;
    logFact({ student_name: studentName ?? "", lesson: activeLessonRef.current?.label ?? (activeModeRef.current === "initial" ? "Initial Test" : "Review"), session_mode: sessionMode, a: pair.a, b: pair.b, answer_given: null, correct: false, time_seconds: null });
    updateFactProgress(studentName ?? "", pair.a, pair.b, false);
    setPracFeedback({ correct: false, answer: pair.a * pair.b });
    setPracPhase("feedback");
  };

  // ── Next ───────────────────────────────────────────────────────────────────

  const pracNext = useCallback(() => {
    const pair       = queue[0];
    const wasCorrect = pracFeedback?.correct ?? false;
    const mode       = activeModeRef.current;

    let newQueue: Pair[];

    if (phase === "review" && !wasCorrect) {
      // Review: re-queue wrong answers until correct
      newQueue = [...queue.slice(1), pair];
    } else {
      newQueue = queue.slice(1);
      // Learn: reshuffle and keep going — no timer, student exits via back button
      if (newQueue.length === 0 && phase === "practice" && mode === "3min") {
        newQueue = buildThreeMinQueue(activeLessonRef.current!, []);
      }
      // initial + 5-min: end when queue exhausted (all facts seen once)
    }

    if (newQueue.length === 0) {
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
      else if (pracPhase === "feedback") pracNext();
    }
  };

  // ── Back ───────────────────────────────────────────────────────────────────

  const handleBack = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (phase === "practice" && sessionMistakes.length > 0)
      setProgress((prev) => ({ mistakes: [...prev.mistakes, ...sessionMistakes] }));
    setSecondsLeft(null);
    isFinishingRef.current = false;
    setPhase(initialDone ? "lobby" : "initial-welcome");
  };

  // ── Sign in ────────────────────────────────────────────────────────────────

  const handleSignIn = async (name: string) => {
    saveStudentName(name);
    setStudentName(name);
    const [done, mistakes] = await Promise.all([
      fetchInitialTestDone(name),
      fetchMistakes(name),
    ]);
    setInitialDone(done);
    setProgress({ mistakes });
    setPhase(done ? "lobby" : "initial-welcome");
  };

  const hasMistakes = progress.mistakes.length > 0;

  // ─── Auth gate ─────────────────────────────────────────────────────────────

  if (!studentName) return <NameGate onSignIn={handleSignIn} />;

  // ─── Render ────────────────────────────────────────────────────────────────

  const signOut = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearStudentName();
    setStudentName(null);
    setInitialDone(false);
    setPhase("lobby");
    setProgress({ mistakes: [] });
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
          onStart={() => startSession(null, "initial")}
        />
      )}

      {phase === "lobby" && (
        <LobbyView
          hasMistakes={hasMistakes}
          mistakeCount={progress.mistakes.length}
          completedPretests={completedPretests}
          onSelectLesson={(lesson, mode) => startSession(lesson, mode)}
          onReview={startReview}
        />
      )}

      {phase === "loading" && (
        <div className="card loading-card"><p className="loading-text">Getting ready…</p></div>
      )}

      {(phase === "practice" || phase === "review") && queue.length > 0 && (
        <PracticeView
          label={phase === "review" ? "Review" : activeMode === "initial" ? "Initial Test" : (activeLesson?.label ?? "")}
          tag={phase === "review" ? `${queue.length} remaining` : activeMode === "initial" ? `${queue.length} remaining` : (activeLesson?.tag ?? "")}
          mode={phase === "review" ? "3min" : activeMode}
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

function InitialWelcomeView({ name, onStart }: { name: string; onStart: () => void }) {
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
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ hasMistakes, mistakeCount, completedPretests, onSelectLesson, onReview }: {
  hasMistakes: boolean;
  mistakeCount: number;
  completedPretests: Set<string>;
  onSelectLesson: (lesson: Lesson, mode: SessionMode) => void;
  onReview: () => void;
}) {
  return (
    <div className="lobby">
      <p className="lobby-heading">Choose a lesson</p>
      <div className="lesson-grid">
        {LESSONS.map((lesson) => {
          const pretestDone = completedPretests.has(lesson.id);
          return (
            <div key={lesson.id} className="lesson-card">
              <div className="lesson-info">
                <span className="lesson-label">{lesson.label}</span>
                <span className="lesson-tag">{lesson.tag}</span>
              </div>
              <div className="lesson-btns">
                {!pretestDone ? (
                  <>
                    <button className="btn-lesson-mode btn-pretest" onClick={() => onSelectLesson(lesson, "5min")}>Pre-test</button>
                    <button className="btn-lesson-mode btn-learn"   onClick={() => onSelectLesson(lesson, "3min")}>Learn</button>
                  </>
                ) : (
                  <>
                    <button className="btn-lesson-mode btn-learn" onClick={() => onSelectLesson(lesson, "3min")}>Learn</button>
                    <button className="btn-lesson-mode btn-quiz"  disabled title="Coming soon">Quiz</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className={`btn-review ${hasMistakes ? "" : "disabled"}`} onClick={onReview} disabled={!hasMistakes}>
        Review
        {hasMistakes && <span className="review-count">{mistakeCount}</span>}
      </button>
    </div>
  );
}

// ─── Practice ─────────────────────────────────────────────────────────────────

function PracticeView({ label, tag, mode, secondsLeft, pair, input, onInput, onKeyDown, pracPhase, feedback, onSubmit, onSkip, onNext, onBack, inputRef }: {
  label: string; tag: string; mode: SessionMode; secondsLeft: number | null;
  pair: Pair; input: string; onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  pracPhase: "question" | "feedback"; feedback: PracticeFeedback | null;
  onSubmit: () => void; onSkip: () => void; onNext: () => void; onBack: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="card">
      <div className="session-meta">
        <button className="btn-back" onClick={onBack} aria-label="Back">←</button>
        <span className="session-label">{label}</span>
        <span className="session-tag">{tag}</span>
        {secondsLeft !== null && (
          <span className={`session-timer ${mode === "3min" ? "focused" : ""}`}>
            {formatTime(secondsLeft)}
          </span>
        )}
      </div>

      {pracPhase === "question" ? (
        <>
          <p className="problem">{pair.a} &times; {pair.b} = ?</p>
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
          <>
            <p className="problem">{pair.a} &times; {pair.b} = {feedback.answer}</p>
            <p className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}>
              {feedback.correct ? "Correct." : `${pair.a} × ${pair.b} = ${feedback.answer}`}
            </p>
            <div className="actions">
              <button className="btn-primary" onClick={onNext}>Next</button>
            </div>
          </>
        )
      )}
    </div>
  );
}

// ─── Session done ─────────────────────────────────────────────────────────────

function SessionDoneView({ result, onContinue }: { result: SessionResult; onContinue: () => void }) {
  const isInitial = result.mode === "initial";
  const isReview  = result.mode === "review";
  const isLearn   = result.mode === "3min";

  const headline = isInitial
    ? `Amazing work — you answered ${result.total} facts!`
    : isReview
      ? `Nice job — you reviewed ${result.total} fact${result.total !== 1 ? "s" : ""}!`
      : isLearn
        ? `Great effort — ${result.total} fact${result.total !== 1 ? "s" : ""} practised!`
        : `Well done — you got through ${result.total} fact${result.total !== 1 ? "s" : ""}!`;

  const detail = isInitial
    ? `You got ${result.correct} right. Your lessons are ready below.`
    : isReview
      ? result.newMistakeCount === 0
        ? `You got every single one right. Keep it up!`
        : `You got ${result.correct} right. ${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} still need a little work.`
      : isLearn
        ? result.newMistakeCount === 0
          ? `You got ${result.correct} right — no new mistakes. Impressive!`
          : `You got ${result.correct} right. Keep practising the tricky ones.`
        : result.newMistakeCount === 0
          ? `You got ${result.correct} right — a perfect pre-test!`
          : `You got ${result.correct} right. Use Learn to work on the rest.`;

  return (
    <div className="card done-card">
      <p className="done-headline">{headline}</p>
      <p className="done-stat">{result.correct} / {result.total}</p>
      <p className="done-detail">{detail}</p>
      <button className="btn-primary" onClick={onContinue}>
        {isInitial ? "Go to lessons" : "Back to lessons"}
      </button>
    </div>
  );
}
