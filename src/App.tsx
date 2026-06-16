import { useState, useEffect, useRef, useCallback } from "react";
import { LESSONS, factsForLesson, shuffle, type Pair, type Lesson } from "./curriculum";
import { isApproved, normalizeName } from "./students";
import { SHEETS_ENDPOINT } from "./config";
import "./App.css";

// ─── Sheets ───────────────────────────────────────────────────────────────────

function postToSheets(payload: object) {
  if (!SHEETS_ENDPOINT) return;
  fetch(SHEETS_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch(() => { /* ignore */ });
}

// ─── Name gate helpers ────────────────────────────────────────────────────────

const NAME_KEY = "multianki_student";
function loadStudentName(): string | null { return localStorage.getItem(NAME_KEY); }
function saveStudentName(name: string) { localStorage.setItem(NAME_KEY, name); }
function clearStudentName() { localStorage.removeItem(NAME_KEY); }

// ─── Progress ─────────────────────────────────────────────────────────────────

interface Progress { mistakes: Pair[]; }
const STORAGE_KEY = "multianki_v2";

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Progress;
  } catch { /* ignore */ }
  return { mistakes: [] };
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// ─── Timer helpers ────────────────────────────────────────────────────────────

const LESSON_DURATION = 300; // 5 minutes in seconds

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppPhase = "lobby" | "practice" | "review" | "session-done";
type SessionMode = "lesson" | "review";

interface PracticeFeedback { correct: boolean; answer: number; }

interface SessionResult {
  mode: SessionMode;
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

  // Practice state
  const [queue, setQueue] = useState<Pair[]>([]);
  const [sessionMistakes, setSessionMistakes] = useState<Pair[]>([]);
  const [pracPhase, setPracPhase] = useState<"question" | "feedback">("question");
  const [pracInput, setPracInput] = useState("");
  const [pracFeedback, setPracFeedback] = useState<PracticeFeedback | null>(null);

  // Lesson timer
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFinishingRef = useRef(false);

  // Refs so timer callback can read latest state without stale closures
  const sessionMistakesRef = useRef<Pair[]>([]);
  const activeLessonRef = useRef<Lesson | null>(null);
  const sessionCorrectRef = useRef(0);
  const sessionTotalRef = useRef(0);
  const studentNameRef = useRef<string | null>(null);

  useEffect(() => { sessionMistakesRef.current = sessionMistakes; }, [sessionMistakes]);
  useEffect(() => { activeLessonRef.current = activeLesson; }, [activeLesson]);
  useEffect(() => { sessionCorrectRef.current = sessionCorrect; }, [sessionCorrect]);
  useEffect(() => { sessionTotalRef.current = sessionTotal; }, [sessionTotal]);
  useEffect(() => { studentNameRef.current = studentName; }, [studentName]);

  useEffect(() => { saveProgress(progress); }, [progress]);

