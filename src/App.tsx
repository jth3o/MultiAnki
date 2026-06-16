import { useState, useEffect, useRef, useCallback } from "react";
import { LESSONS, factsForLesson, shuffle, type Pair, type Lesson } from "./curriculum";
import "./App.css";

// ─── Persistence ──────────────────────────────────────────────────────────────

interface Progress {
  // Mistakes accumulated across all lessons — used by Review
  mistakes: Pair[];
}

const STORAGE_KEY = "multianki_v2";

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Progress;
  } catch { /* ignore */ }
  return { mistakes: [] };
}

function saveProgress(p: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppPhase = "lobby" | "practice" | "review" | "session-done";
type SessionMode = "lesson" | "review";

interface PracticeFeedback {
  correct: boolean;
  answer: number;
}

interface SessionResult {
  mode: SessionMode;
  lessonLabel?: string;
  newMistakeCount: number;
  clearedCount?: number;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [phase, setPhase] = useState<AppPhase>("lobby");
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);

  // Practice state
  const [queue, setQueue] = useState<Pair[]>([]);
  const [sessionMistakes, setSessionMistakes] = useState<Pair[]>([]);
  const [pracPhase, setPracPhase] = useState<"question" | "feedback">("question");
  const [pracInput, setPracInput] = useState("");
  const [pracFeedback, setPracFeedback] = useState<PracticeFeedback | null>(null);

  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveProgress(progress); }, [progress]);

  useEffect(() => {
    if ((phase === "practice" || phase === "review") && pracPhase === "question") {
      inputRef.current?.focus();
    }
  }, [phase, pracPhase, queue]);

  // ── Start a lesson ─────────────────────────────────────────────────────────

  const startLesson = (lesson: Lesson) => {
    setActiveLesson(lesson);
    setQueue(shuffle(factsForLesson(lesson)));
    setSessionMistakes([]);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setPhase("practice");
  };

  // ── Start review ───────────────────────────────────────────────────────────

  const startReview = () => {
    const mistakes = progress.mistakes;
    if (mistakes.length === 0) return;
    // Deduplicate mistakes before queueing
    const seen = new Set<string>();
    const deduped = mistakes.filter((p) => {
      const key = `${p.a}x${p.b}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setQueue(shuffle(deduped));
    setSessionMistakes([]);
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setPhase("review");
  };

  // ── Submit / skip ──────────────────────────────────────────────────────────

  const pracSubmit = () => {
    const answer = parseInt(pracInput.trim(), 10);
    const pair = queue[0];
    const expected = pair.a * pair.b;
    const correct = answer === expected;
    if (!correct) setSessionMistakes((m) => [...m, pair]);
    setPracFeedback({ correct, answer: expected });
    setPracPhase("feedback");
  };

  const pracSkip = () => {
    const pair = queue[0];
    const expected = pair.a * pair.b;
    setSessionMistakes((m) => [...m, pair]);
    setPracFeedback({ correct: false, answer: expected });
    setPracPhase("feedback");
  };

  // ── Advance queue ──────────────────────────────────────────────────────────

  const pracNext = useCallback(() => {
    const pair = queue[0];
    const wasCorrect = pracFeedback?.correct ?? false;

    // In review mode: re-queue wrong answers until correct
    const newQueue =
      phase === "review" && !wasCorrect
        ? [...queue.slice(1), pair]
        : queue.slice(1);

    if (newQueue.length === 0) {
      finishSession();
    } else {
      setQueue(newQueue);
      setPracPhase("question");
      setPracInput("");
      setPracFeedback(null);
    }
  }, [queue, pracFeedback, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Finish session ─────────────────────────────────────────────────────────

  const finishSession = useCallback(() => {
    if (phase === "practice") {
      // Merge new mistakes into stored mistakes
      setProgress((prev) => ({
        mistakes: [...prev.mistakes, ...sessionMistakes],
      }));
      setSessionResult({
        mode: "lesson",
        lessonLabel: activeLesson?.label,
        newMistakeCount: sessionMistakes.length,
      });
    } else {
      // Review done: clear the mistakes that were just reviewed
      setProgress((prev) => ({
        mistakes: prev.mistakes.filter((p) =>
          sessionMistakes.some((m) => m.a === p.a && m.b === p.b)
        ),
      }));
      setSessionResult({
        mode: "review",
        newMistakeCount: sessionMistakes.length,
        clearedCount: queue.length, // already 0, but we could track separately
      });
    }
    setPhase("session-done");
  }, [phase, sessionMistakes, activeLesson, queue]);

  const pracKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (pracPhase === "question" && pracInput.trim()) pracSubmit();
      else if (pracPhase === "feedback") pracNext();
    }
  };

  const hasMistakes = progress.mistakes.length > 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="shell">
      <header className="site-header">
        <span className="logo">MultiAnki</span>
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
          pair={queue[0]}
          input={pracInput}
          onInput={setPracInput}
          onKeyDown={pracKeyDown}
          pracPhase={pracPhase}
          feedback={pracFeedback}
          onSubmit={pracSubmit}
          onSkip={pracSkip}
          onNext={pracNext}
          onBack={() => setPhase("lobby")}
          inputRef={inputRef}
        />
      )}

      {phase === "session-done" && sessionResult && (
        <SessionDoneView
          result={sessionResult}
          onContinue={() => setPhase("lobby")}
        />
      )}
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({
  hasMistakes,
  mistakeCount,
  onSelectLesson,
  onReview,
}: {
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
          <button
            key={lesson.id}
            className="lesson-card"
            onClick={() => onSelectLesson(lesson)}
          >
            <span className="lesson-label">{lesson.label}</span>
            <span className="lesson-tag">{lesson.tag}</span>
          </button>
        ))}
      </div>

      <button
        className={`btn-review ${hasMistakes ? "" : "disabled"}`}
        onClick={onReview}
        disabled={!hasMistakes}
      >
        Review
        {hasMistakes && (
          <span className="review-count">{mistakeCount}</span>
        )}
      </button>
    </div>
  );
}

// ─── Practice ─────────────────────────────────────────────────────────────────

function PracticeView({
  label,
  tag,
  pair,
  input,
  onInput,
  onKeyDown,
  pracPhase,
  feedback,
  onSubmit,
  onSkip,
  onNext,
  onBack,
  inputRef,
}: {
  label: string;
  tag: string;
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
        <button className="btn-back" onClick={onBack} aria-label="Back to lessons">
          ←
        </button>
        <span className="session-label">{label}</span>
        <span className="session-tag">{tag}</span>
      </div>

      {pracPhase === "question" ? (
        <>
          <p className="problem">
            {pair.a} &times; {pair.b} = ?
          </p>
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
            <button
              className="btn-primary"
              onClick={onSubmit}
              disabled={!input.trim()}
            >
              Submit
            </button>
            <button className="btn-ghost" onClick={onSkip}>
              I don&apos;t know
            </button>
          </div>
        </>
      ) : (
        feedback && (
          <>
            <p className="problem">
              {pair.a} &times; {pair.b} = {feedback.answer}
            </p>
            <p className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}>
              {feedback.correct ? "Correct." : `${pair.a} × ${pair.b} = ${feedback.answer}`}
            </p>
            <div className="actions">
              <button className="btn-primary" onClick={onNext}>
                Next
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}

// ─── Session done ─────────────────────────────────────────────────────────────

function SessionDoneView({
  result,
  onContinue,
}: {
  result: SessionResult;
  onContinue: () => void;
}) {
  return (
    <div className="card done-card">
      {result.mode === "lesson" ? (
        <>
          <p className="done-headline">{result.lessonLabel} complete.</p>
          <p className="done-detail">
            {result.newMistakeCount === 0
              ? "You got everything right."
              : `You missed ${result.newMistakeCount} fact${result.newMistakeCount !== 1 ? "s" : ""}. Hit Review when you're ready to go over them.`}
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
      <button className="btn-primary" onClick={onContinue}>
        Back to lessons
      </button>
    </div>
  );
}
