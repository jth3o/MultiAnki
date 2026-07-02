import { useState, useEffect, useRef, useCallback } from "react";
import {
  DURATIONS, buildInitialQueue, buildDivisionQueue, buildSquaresAndRootsQueue, buildThreeMinQueue, shuffle,
  type Pair, type SessionMode, type FactStat,
} from "./curriculum";
import { checkStudent, logFact, logSession, fetchFactStats, updateFactProgress, fetchInitialTestDone, markInitialTestDone, fetchSetting, fetchPairWeights, upsertPairWeights, type PairWeight } from "./supabase";
import "./App.css";

// ─── localStorage (name only) ─────────────────────────────────────────────────

const NAME_KEY = "multianki_student";
const SLOW_THRESHOLD_SECS = 5;

function loadStudentName(): string | null { return localStorage.getItem(NAME_KEY); }
function saveStudentName(n: string) { localStorage.setItem(NAME_KEY, n); }
function clearStudentName() { localStorage.removeItem(NAME_KEY); }

// Progress is stored in Supabase; this is just an in-memory type.
interface Progress { mult: PairWeight[]; div: PairWeight[]; sq: PairWeight[]; sqrt: PairWeight[]; }

function emptyProgress(): Progress { return { mult: [], div: [], sq: [], sqrt: [] }; }