  useEffect(() => {
    if ((phase === "practice" || phase === "review") && pracPhase === "question") {
      inputRef.current?.focus();
    }
  }, [phase, pracPhase, queue]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // ── Finish session (callable from timer or queue end) ──────────────────────

  const endSession = useCallback((mode: SessionMode) => {
    if (isFinishingRef.current) return;
    isFinishingRef.current = true;

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const mistakes = sessionMistakesRef.current;
    const lesson = activeLessonRef.current;
    const correct = sessionCorrectRef.current;
    const total = sessionTotalRef.current;
    const student = studentNameRef.current;

    if (mode === "lesson") {
      setProgress((prev) => ({ mistakes: [...prev.mistakes, ...mistakes] }));
      setSessionResult({ mode, lessonLabel: lesson?.label, correct, total, newMistakeCount: mistakes.length });
    } else {
      setProgress((prev) => ({
        mistakes: prev.mistakes.filter((p) =>
          mistakes.some((m) => m.a === p.a && m.b === p.b)
        ),
      }));
      setSessionResult({ mode, correct, total, newMistakeCount: mistakes.length });
    }

    // Post session summary
    postToSheets({
      type: "session-summary",
      student,
      session: mode,
      lesson: lesson?.label ?? "Review",
      correct,
      total,
      mistakes: mistakes.map((m) => `${m.a}×${m.b}`),
    });

    setPhase("session-done");
  }, []);

  // ── Start lesson ───────────────────────────────────────────────────────────

  const startLesson = (lesson: Lesson) => {
    isFinishingRef.current = false;
    setActiveLesson(lesson);
    setQueue(shuffle(factsForLesson(lesson)));
    setSessionMistakes([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setSecondsLeft(LESSON_DURATION);
    setPhase("practice");

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s === null || s <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          endSession("lesson");
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
    setSecondsLeft(null); // no timer for review
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

    // Log every individual fact attempt
    postToSheets({
      type: "fact",
      student: studentName,
      lesson: activeLesson?.label ?? "Review",
      fact: `${pair.a}×${pair.b}`,
      a: pair.a,
      b: pair.b,
      answer,
      correct,
    });

    setPracFeedback({ correct, answer: expected });
    setPracPhase("feedback");
  };

  // ── Skip ───────────────────────────────────────────────────────────────────

  const pracSkip = () => {
    const pair = queue[0];
    const expected = pair.a * pair.b;

    setSessionMistakes((m) => [...m, pair]);
    setSessionTotal((t) => t + 1);

    postToSheets({
      type: "fact",
      student: studentName,
      lesson: activeLesson?.label ?? "Review",
      fact: `${pair.a}×${pair.b}`,
      a: pair.a,
      b: pair.b,
      answer: null,
      correct: false,
    });

    setPracFeedback({ correct: false, answer: expected });
    setPracPhase("feedback");
  };

  // ── Next ───────────────────────────────────────────────────────────────────

  const pracNext = useCallback(() => {
    const pair = queue[0];
    const wasCorrect = pracFeedback?.correct ?? false;

    let newQueue: Pair[];
    if (phase === "review" && !wasCorrect) {
      // Re-queue wrong answers in review until correct
      newQueue = [...queue.slice(1), pair];
    } else {
      newQueue = queue.slice(1);
      // In lesson mode: reshuffle when all facts have been seen once
      if (newQueue.length === 0 && phase === "practice") {
        newQueue = shuffle(factsForLesson(activeLessonRef.current!));
      }
    }

    if (newQueue.length === 0) {
      // Review finished (all correct)
      endSession("review");
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

  // ── Back out of lesson ─────────────────────────────────────────────────────

  const handleBack = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (phase === "practice" && sessionMistakes.length > 0) {
      setProgress((prev) => ({ mistakes: [...prev.mistakes, ...sessionMistakes] }));
    }
    setSecondsLeft(null);
    isFinishingRef.current = false;
    setPhase("lobby");
  };

  const hasMistakes = progress.mistakes.length > 0;

  // ─── Auth ──────────────────────────────────────────────────────────────────

  if (!studentName) {
    return <NameGate onSignIn={(name) => { saveStudentName(name); setStudentName(name); }} />;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="shell">
      <header className="site-header">
        <span className="logo">MultiAnki</span>
        <button className="btn-signout" onClick={() => { clearStudentName(); setStudentName(null); setPhase("lobby"); }}>
          {studentName} ✕
        </button>
      </header>

      {phase === "lobby" && (
        <LobbyView
          hasMistakes={hasMistakes}
          mistakeCount={progress.mistakes.length}
          onSelectLesson={startLesson}
          onReview={startReview}
        />
      )}

      {(phase === "practice" || phase === "review") && queue.length > 0 && (
        <PracticeView
          label={phase === "review" ? "Review" : (activeLesson?.label ?? "")}
          tag={phase === "review" ? `${queue.length} remaining` : (activeLesson?.tag ?? "")}
          secondsLeft={secondsLeft}
          sessionCorrect={sessionCorrect}
          sessionTotal={sessionTotal}
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const attempt = () => {
    if (isApproved(input)) { setError(false); onSignIn(normalizeName(input)); }
    else { setError(true); setInput(""); inputRef.current?.focus(); }
  };

  return (
    <div className="shell">
      <header className="site-header"><span className="logo">MultiAnki</span></header>
      <div className="card gate-card">
        <p className="gate-heading">What's your name?</p>
        <input
          ref={inputRef}
          className="answer-input gate-input"
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) attempt(); }}
          placeholder="your name"
          autoComplete="off"
        />
        {error && <p className="gate-error">Name not recognised. Check with your teacher.</p>}
        <div className="actions">
          <button className="btn-primary" onClick={attempt} disabled={!input.trim()}>Continue</button>
        </div>
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ hasMistakes, mistakeCount, onSelectLesson, onReview }: {
  hasMistakes: boolean;
  mistakeCount: number;
  onSelectLesson: (lesson: Lesson) => void;
  onReview: () => void;
}) {
  return (
    <div className="lobby">
      <p className="lobby-heading">Choose a lesson</p>
      <div className="lesson-grid">
        {LESSONS.map((lesson) => (
          <button key={lesson.id} className="lesson-card" onClick={() => onSelectLesson(lesson)}>
            <span className="lesson-label">{lesson.label}</span>
            <span className="lesson-tag">{lesson.tag}</span>
          </button>
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

function PracticeView({ label, tag, secondsLeft, sessionCorrect, sessionTotal, pair, input, onInput, onKeyDown, pracPhase, feedback, onSubmit, onSkip, onNext, onBack, inputRef }: {
  label: string;
  tag: string;
  secondsLeft: number | null;
  sessionCorrect: number;
  sessionTotal: number;
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
        <button className="btn-back" onClick={onBack} aria-label="Back to lessons">←</button>
        <span className="session-label">{label}</span>
        <span className="session-tag">{tag}</span>
        {secondsLeft !== null && (
          <span className="session-timer">{formatTime(secondsLeft)}</span>
        )}
      </div>


      {pracPhase === "question" ? (
        <>
          <p className="problem">{pair.a} &times; {pair.b} = ?</p>
          <input
            ref={inputRef}
            className="answer-input"
            type="number"
            inputMode="numeric"
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="your answer"
          />
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
  return (
    <div className="card done-card">
      {result.mode === "lesson" ? (
        <>
          <p className="done-headline">Time's up.</p>
          <p className="done-stat">{result.correct} / {result.total} correct</p>
          <p className="done-detail">
            {result.newMistakeCount === 0
              ? "Perfect session!"
              : `${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} to review.`}
          </p>
        </>
      ) : (
        <>
          <p className="done-headline">Review done.</p>
          <p className="done-detail">
            {result.newMistakeCount === 0
              ? "You got everything right."
              : `Keep at it — ${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""} still need work.`}
          </p>
        </>
      )}
      <button className="btn-primary" onClick={onContinue}>Back to lessons</button>
    </div>
  );
}
