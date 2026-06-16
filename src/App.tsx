import { useState, useEffect, useRef, useCallback } from "react";
import {
  LESSONS, DURATIONS, buildFiveMinQueue, buildThreeMinQueue, shuffle,
  type Pair, type Lesson, type SessionMode, type FactStat,
} from "./curriculum";
import { checkStudent, logFact, logSession, fetchMistakes, fetchFactStats, updateFactProgress } from "./supabase";
import "./App.css";

// ─── Name gate helpers ────────────────────────────────────────────────────────

const NAME_KEY = "multianki_student";
function loadStudentName(): string | null { return localStorage.getItem(NAME_KEY); }
function saveStudentName(n: string) { localStorage.setItem(NAME_KEY, n); }
function clearStudentName() { localStorage.removeItem(NAME_KEY); }

// ─── Progress (local mistake cache) ───────────────────────────────────────────

interface Progress { mistakes: Pair[]; }
const STORAGE_KEY = "multianki_v2";
function loadProgress(): Progress {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); }
  catch { /* ignore */ }
  return { mistakes: [] };
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppPhase = "lobby" | "loading" | "practice" | "review" | "session-done";

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
  const [studentName, setStudentName] = useState<string | null>(loadStudentName);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [phase, setPhase] = useState<AppPhase>("lobby");
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [activeMode, setActiveMode] = useState<SessionMode>("5min");

  // Practice state
  const [queue, setQueue] = useState<Pair[]>([]);
  const [sessionMistakes, setSessionMistakes] = useState<Pair[]>([]);
  const [pracPhase, setPracPhase] = useState<"question" | "feedback">("question");
  const [pracInput, setPracInput] = useState("");
  const [pracFeedback, setPracFeedback] = useState<PracticeFeedback | null>(null);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Timer
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFinishingRef = useRef(false);

  // Stable refs for timer callbacks
  const sessionMistakesRef = useRef<Pair[]>([]);
  const activeLessonRef = useRef<Lesson | null>(null);
  const activeModeRef = useRef<SessionMode>("5min");
  const sessionCorrectRef = useRef(0);
  const sessionTotalRef = useRef(0);
  const studentNameRef = useRef<string | null>(null);
  const phaseRef = useRef<AppPhase>("lobby");

  useEffect(() => { sessionMistakesRef.current = sessionMistakes; }, [sessionMistakes]);
  useEffect(() => { activeLessonRef.current = activeLesson; }, [activeLesson]);
  useEffect(() => { activeModeRef.current = activeMode; }, [activeMode]);
  useEffect(() => { sessionCorrectRef.current = sessionCorrect; }, [sessionCorrect]);
  useEffect(() => { sessionTotalRef.current = sessionTotal; }, [sessionTotal]);
  useEffect(() => { studentNameRef.current = studentName; }, [studentName]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => { saveProgress(progress); }, [progress]);

  useEffect(() => {
    if ((phase === "practice" || phase === "review") && pracPhase === "question") {
      inputRef.current?.focus();
    }
  }, [phase, pracPhase, queue]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // ── End session ────────────────────────────────────────────────────────────

  const endSession = useCallback(() => {
    if (isFinishingRef.current) return;
    isFinishingRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const mistakes = sessionMistakesRef.current;
    const lesson = activeLessonRef.current;
    const mode = activeModeRef.current;
    const correct = sessionCorrectRef.current;
    const total = sessionTotalRef.current;
    const student = studentNameRef.current ?? "";
    const currentPhase = phaseRef.current;

    if (currentPhase === "practice") {
      setProgress((prev) => ({ mistakes: [...prev.mistakes, ...mistakes] }));
    } else {
      // review: remove cleared mistakes
      setProgress((prev) => ({
        mistakes: prev.mistakes.filter((p) =>
          mistakes.some((m) => m.a === p.a && m.b === p.b)
        ),
      }));
    }

    logSession({ student_name: student, session_type: currentPhase === "review" ? "review" : mode, lesson: lesson?.label ?? "Review", correct, total });

    setSessionResult({
      mode: currentPhase === "review" ? "review" : mode,
      lessonLabel: lesson?.label,
      correct,
      total,
      newMistakeCount: mistakes.length,
    });
    setPhase("session-done");
  }, []);

  // ── Start lesson ───────────────────────────────────────────────────────────

  const startLesson = async (lesson: Lesson, mode: SessionMode) => {
    isFinishingRef.current = false;
    setPhase("loading");

    let queue: Pair[];
    if (mode === "5min") {
      queue = buildFiveMinQueue(lesson);
    } else {
      const stats = await fetchFactStats(studentName ?? "", lesson.label) as FactStat[];
      queue = buildThreeMinQueue(lesson, stats);
    }

    setActiveLesson(lesson);
    setActiveMode(mode);
    setQueue(queue);
    setSessionMistakes([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);

    const duration = DURATIONS[mode];
    setSecondsLeft(duration);
    setPhase("practice");

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

  // ── Start review ───────────────────────────────────────────────────────────

  const startReview = () => {
    if (progress.mistakes.length === 0) return;
    isFinishingRef.current = false;
    const seen = new Set<string>();
    const deduped = progress.mistakes.filter((p) => {
      const key = `${p.a}x${p.b}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setQueue(shuffle(deduped));
    setSessionMistakes([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setSecondsLeft(null);
    setPhase("review");
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const pracSubmit = () => {
    const answer = parseInt(pracInput.trim(), 10);
    const pair = queue[0];
    const expected = pair.a * pair.b;
    const correct = answer === expected;

    if (!correct) setSessionMistakes((m) => [...m, pair]);
    setSessionCorrect((c) => c + (correct ? 1 : 0));
    setSessionTotal((t) => t + 1);

    logFact({ student_name: studentName ?? "", lesson: activeLessonRef.current?.label ?? "Review", a: pair.a, b: pair.b, answer_given: answer, correct });
    updateFactProgress(studentName ?? "", pair.a, pair.b, correct);
    setPracFeedback({ correct, answer: expected });
    setPracPhase("feedback");
  };

  // ── Skip ───────────────────────────────────────────────────────────────────

  const pracSkip = () => {
    const pair = queue[0];
    setSessionMistakes((m) => [...m, pair]);
    setSessionTotal((t) => t + 1);

    logFact({ student_name: studentName ?? "", lesson: activeLessonRef.current?.label ?? "Review", a: pair.a, b: pair.b, answer_given: null, correct: false });
    updateFactProgress(studentName ?? "", pair.a, pair.b, false);
    setPracFeedback({ correct: false, answer: pair.a * pair.b });
    setPracPhase("feedback");
  };

  // ── Next ───────────────────────────────────────────────────────────────────

  const pracNext = useCallback(() => {
    const pair = queue[0];
    const wasCorrect = pracFeedback?.correct ?? false;

    let newQueue: Pair[];
    if (phase === "review" && !wasCorrect) {
      newQueue = [...queue.slice(1), pair];
    } else {
      newQueue = queue.slice(1);
      // 5-min: reshuffle when all unique facts seen
      if (newQueue.length === 0 && phase === "practice" && activeModeRef.current === "5min") {
        newQueue = buildFiveMinQueue(activeLessonRef.current!);
      }
      // 3-min: extend queue (pre-built queue is large, but just in case)
      if (newQueue.length === 0 && phase === "practice" && activeModeRef.current === "3min") {
        endSession();
        return;
      }
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
    if (phase === "practice" && sessionMistakes.length > 0) {
      setProgress((prev) => ({ mistakes: [...prev.mistakes, ...sessionMistakes] }));
    }
    setSecondsLeft(null);
    isFinishingRef.current = false;
    setPhase("lobby");
  };

  // ── Sign in ────────────────────────────────────────────────────────────────

  const handleSignIn = async (name: string) => {
    saveStudentName(name);
    setStudentName(name);
    const mistakes = await fetchMistakes(name);
    setProgress({ mistakes });
  };

  const hasMistakes = progress.mistakes.length > 0;

  // ─── Auth gate ─────────────────────────────────────────────────────────────

  if (!studentName) {
    return <NameGate onSignIn={handleSignIn} />;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="shell">
      <header className="site-header">
        <span className="logo">MultiAnki</span>
        <button className="btn-signout" onClick={() => { clearStudentName(); setStudentName(null); setPhase("lobby"); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }}>
          {studentName} ✕
        </button>
      </header>

      {phase === "lobby" && (
        <LobbyView hasMistakes={hasMistakes} mistakeCount={progress.mistakes.length} onSelectLesson={startLesson} onReview={startReview} />
      )}

      {phase === "loading" && (
        <div className="card loading-card"><p className="loading-text">Getting ready…</p></div>
      )}

      {(phase === "practice" || phase === "review") && queue.length > 0 && (
        <PracticeView
          label={phase === "review" ? "Review" : (activeLesson?.label ?? "")}
          tag={phase === "review" ? `${queue.length} remaining` : (activeLesson?.tag ?? "")}
          mode={activeMode}
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
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const attempt = async () => {
    if (!input.trim()) return;
    setLoading(true); setError(false);
    const approved = await checkStudent(input);
    setLoading(false);
    if (approved) { onSignIn(input.trim()); }
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

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ hasMistakes, mistakeCount, onSelectLesson, onReview }: {
  hasMistakes: boolean;
  mistakeCount: number;
  onSelectLesson: (lesson: Lesson, mode: SessionMode) => void;
  onReview: () => void;
}) {
  return (
    <div className="lobby">
      <p className="lobby-heading">Choose a lesson</p>
      <div className="lesson-grid">
        {LESSONS.map((lesson) => (
          <div key={lesson.id} className="lesson-card">
            <div className="lesson-info">
              <span className="lesson-label">{lesson.label}</span>
              <span className="lesson-tag">{lesson.tag}</span>
            </div>
            <div className="lesson-btns">
              <button className="btn-lesson-mode" onClick={() => onSelectLesson(lesson, "5min")}>
                5 min
              </button>
              <button className="btn-lesson-mode" onClick={() => onSelectLesson(lesson, "3min")}>
                3 min
              </button>
            </div>
          </div>
        ))}
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
  label: string;
  tag: string;
  mode: SessionMode;
  secondsLeft: number | null;
  pair: Pair;
  input: string;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  pracPhase: "question" | "feedback";
  feedback: PracticeFeedback | null;
  onSubmit: () => void;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
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
  const isReview = result.mode === "review";
  const isThreeMin = result.mode === "3min";

  return (
    <div className="card done-card">
      <p className="done-headline">{isReview ? "Review done." : "Time's up."}</p>
      <p className="done-stat">{result.correct} / {result.total} correct</p>
      <p className="done-detail">
        {isReview
          ? result.newMistakeCount === 0
            ? "You got everything right."
            : `${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} still need work.`
          : isThreeMin
            ? result.newMistakeCount === 0
              ? "Great work — no new mistakes."
              : `${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} to keep working on.`
            : result.newMistakeCount === 0
              ? "Perfect — no mistakes."
              : `${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} to review in the 3-minute session.`}
      </p>
      <button className="btn-primary" onClick={onContinue}>Back to lessons</button>
    </div>
  );
}
