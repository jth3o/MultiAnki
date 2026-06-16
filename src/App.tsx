import { useState, useEffect, useRef, useCallback } from "react";
import { type Fact, loadFacts, saveFacts, pickFact } from "./facts";
import "./App.css";

type Phase = "question" | "feedback";

interface FeedbackState {
  correct: boolean;
  skipped: boolean;
  answer: number;
}

export default function App() {
  const [facts, setFacts] = useState<Fact[]>(() => loadFacts());
  const [current, setCurrent] = useState<Fact>(() => pickFact(loadFacts()));
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("question");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveFacts(facts);
  }, [facts]);

  useEffect(() => {
    if (phase === "question") {
      inputRef.current?.focus();
    }
  }, [phase, current]);

  const recordResult = useCallback((fact: Fact, correct: boolean) => {
    setFacts((prev) =>
      prev.map((f) =>
        f.a === fact.a && f.b === fact.b
          ? {
              ...f,
              timesSeen: f.timesSeen + 1,
              timesCorrect: f.timesCorrect + (correct ? 1 : 0),
            }
          : f
      )
    );
  }, []);

  const submit = () => {
    const answer = parseInt(input.trim(), 10);
    const expected = current.a * current.b;
    const correct = answer === expected;
    recordResult(current, correct);
    setFeedback({ correct, skipped: false, answer: expected });
    setPhase("feedback");
  };

  const skip = () => {
    const expected = current.a * current.b;
    recordResult(current, false);
    setFeedback({ correct: false, skipped: true, answer: expected });
    setPhase("feedback");
  };

  const next = useCallback(() => {
    setFacts((prev) => {
      const nextFact = pickFact(prev);
      setCurrent(nextFact);
      return prev;
    });
    setInput("");
    setPhase("question");
    setFeedback(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (phase === "question" && input.trim()) submit();
      else if (phase === "feedback") next();
    }
  };

  const totalSeen = facts.reduce((s, f) => s + f.timesSeen, 0);
  const totalCorrect = facts.reduce((s, f) => s + f.timesCorrect, 0);
  const accuracy =
    totalSeen > 0 ? Math.round((totalCorrect / totalSeen) * 100) : null;

  return (
    <div className="shell">
      <header className="site-header">
        <span className="logo">MultiAnki</span>
        {accuracy !== null && (
          <span className="stat">
            {totalCorrect} / {totalSeen} ({accuracy}%)
          </span>
        )}
      </header>

      <main className="card">
        {phase === "question" ? (
          <>
            <p className="problem">
              {current.a} &times; {current.b} = ?
            </p>
            <input
              ref={inputRef}
              className="answer-input"
              type="number"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="your answer"
            />
            <div className="actions">
              <button
                className="btn-primary"
                onClick={submit}
                disabled={!input.trim()}
              >
                Submit
              </button>
              <button className="btn-ghost" onClick={skip}>
                I don&apos;t know
              </button>
            </div>
          </>
        ) : (
          feedback && (
            <>
              <p className="problem">
                {current.a} &times; {current.b} = {feedback.answer}
              </p>
              <p className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}>
                {feedback.skipped
                  ? `The answer is ${feedback.answer}. You'll see this again soon.`
                  : feedback.correct
                  ? "Correct."
                  : `Not quite — the answer is ${feedback.answer}. You'll see this again soon.`}
              </p>
              <div className="actions">
                <button className="btn-primary" onClick={next}>
                  Next
                </button>
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}
