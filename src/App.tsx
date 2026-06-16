import { useState, useEffect, useRef, useCallback } from "react";
import { CURRICULUM, factsForGroup, shuffle, type Pair, type Stage } from "./curriculum";
import "./App.css";

// ─── Persistence ─────────────────────────────────────────────────────────────

interface Progress {
  stageIndex: number;
  morningMistakes: Pair[];         // saved after each morning, used by afternoon
  completedStages: boolean[];
}

const STORAGE_KEY = "multianki_progress";

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Progress;
  } catch { /* ignore */ }
  return {
    stageIndex: 0,
    morningMistakes: [],
    completedStages: new Array(CURRICULUM.length).fill(false),
  };
}

function saveProgress(p: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

// ─── App ─────────────────────────────────────────────────────────────────────

type AppPhase = "lobby" | "timed" | "practice" | "session-done";

interface PracticeFeedback {
  correct: boolean;
  skipped: boolean;
  answer: number;
}

interface TimedFeedback {
  correct: boolean;
  answer: number;
}

interface SessionResult {
  type: Stage["type"];
  correct: number;
  total: number;
  mistakeCount: number;
}

export default function App() {
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [phase, setPhase] = useState<AppPhase>("lobby");

  // Practice session
  const [queue, setQueue] = useState<Pair[]>([]);
  const [sessionMistakes, setSessionMistakes] = useState<Pair[]>([]);
  const [pracPhase, setPracPhase] = useState<"question" | "feedback">("question");
  const [pracInput, setPracInput] = useState("");
  const [pracFeedback, setPracFeedback] = useState<PracticeFeedback | null>(null);

  // Timed session
  const [timedPairs, setTimedPairs] = useState<Pair[]>([]);
  const [timedIndex, setTimedIndex] = useState(0);
  const [timedInput, setTimedInput] = useState("");
  const [timedCorrect, setTimedCorrect] = useState(0);
  const [timedTotal, setTimedTotal] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(100);
  const [timedFeedback, setTimedFeedback] = useState<TimedFeedback | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session done
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const currentStage = CURRICULUM[progress.stageIndex];

  // Persist progress
  useEffect(() => { saveProgress(progress); }, [progress]);

  // Focus input
  useEffect(() => {
    if (phase === "practice" && pracPhase === "question") inputRef.current?.focus();
    if (phase === "timed" && !timedFeedback) inputRef.current?.focus();
  }, [phase, pracPhase, queue, timedIndex, timedFeedback]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
  }, []);

  // ── Begin session ──────────────────────────────────────────────────────────

  const beginSession = () => {
    const stage = currentStage;

    if (stage.type === "timed") {
      // Build a large shuffled pool (3× all facts = 432 pairs, plenty for 100s)
      const all = factsForGroup(null);
      const pool = shuffle([...all, ...all, ...all]);
      setTimedPairs(pool);
      setTimedIndex(0);
      setTimedInput("");
      setTimedCorrect(0);
      setTimedTotal(0);
      setSecondsLeft(100);
      setTimedFeedback(null);
      setPhase("timed");

      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            // Read current timed state via functional update to get latest values
            setTimedCorrect((c) => { setTimedTotal((t) => {
              setSessionResult({ type: "timed", correct: c, total: t, mistakeCount: 0 });
              return t;
            }); return c; });
            setPhase("session-done");
            return 0;
          }
          return s - 1;
        });
      }, 1000);

    } else if (stage.type === "morning") {
      const pairs = shuffle(factsForGroup(stage.groupIndex));
      setQueue(pairs);
      setSessionMistakes([]);
      setPracPhase("question");
      setPracInput("");
      setPracFeedback(null);
      setPhase("practice");

    } else if (stage.type === "afternoon") {
      const mistakes = progress.morningMistakes;
      if (mistakes.length === 0) {
        // Nothing to review — complete the stage immediately
        completeStage("afternoon", 0, 0, []);
        return;
      }
      setQueue(shuffle([...mistakes]));
      setSessionMistakes([]);
      setPracPhase("question");
      setPracInput("");
      setPracFeedback(null);
      setPhase("practice");
    }
  };

  // ── Advance curriculum ─────────────────────────────────────────────────────

  const completeStage = useCallback(
    (type: Stage["type"], correct: number, total: number, mistakes: Pair[]) => {
      setProgress((prev) => {
        const nextIndex = Math.min(prev.stageIndex + 1, CURRICULUM.length - 1);
        const completedStages = [...prev.completedStages];
        completedStages[prev.stageIndex] = true;
        return {
          stageIndex: nextIndex,
          morningMistakes: type === "morning" ? mistakes : prev.morningMistakes,
          completedStages,
        };
      });
      if (type !== "afternoon" || total > 0) {
        setSessionResult({ type, correct, total, mistakeCount: mistakes.length });
        setPhase("session-done");
      } else {
        setPhase("lobby");
      }
    },
    []
  );

  // ── Practice handlers ──────────────────────────────────────────────────────

  const pracSubmit = () => {
    const answer = parseInt(pracInput.trim(), 10);
    const pair = queue[0];
    const expected = pair.a * pair.b;
    const correct = answer === expected;

    const newMistakes = correct ? sessionMistakes : [...sessionMistakes, pair];
    setSessionMistakes(newMistakes);
    setPracFeedback({ correct, skipped: false, answer: expected });
    setPracPhase("feedback");
  };

  const pracSkip = () => {
    const pair = queue[0];
    const expected = pair.a * pair.b;
    const newMistakes = [...sessionMistakes, pair];
    setSessionMistakes(newMistakes);
    setPracFeedback({ correct: false, skipped: true, answer: expected });
    setPracPhase("feedback");
  };

  const pracNext = useCallback(() => {
    const stage = currentStage;
    const pair = queue[0];
    const wasCorrect = pracFeedback?.correct ?? false;

    let newQueue: Pair[];
    if (stage.type === "afternoon" && !wasCorrect) {
      // Re-queue at the back so they keep practicing until correct
      newQueue = [...queue.slice(1), pair];
    } else {
      newQueue = queue.slice(1);
    }

    if (newQueue.length === 0) {
      completeStage(stage.type, 0, 0, sessionMistakes);
    } else {
      setQueue(newQueue);
      setPracPhase("question");
      setPracInput("");
      setPracFeedback(null);
    }
  }, [queue, pracFeedback, sessionMistakes, currentStage, completeStage]);

  const pracKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (pracPhase === "question" && pracInput.trim()) pracSubmit();
      else if (pracPhase === "feedback") pracNext();
    }
  };

  // ── Timed handlers ─────────────────────────────────────────────────────────

  const timedSubmit = () => {
    if (!timedInput.trim()) return;
    const pair = timedPairs[timedIndex];
    const expected = pair.a * pair.b;
    const answer = parseInt(timedInput.trim(), 10);
    const correct = answer === expected;

    setTimedCorrect((c) => c + (correct ? 1 : 0));
    setTimedTotal((t) => t + 1);
    setTimedFeedback({ correct, answer: expected });
    setTimedInput("");

    feedbackTimeoutRef.current = setTimeout(() => {
      setTimedFeedback(null);
      setTimedIndex((i) => i + 1);
    }, 700);
  };

  const timedKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && timedInput.trim() && !timedFeedback) timedSubmit();
  };

  const continueToLobby = () => {
    // Mark done stage as complete (already handled in completeStage for practice;
    // for timed we handle it here)
    if (currentStage.type === "timed") {
      setProgress((prev) => {
        const nextIndex = Math.min(prev.stageIndex + 1, CURRICULUM.length - 1);
        const completedStages = [...prev.completedStages];
        completedStages[prev.stageIndex] = true;
        return { ...prev, stageIndex: nextIndex, completedStages };
      });
    }
    setPhase("lobby");
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="shell">
      <header className="site-header">
        <span className="logo">MultiAnki</span>
        <span className="stage-badge">
          {progress.stageIndex + 1} / {CURRICULUM.length}
        </span>
      </header>

      {phase === "lobby" && (
        <LobbyView
          stage={currentStage}
          onBegin={beginSession}
        />
      )}

      {phase === "timed" && (
        <TimedView
          pair={timedPairs[timedIndex] ?? { a: 0, b: 0 }}
          input={timedInput}
          onInput={setTimedInput}
          onKeyDown={timedKeyDown}
          feedback={timedFeedback}
          secondsLeft={secondsLeft}
          correct={timedCorrect}
          total={timedTotal}
          inputRef={inputRef}
        />
      )}

      {phase === "practice" && queue.length > 0 && (
        <PracticeView
          stage={currentStage}
          pair={queue[0]}
          queueLength={queue.length}
          input={pracInput}
          onInput={setPracInput}
          onKeyDown={pracKeyDown}
          pracPhase={pracPhase}
          feedback={pracFeedback}
          onSubmit={pracSubmit}
          onSkip={pracSkip}
          onNext={pracNext}
          inputRef={inputRef}
        />
      )}

      {phase === "session-done" && sessionResult && (
        <SessionDoneView result={sessionResult} onContinue={continueToLobby} />
      )}
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function LobbyView({
  stage,
  onBegin,
}: {
  stage: Stage;
  onBegin: () => void;
}) {
  const icon: Record<Stage["type"], string> = {
    timed: "⏱",
    morning: "🌅",
    afternoon: "🌤",
  };

  return (
    <div className="lobby">
      <div className="lobby-cta">
        <p className="stage-type-label">
          {icon[stage.type]}{" "}
          {stage.type === "morning"
            ? "Morning session"
            : stage.type === "afternoon"
            ? "Afternoon review"
            : "Timed challenge"}
        </p>
        <h2 className="stage-title">{stage.label}</h2>
        <p className="stage-desc">{stage.description}</p>
        <button className="btn-primary" onClick={onBegin}>
          Begin
        </button>
      </div>
    </div>
  );
}

function PracticeView({
  stage,
  pair,
  queueLength,
  input,
  onInput,
  onKeyDown,
  pracPhase,
  feedback,
  onSubmit,
  onSkip,
  onNext,
  inputRef,
}: {
  stage: Stage;
  pair: Pair;
  queueLength: number;
  input: string;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  pracPhase: "question" | "feedback";
  feedback: PracticeFeedback | null;
  onSubmit: () => void;
  onSkip: () => void;
  onNext: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="card">
      <p className="session-meta">
        {stage.type === "afternoon" ? "Reviewing mistakes" : stage.label}
        {stage.type === "afternoon" && (
          <span className="queue-count"> · {queueLength} remaining</span>
        )}
      </p>

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
            <p
              className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}
            >
              {feedback.skipped
                ? `The answer is ${feedback.answer}.${stage.type === "afternoon" ? " Try again in a moment." : " You'll see this again this afternoon."}`
                : feedback.correct
                ? "Correct."
                : `Not quite — ${feedback.answer}.${stage.type === "afternoon" ? " Try again in a moment." : " You'll see this again this afternoon."}`}
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

function TimedView({
  pair,
  input,
  onInput,
  onKeyDown,
  feedback,
  secondsLeft,
  correct,
  total,
  inputRef,
}: {
  pair: Pair;
  input: string;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  feedback: TimedFeedback | null;
  secondsLeft: number;
  correct: number;
  total: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const urgent = secondsLeft <= 10;
  return (
    <div className="card timed-card">
      <div className={`timer ${urgent ? "urgent" : ""}`}>{secondsLeft}s</div>
      <p className="timed-score">
        {correct} / {total}
      </p>
      <p className="problem">
        {pair.a} &times; {pair.b} = ?
      </p>
      {feedback ? (
        <p className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}>
          {feedback.correct ? "Correct." : `${feedback.answer}`}
        </p>
      ) : (
        <input
          ref={inputRef}
          className="answer-input"
          type="number"
          inputMode="numeric"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="answer + Enter"
          autoFocus
        />
      )}
    </div>
  );
}

function SessionDoneView({
  result,
  onContinue,
}: {
  result: SessionResult;
  onContinue: () => void;
}) {
  const summary = (() => {
    if (result.type === "timed") {
      return (
        <>
          <p className="done-headline">Done.</p>
          <p className="done-detail">
            You answered <strong>{result.correct}</strong> correctly in 100 seconds.
          </p>
          <p className="done-sub">
            This is your baseline. You&apos;ll see this improve.
          </p>
        </>
      );
    }
    if (result.type === "morning") {
      const missed = result.mistakeCount;
      return (
        <>
          <p className="done-headline">Morning session complete.</p>
          <p className="done-detail">
            {missed === 0
              ? "You got everything right."
              : `You missed ${missed} fact${missed !== 1 ? "s" : ""}. Come back this afternoon to review them.`}
          </p>
        </>
      );
    }
    // afternoon
    return (
      <>
        <p className="done-headline">All cleared.</p>
        <p className="done-detail">You worked through all of your mistakes.</p>
      </>
    );
  })();

  return (
    <div className="card done-card">
      {summary}
      <button className="btn-primary" onClick={onContinue}>
        Continue
      </button>
    </div>
  );
}