// Merge session results into a weight array, returning updated weights.
function mergeWeights(
  current: PairWeight[],
  mistakes: Pair[],
  corrects: Pair[],
  slows: Pair[],
  op: string,
): PairWeight[] {
  const key = (a: number, b: number) =>
    op === "div" ? `${a}x${b}` : `${Math.min(a,b)}x${Math.max(a,b)}`;
  const canonA = (p: Pair) => op === "div" ? p.a : Math.min(p.a, p.b);
  const canonB = (p: Pair) => op === "div" ? p.b : Math.max(p.a, p.b);

  const map = new Map<string, PairWeight>();
  for (const w of current) map.set(key(w.a, w.b), { ...w });

  for (const p of mistakes) {
    const k = key(canonA(p), canonB(p));
    const w = map.get(k) ?? { a: canonA(p), b: canonB(p), wrongCount: 0, slowCount: 0 };
    map.set(k, { ...w, wrongCount: w.wrongCount + 1 });
  }

  for (const p of corrects) {
    const k = key(canonA(p), canonB(p));
    const isSlow = slows.some(s => s.a === p.a && s.b === p.b);
    const w = map.get(k) ?? { a: canonA(p), b: canonB(p), wrongCount: 0, slowCount: 0 };
    map.set(k, {
      ...w,
      wrongCount: Math.max(0, w.wrongCount - 1),
      slowCount: isSlow ? w.slowCount + 1 : Math.max(0, w.slowCount - 1),
    });
  }

  return [...map.values()].filter(w => w.wrongCount > 0 || w.slowCount > 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

interface Signs { negA: boolean; negB: boolean; }

function randomSigns(): Signs {
  const r = Math.random();
  if (r < 1 / 3) return { negA: false, negB: false };
  if (r < 2 / 3) return Math.random() < 0.5 ? { negA: true, negB: false } : { negA: false, negB: true };
  return { negA: true, negB: true };
}

function signedExpected(pair: Pair, signs: Signs): number {
  if (pair.op === "sq")   return pair.a * pair.a;
  if (pair.op === "sqrt") return pair.a;
  if (pair.op === "div")  return (signs.negA !== signs.negB) ? -pair.a : pair.a;
  return (signs.negA ? -pair.a : pair.a) * (signs.negB ? -pair.b : pair.b);
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
  const [progress, setProgress]               = useState<Progress>(emptyProgress);
  const [initialDone, setInitialDone]         = useState<boolean>(false);
  const [appReady, setAppReady]               = useState<boolean>(!loadStudentName()); // false when name known but data not yet fetched
  const [practiceDurationSecs, setPracticeDurationSecs] = useState<number>(300);
  const [phase, setPhase]                     = useState<AppPhase>("lobby");
  const [activeMode, setActiveMode]           = useState<SessionMode>("practice");

  // Practice state
  const [queue, setQueue]                     = useState<Pair[]>([]);
  const [sessionMistakes, setSessionMistakes] = useState<Pair[]>([]);
  const [sessionCorrects, setSessionCorrects] = useState<Pair[]>([]);
  const [sessionSlows, setSessionSlows]       = useState<Pair[]>([]);
  const [pracPhase, setPracPhase]             = useState<"question" | "feedback">("question");
  const [pracInput, setPracInput]             = useState("");
  const [pracFeedback, setPracFeedback]       = useState<PracticeFeedback | null>(null);
  const [sessionCorrect, setSessionCorrect]   = useState(0);
  const [sessionTotal, setSessionTotal]       = useState(0);
  const [secondsLeft, setSecondsLeft]         = useState<number | null>(null);
  const [sessionResult, setSessionResult]     = useState<SessionResult | null>(null);
  const [questionSigns, setQuestionSigns]     = useState<Signs>({ negA: false, negB: false });

  const inputRef        = useRef<HTMLInputElement>(null);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFinishingRef  = useRef(false);
  const questionStartRef = useRef<number>(Date.now());

  // Stable refs for timer/endSession callback
  const progressRef         = useRef<Progress>(emptyProgress());
  const sessionMistakesRef  = useRef<Pair[]>([]);
  const sessionCorrectsRef  = useRef<Pair[]>([]);
  const sessionSlowsRef     = useRef<Pair[]>([]);
  const activeModeRef       = useRef<SessionMode>("practice");
  const activeOpRef         = useRef<"mult" | "div" | "sq">("mult");
  const sessionExpiredRef   = useRef(false);
  const sessionCorrectRef  = useRef(0);
  const sessionTotalRef    = useRef(0);
  const studentNameRef     = useRef<string | null>(null);
  const phaseRef           = useRef<AppPhase>("lobby");

  useEffect(() => { sessionMistakesRef.current = sessionMistakes; },  [sessionMistakes]);
  useEffect(() => { sessionCorrectsRef.current = sessionCorrects; },  [sessionCorrects]);
  useEffect(() => { sessionSlowsRef.current = sessionSlows; },        [sessionSlows]);
  useEffect(() => { activeModeRef.current = activeMode; },             [activeMode]);
  useEffect(() => { sessionCorrectRef.current = sessionCorrect; },     [sessionCorrect]);
  useEffect(() => { sessionTotalRef.current = sessionTotal; },         [sessionTotal]);
  useEffect(() => { studentNameRef.current = studentName; },           [studentName]);
  useEffect(() => { phaseRef.current = phase; },                       [phase]);
  useEffect(() => { progressRef.current = progress; },                 [progress]);

  // When the student name is already remembered, fetch their data from Supabase on mount.
  useEffect(() => {
    const name = loadStudentName();
    if (!name) return;
    (async () => {
      const [done, multW, divW, sqW, sqrtW, durationStr] = await Promise.all([
        fetchInitialTestDone(name),
        fetchPairWeights(name, "mult"),
        fetchPairWeights(name, "div"),
        fetchPairWeights(name, "sq"),
        fetchPairWeights(name, "sqrt"),
        fetchSetting("practice_duration_secs", "300"),
      ]);
      setInitialDone(done);
      setProgress({ mult: multW, div: divW, sq: sqW, sqrt: sqrtW });
      setPracticeDurationSecs(parseInt(durationStr, 10) || 300);
      setPhase(done ? "lobby" : "initial-welcome");
      setAppReady(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const corrects  = sessionCorrectsRef.current;
    const slows     = sessionSlowsRef.current;
    const mode      = activeModeRef.current;
    const op        = activeOpRef.current;
    const correct   = sessionCorrectRef.current;
    const total     = sessionTotalRef.current;
    const student   = studentNameRef.current ?? "";

    if (mode === "initial") {
      markInitialTestDone(student);
      setInitialDone(true);
      const newWeights = mergeWeights(progressRef.current.mult, mistakes, [], [], "mult");
      setProgress((prev) => ({ ...prev, mult: newWeights }));
      upsertPairWeights(student, "mult", newWeights);
    } else if (op === "sq") {
      const filter = (pairs: Pair[], subOp: "sq" | "sqrt") => pairs.filter(p => p.op === subOp);
      const newSq   = mergeWeights(progressRef.current.sq,   filter(mistakes,"sq"),   filter(corrects,"sq"),   filter(slows,"sq"),   "sq");
      const newSqrt = mergeWeights(progressRef.current.sqrt, filter(mistakes,"sqrt"), filter(corrects,"sqrt"), filter(slows,"sqrt"), "sqrt");
      setProgress((prev) => ({ ...prev, sq: newSq, sqrt: newSqrt }));
      upsertPairWeights(student, "sq",   newSq);
      upsertPairWeights(student, "sqrt", newSqrt);
    } else {
      const current = op === "div" ? progressRef.current.div : progressRef.current.mult;
      const newWeights = mergeWeights(current, mistakes, corrects, slows, op);
      setProgress((prev) => op === "div" ? { ...prev, div: newWeights } : { ...prev, mult: newWeights });
      upsertPairWeights(student, op, newWeights);
    }

    const curPhase = phaseRef.current;
    const opLabel = op === "div" ? "Division" : op === "sq" ? "Squares & Roots" : "Multiplication";
    logSession({
      student_name: student,
      session_type: curPhase === "review" ? "review" : mode,
      lesson: mode === "initial" ? "Initial Test" : curPhase === "review" ? `${opLabel} Review` : opLabel,
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
    setSessionCorrects([]);
    setSessionSlows([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setQuestionSigns(q[0]?.op === "sq" || q[0]?.op === "sqrt" ? { negA: false, negB: false } : randomSigns());
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

  const startReview = (op: "mult" | "div" | "sq") => {
    isFinishingRef.current = false;
    sessionExpiredRef.current = false;

    let q: Pair[];

    if (op === "sq") {
      // Squares and roots: combine sq and sqrt weights into a single weighted queue
      const makeMap = (ws: PairWeight[]) => new Map(ws.map(w => [`${w.a}`, w]));
      const sqMap   = makeMap(progress.sq);
      const sqrtMap = makeMap(progress.sqrt);

      const scoreFor = (p: Pair) => {
        const w = p.op === "sqrt" ? sqrtMap.get(`${p.a}`) : sqMap.get(`${p.a}`);
        return (w?.wrongCount ?? 0) * 2 + Math.floor((w?.slowCount ?? 0) / 2);
      };

      const allFacts = buildSquaresAndRootsQueue();
      const weighted: Pair[] = [];
      for (const p of allFacts) {
        const reps = Math.min(6, 1 + scoreFor(p));
        for (let i = 0; i < reps; i++) weighted.push(p);
      }
      q = shuffle(weighted).sort((a, b) => scoreFor(b) - scoreFor(a));
    } else {
      const weights = op === "div" ? progress.div : progress.mult;
      const wKey = (a: number, b: number) =>
        op === "div" ? `${a}x${b}` : `${Math.min(a,b)}x${Math.max(a,b)}`;

      const wMap = new Map<string, PairWeight>();
      for (const w of weights) wMap.set(`${w.a}x${w.b}`, w);

      const score = (a: number, b: number) => {
        const w = wMap.get(wKey(a, b));
        return (w?.wrongCount ?? 0) * 2 + Math.floor((w?.slowCount ?? 0) / 2);
      };

      const allFacts = op === "div" ? buildDivisionQueue() : buildInitialQueue();
      const weighted: Pair[] = [];
      for (const p of allFacts) {
        const reps = Math.min(6, 1 + score(p.a, p.b));
        for (let i = 0; i < reps; i++) {
          weighted.push(p);
          if (p.a !== p.b) weighted.push({ a: p.b, b: p.a });
        }
      }
      q = shuffle(weighted).sort((a, b) => score(b.a, b.b) - score(a.a, a.b));
    }

    activeOpRef.current = op;
    setQueue(q);
    setSessionMistakes([]);
    setSessionCorrects([]);
    setSessionSlows([]);
    setSessionCorrect(0);
    setSessionTotal(0);
    setQuestionSigns(q[0]?.op === "sq" || q[0]?.op === "sqrt" ? { negA: false, negB: false } : randomSigns());
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setSecondsLeft(practiceDurationSecs);
    setPhase("review");

    // Soft timer: marks expired, ends at next question boundary
    if (timerRef.current) clearInterval(timerRef.current);
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
  };

  // ── Submit / skip ──────────────────────────────────────────────────────────

  const pracSubmit = () => {
    const answer   = parseInt(pracInput.trim(), 10);
    const pair     = queue[0];
    const expected = signedExpected(pair, questionSigns);
    const correct  = answer === expected;

    const elapsed = Math.round((Date.now() - questionStartRef.current) / 1000);

    if (correct) {
      setSessionCorrects((c) => [...c, pair]);
      if (elapsed > SLOW_THRESHOLD_SECS) setSessionSlows((s) => [...s, pair]);
    } else {
      setSessionMistakes((m) => [...m, pair]);
    }
    setSessionCorrect((c) => c + (correct ? 1 : 0));
    setSessionTotal((t) => t + 1);
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
    setPracFeedback({ correct: false, answer: signedExpected(pair, questionSigns) });
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
      setQuestionSigns(newQueue[0]?.op === "sq" || newQueue[0]?.op === "sqrt" ? { negA: false, negB: false } : randomSigns());
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
      const op = activeOpRef.current;
      if (op === "sq") {
        const sqM   = sessionMistakes.filter(p => p.op === "sq");
        const sqrtM = sessionMistakes.filter(p => p.op === "sqrt");
        const newSq   = mergeWeights(progressRef.current.sq,   sqM,   [], [], "sq");
        const newSqrt = mergeWeights(progressRef.current.sqrt, sqrtM, [], [], "sqrt");
        setProgress((prev) => ({ ...prev, sq: newSq, sqrt: newSqrt }));
        upsertPairWeights(studentName ?? "", "sq",   newSq);
        upsertPairWeights(studentName ?? "", "sqrt", newSqrt);
      } else {
        const current = op === "div" ? progressRef.current.div : progressRef.current.mult;
        const newWeights = mergeWeights(current, sessionMistakes, [], [], op);
        setProgress((prev) => op === "div" ? { ...prev, div: newWeights } : { ...prev, mult: newWeights });
        upsertPairWeights(studentName ?? "", op, newWeights);
      }
    }
    setSecondsLeft(null);
    isFinishingRef.current = false;
    setPhase(initialDone ? "lobby" : "initial-welcome");
  };

  // ── Sign in ────────────────────────────────────────────────────────────────

  const handleSignIn = async (name: string) => {
    const [done, multW, divW, sqW, sqrtW, durationStr] = await Promise.all([
      fetchInitialTestDone(name),
      fetchPairWeights(name, "mult"),
      fetchPairWeights(name, "div"),
      fetchPairWeights(name, "sq"),
      fetchPairWeights(name, "sqrt"),
      fetchSetting("practice_duration_secs", "300"),
    ]);
    saveStudentName(name);
    setStudentName(name);
    setInitialDone(done);
    setProgress({ mult: multW, div: divW, sq: sqW, sqrt: sqrtW });
    setPracticeDurationSecs(parseInt(durationStr, 10) || 300);
    setAppReady(true);
    setPhase(done ? "lobby" : "initial-welcome");
  };

  // ─── Auth gate ─────────────────────────────────────────────────────────────

  if (!studentName) return <NameGate onSignIn={handleSignIn} />;
  if (!appReady) return (
    <div className="shell">
      <header className="site-header"><span className="logo">MultiAnki</span></header>
      <div className="card loading-card"><p className="loading-text">Loading…</p></div>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  const signOut = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearStudentName();
    setStudentName(null);
    setInitialDone(false);
    setAppReady(false);
    setPhase("lobby");
    setProgress(emptyProgress());
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
          initialDone={initialDone}
          onReview={startReview}
          onInitialTest={() => setPhase("initial-welcome")}
        />
      )}

      {phase === "loading" && (
        <div className="card loading-card"><p className="loading-text">Getting ready…</p></div>
      )}

      {(phase === "practice" || phase === "review") && queue.length > 0 && (
        <PracticeView
          label={activeMode === "initial"
            ? "Initial Test"
            : activeOpRef.current === "sq" ? "Squares & Roots"
            : activeOpRef.current === "div" ? "Division" : "Multiplication"}
          tag=""
          secondsLeft={secondsLeft}
          pair={queue[0]}
          input={pracInput}
          onInput={setPracInput}
          onKeyDown={pracKeyDown}
          pracPhase={pracPhase}
          feedback={pracFeedback}
          signs={questionSigns}
          onSubmit={pracSubmit}
          onSkip={pracSkip}
          onNext={pracNext}
          onBack={handleBack}
          inputRef={inputRef}
        />
      )}

      {phase === "session-done" && sessionResult && (
        <SessionDoneView
          result={sessionResult}
          onContinue={() => setPhase("lobby")}
          onRepeat={activeMode !== "initial" ? () => startReview(activeOpRef.current) : undefined}
        />
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

function LobbyView({ initialDone, onReview, onInitialTest }: {
  initialDone: boolean;
  onReview: (op: "mult" | "div" | "sq") => void;
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
        <button className="btn-op btn-practice" onClick={() => onReview("mult")}>Practice</button>
      </div>

      <div className="op-section">
        <p className="lobby-heading">Division</p>
        <button className="btn-op btn-practice" onClick={() => onReview("div")}>Practice</button>
      </div>

      <div className="op-section">
        <p className="lobby-heading">Squares &amp; Roots</p>
        <button className="btn-op btn-practice" onClick={() => onReview("sq")}>Practice</button>
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

function PracticeView({ label, tag, secondsLeft, pair, signs, input, onInput, onKeyDown, pracPhase, feedback, onSubmit, onSkip, onNext, onBack, inputRef }: {
  label: string; tag: string; secondsLeft: number | null;
  pair: Pair; signs: Signs; input: string; onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  pracPhase: "question" | "feedback"; feedback: PracticeFeedback | null;
  onSubmit: () => void; onSkip: () => void; onNext: () => void; onBack: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const isDiv  = pair.op === "div";
  const isSq   = pair.op === "sq";
  const isSqrt = pair.op === "sqrt";

  // Signed display values (signs are always {false,false} for sq/sqrt)
  const sA = signs.negA ? -pair.a : pair.a;
  const sB = signs.negB ? -pair.b : pair.b;
  const dividend = isDiv ? (signs.negA ? -(pair.a * pair.b) : pair.a * pair.b) : null;
  const divisor  = isDiv ? sB : null;

  const expected = signedExpected(pair, signs);

  const question = isSq
    ? <>{pair.a}<sup>2</sup> = ?</>
    : isSqrt
    ? <>&radic;{pair.a * pair.a} = ?</>
    : isDiv
    ? <>{dividend} &divide; {divisor} = ?</>
    : <>{sA} &times; {sB} = ?</>;

  const fullFact = isSq
    ? `${pair.a}² = ${expected}`
    : isSqrt
    ? `√${pair.a * pair.a} = ${expected}`
    : isDiv
    ? `${dividend} ÷ ${divisor} = ${expected}`
    : `${sA} × ${sB} = ${expected}`;

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
            <p className="problem">
              {isSq   ? <>{pair.a}<sup>2</sup> = {feedback.answer}</>
              : isSqrt ? <>&radic;{pair.a * pair.a} = {feedback.answer}</>
              : isDiv  ? <>{dividend} &divide; {divisor} = {feedback.answer}</>
              :          <>{sA} &times; {sB} = {feedback.answer}</>}
            </p>
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

function SessionDoneView({ result, onContinue, onRepeat }: {
  result: SessionResult;
  onContinue: () => void;
  onRepeat?: () => void;
}) {
  const isInitial = result.mode === "initial";

  const headline = isInitial
    ? `Amazing work — you answered ${result.total} facts!`
    : `Nice job — you got through ${result.total} fact${result.total !== 1 ? "s" : ""}!`;

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
      {onRepeat && <button className="btn-primary" onClick={onRepeat}>Go again</button>}
      <button className={onRepeat ? "btn-ghost" : "btn-primary"} onClick={onContinue}>
        {isInitial ? "Go to practice" : "Back"}
      </button>
    </div>
  );
}
