import { useState, useEffect, useRef, useCallback } from "react";
import {
  DURATIONS, buildInitialQueue, buildDivisionQueue, buildSquaresAndRootsQueue, buildGeoQueue,
  buildAdditionQueue, buildConversionQueue, buildEquationQueue, buildThreeMinQueue, shuffle,
  isGeo, geoAnswer, isConv, convAnswer, isEq, eqLevel, EQ_LEVEL_NAMES,
  type Pair, type SessionMode, type FactStat, type ConvOp,
} from "./curriculum";
import { checkStudent, logFact, logSession, fetchFactStats, updateFactProgress, fetchInitialTestDone, markInitialTestDone, fetchSetting, fetchAllPairWeights, upsertPairWeights, fetchEqPoints, upsertEqPoints, type PairWeight } from "./supabase";
import "./App.css";

// ─── localStorage (name only) ─────────────────────────────────────────────────

const NAME_KEY = "multianki_student";
const SLOW_THRESHOLD_SECS = 5;

function loadStudentName(): string | null { return localStorage.getItem(NAME_KEY); }
function saveStudentName(n: string) { localStorage.setItem(NAME_KEY, n); }
function clearStudentName() { localStorage.removeItem(NAME_KEY); }

// Progress is stored in Supabase; this is just an in-memory type.
interface Progress {
  mult: PairWeight[]; div: PairWeight[];
  sq: PairWeight[];   sqrt: PairWeight[];
  add: PairWeight[];
  geo:  Record<string, PairWeight[]>; // keyed by GeoOp string
  conv: Record<string, PairWeight[]>; // keyed by ConvOp string
}

function emptyProgress(): Progress { return { mult: [], div: [], sq: [], sqrt: [], add: [], geo: {}, conv: {} }; }

function progressFromWeightMap(m: Record<string, PairWeight[]>): Progress {
  return {
    mult: m["mult"] ?? [], div:  m["div"]  ?? [],
    sq:   m["sq"]   ?? [], sqrt: m["sqrt"] ?? [],
    add:  m["add"]  ?? [],
    geo:  Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith("g-"))),
    conv: Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith("conv-"))),
  };
}

// Merge session results into a weight array, returning updated weights.
function mergeWeights(
  current: PairWeight[],
  mistakes: Pair[],
  corrects: Pair[],
  slows: Pair[],
  op: string,
): PairWeight[] {
  const directional = op === "div" || op.startsWith("conv-");
  const key = (a: number, b: number) =>
    directional ? `${a}x${b}` : `${Math.min(a,b)}x${Math.max(a,b)}`;
  const canonA = (p: Pair) => directional ? p.a : Math.min(p.a, p.b);
  const canonB = (p: Pair) => directional ? p.b : Math.max(p.a, p.b);

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
  if (pair.op === "add")  return pair.a + pair.b;
  if (isConv(pair))       return pair.a / pair.b; // unused at runtime; conv handled separately
  if (pair.op === "div")  return (signs.negA !== signs.negB) ? -pair.a : pair.a;
  return (signs.negA ? -pair.a : pair.a) * (signs.negB ? -pair.b : pair.b);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppPhase = "lobby" | "initial-welcome" | "loading" | "practice" | "review" | "session-done";

interface PracticeFeedback { correct: boolean; answer: number; hasPi?: boolean; answerText?: string; }

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
  const [eqPoints, setEqPoints]               = useState<number>(0);
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
  const activeOpRef         = useRef<"mult" | "div" | "sq" | "geo" | "add" | "conv" | "eq">("mult");
  const eqPointsRef         = useRef<number>(0);
  const activeEqLevelRef    = useRef<string>("");
  const pendingEqQueueRef   = useRef<Pair[] | null>(null);
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
  useEffect(() => { eqPointsRef.current = eqPoints; }, [eqPoints]);

  // Stage a new eq queue when level advances — pracNext will apply it after feedback is shown
  useEffect(() => {
    if (activeOpRef.current !== "eq") return;
    if (phaseRef.current !== "review" && phaseRef.current !== "practice") return;
    const newLevel = eqLevel(eqPoints);
    const newLevelName = EQ_LEVEL_NAMES[newLevel];
    if (newLevelName !== activeEqLevelRef.current) {
      activeEqLevelRef.current = newLevelName;
      pendingEqQueueRef.current = buildEquationQueue(newLevel);
    }
  }, [eqPoints]);

  // When the student name is already remembered, fetch their data from Supabase on mount.
  useEffect(() => {
    const name = loadStudentName();
    if (!name) return;
    (async () => {
      const [done, allWeights, durationStr, eqPts] = await Promise.all([
        fetchInitialTestDone(name),
        fetchAllPairWeights(name),
        fetchSetting("practice_duration_secs", "300"),
        fetchEqPoints(name),
      ]);
      setInitialDone(done);
      setProgress(progressFromWeightMap(allWeights));
      setPracticeDurationSecs(parseInt(durationStr, 10) || 300);
      setEqPoints(eqPts);
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
    } else if (op === "geo") {
      // Group mistakes/corrects/slows by their specific geo op, update each separately
      const geoOps = [...new Set([...mistakes, ...corrects, ...slows].map(p => p.op as string))];
      const newGeo = { ...progressRef.current.geo };
      for (const gOp of geoOps) {
        const f = (ps: Pair[]) => ps.filter(p => p.op === gOp);
        newGeo[gOp] = mergeWeights(newGeo[gOp] ?? [], f(mistakes), f(corrects), f(slows), gOp);
        upsertPairWeights(student, gOp, newGeo[gOp]);
      }
      setProgress((prev) => ({ ...prev, geo: newGeo }));
    } else if (op === "conv") {
      const convOps = [...new Set([...mistakes, ...corrects, ...slows].map(p => p.op as string))];
      const newConv = { ...progressRef.current.conv };
      for (const cOp of convOps) {
        const f = (ps: Pair[]) => ps.filter(p => p.op === cOp);
        newConv[cOp] = mergeWeights(newConv[cOp] ?? [], f(mistakes), f(corrects), f(slows), cOp);
        upsertPairWeights(student, cOp, newConv[cOp]);
      }
      setProgress((prev) => ({ ...prev, conv: newConv }));
    } else if (op === "add") {
      const newWeights = mergeWeights(progressRef.current.add, mistakes, corrects, slows, "add");
      setProgress((prev) => ({ ...prev, add: newWeights }));
      upsertPairWeights(student, "add", newWeights);
    } else if (op === "eq") {
      // points already saved incrementally in pracSubmit
    } else {
      const current = op === "div" ? progressRef.current.div : progressRef.current.mult;
      const newWeights = mergeWeights(current, mistakes, corrects, slows, op);
      setProgress((prev) => op === "div" ? { ...prev, div: newWeights } : { ...prev, mult: newWeights });
      upsertPairWeights(student, op, newWeights);
    }

    const curPhase = phaseRef.current;
    const opLabel = op === "geo" ? "Geometry" : op === "conv" ? "Conversions" : op === "add" ? "Addition" : op === "eq" ? "Solving Equations" : op === "div" ? "Division" : op === "sq" ? "Squares & Roots" : "Multiplication";
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
    setQuestionSigns(q[0]?.op === "sq" || q[0]?.op === "sqrt" || q[0]?.op === "add" || isGeo(q[0] ?? {}) || isConv(q[0] ?? {}) || isEq(q[0] ?? {}) ? { negA: false, negB: false } : randomSigns());
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

  const startReview = (op: "mult" | "div" | "sq" | "geo" | "add" | "conv" | "eq") => {
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
    } else if (op === "geo") {
      const geoScoreFor = (p: Pair) => {
        const opKey = p.op as string;
        const wList = progress.geo[opKey] ?? [];
        const pairKey = `${p.a}x${p.b}${p.c != null ? `x${p.c}` : ""}`;
        const w = wList.find(w => `${w.a}x${w.b}` === `${p.a}x${p.b}`);
        void pairKey;
        return (w?.wrongCount ?? 0) * 2 + Math.floor((w?.slowCount ?? 0) / 2);
      };
      const allFacts = buildGeoQueue();
      const weighted: Pair[] = [];
      for (const p of allFacts) {
        const reps = Math.min(6, 1 + geoScoreFor(p));
        for (let i = 0; i < reps; i++) weighted.push(p);
      }
      q = shuffle(weighted).sort((a, b) => geoScoreFor(b) - geoScoreFor(a));
    } else if (op === "conv") {
      const convScoreFor = (p: Pair) => {
        const wList = progress.conv[p.op as string] ?? [];
        const w = wList.find(w => w.a === p.a && w.b === p.b);
        return (w?.wrongCount ?? 0) * 2 + Math.floor((w?.slowCount ?? 0) / 2);
      };
      const allFacts = buildConversionQueue();
      const weighted: Pair[] = [];
      for (const p of allFacts) {
        const reps = Math.min(6, 1 + convScoreFor(p));
        for (let i = 0; i < reps; i++) weighted.push(p);
      }
      q = shuffle(weighted).sort((a, b) => convScoreFor(b) - convScoreFor(a));
    } else if (op === "eq") {
      const level = eqLevel(eqPoints);
      activeEqLevelRef.current = EQ_LEVEL_NAMES[level];
      q = buildEquationQueue(level);
    } else if (op === "add") {
      const wMap = new Map<string, PairWeight>();
      for (const w of progress.add) wMap.set(`${Math.min(w.a,w.b)}x${Math.max(w.a,w.b)}`, w);
      const score = (a: number, b: number) => {
        const w = wMap.get(`${Math.min(a,b)}x${Math.max(a,b)}`);
        return (w?.wrongCount ?? 0) * 2 + Math.floor((w?.slowCount ?? 0) / 2);
      };
      const allFacts = buildAdditionQueue();
      const weighted: Pair[] = [];
      for (const p of allFacts) {
        const reps = Math.min(6, 1 + score(p.a, p.b));
        for (let i = 0; i < reps; i++) weighted.push(p);
      }
      q = shuffle(weighted).sort((a, b) => score(b.a, b.b) - score(a.a, a.b));
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
          if (op !== "div" && p.a !== p.b) weighted.push({ a: p.b, b: p.a });
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
    setQuestionSigns(q[0]?.op === "sq" || q[0]?.op === "sqrt" || q[0]?.op === "add" || isGeo(q[0] ?? {}) || isConv(q[0] ?? {}) || isEq(q[0] ?? {}) ? { negA: false, negB: false } : randomSigns());
    setPracPhase("question");
    setPracInput("");
    setPracFeedback(null);
    setSecondsLeft(op === "geo" || op === "conv" || op === "eq" ? 900 : practiceDurationSecs);
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
    const pair    = queue[0];
    const elapsed = Math.round((Date.now() - questionStartRef.current) / 1000);

    let correct: boolean;
    let expectedNum: number = 0;
    let hasPi = false;
    let answerText: string | undefined;

    if (isEq(pair)) {
      if (pair.op === "eq-l6") {
        const parts = pair.eqStr?.split("|") ?? [];
        const accepted = parts.slice(3).map(s => s.replace(/\s/g, "").toLowerCase());
        const normalized = pracInput.trim().replace(/\s/g, "").toLowerCase();
        correct = accepted.includes(normalized);
        answerText = parts[2] ?? "";
      } else if (pair.op === "eq-l4") {
        // Two solutions: accept "a, b" in any order
        const parts = pracInput.trim().split(",").map(s => parseInt(s.trim(), 10));
        const sorted = [...parts].sort((a, b) => b - a);
        correct = parts.length === 2 && !isNaN(sorted[0]) && !isNaN(sorted[1])
          && sorted[0] === (pair.answer ?? 0) && sorted[1] === (pair.c ?? 0);
        expectedNum = pair.answer ?? 0;
        answerText = `${pair.answer}, ${pair.c}`;
      } else {
        expectedNum = pair.answer ?? 0;
        correct = parseInt(pracInput.trim(), 10) === expectedNum;
      }
    } else if (isConv(pair)) {
      const ca = convAnswer(pair);
      const raw = pracInput.trim().replace(/\s/g, "");
      if (ca.isFraction) {
        correct = raw === ca.answerStr;
        answerText = ca.answerStr;
      } else {
        const parsed = parseFloat(raw);
        const expected2 = parseFloat(ca.answerStr);
        correct = Math.abs(parsed - expected2) < 0.0001;
        expectedNum = expected2;
      }
    } else if (isGeo(pair)) {
      const exp = geoAnswer(pair);
      expectedNum = exp.value;
      hasPi = exp.hasPi;
      const raw = pracInput.trim();
      if (exp.hasPi) {
        const withoutPi = raw.replace(/π$/, "").trim();
        const coeff = withoutPi === "" ? 1 : parseFloat(withoutPi);
        correct = raw.includes("π") && coeff === exp.value;
      } else {
        correct = parseFloat(raw) === exp.value;
      }
    } else {
      expectedNum = signedExpected(pair, questionSigns);
      correct = parseInt(pracInput.trim(), 10) === expectedNum;
    }

    if (correct) {
      setSessionCorrects((c) => [...c, pair]);
      if (elapsed > SLOW_THRESHOLD_SECS) setSessionSlows((s) => [...s, pair]);
      if (isEq(pair)) {
        const newPts = Math.min(18, eqPointsRef.current + 1);
        eqPointsRef.current = newPts;
        setEqPoints(newPts);
        upsertEqPoints(studentName ?? "", newPts);
      }
    } else {
      setSessionMistakes((m) => [...m, pair]);
    }
    setSessionCorrect((c) => c + (correct ? 1 : 0));
    setSessionTotal((t) => t + 1);
    const sessionMode = phaseRef.current === "review" ? "review" : activeModeRef.current;
    const opRef = activeOpRef.current;
    const lessonLabel = activeModeRef.current === "initial" ? "Initial Test"
      : opRef === "geo" ? "Geometry" : opRef === "conv" ? "Conversions" : opRef === "add" ? "Addition"
      : opRef === "eq" ? "Solving Equations"
      : opRef === "div" ? "Division" : opRef === "sq" ? "Squares & Roots" : "Multiplication";
    logFact({ student_name: studentName ?? "", lesson: lessonLabel, session_mode: sessionMode, a: pair.a, b: pair.b, answer_given: expectedNum, correct, time_seconds: correct ? elapsed : null });
    if (!isGeo(pair) && !isConv(pair) && !isEq(pair)) updateFactProgress(studentName ?? "", pair.a, pair.b, correct);
    setPracFeedback({ correct, answer: expectedNum, hasPi, answerText });
    setPracPhase("feedback");
  };

  const pracSkip = () => {
    const pair = queue[0];
    setSessionMistakes((m) => [...m, pair]);
    setSessionTotal((t) => t + 1);

    const sessionMode = phaseRef.current === "review" ? "review" : activeModeRef.current;
    const opRef2 = activeOpRef.current;
    const lessonLabel2 = activeModeRef.current === "initial" ? "Initial Test"
      : opRef2 === "geo" ? "Geometry" : opRef2 === "conv" ? "Conversions" : opRef2 === "add" ? "Addition"
      : opRef2 === "eq" ? "Solving Equations"
      : opRef2 === "div" ? "Division" : opRef2 === "sq" ? "Squares & Roots" : "Multiplication";
    logFact({ student_name: studentName ?? "", lesson: lessonLabel2, session_mode: sessionMode, a: pair.a, b: pair.b, answer_given: null, correct: false, time_seconds: null });
    if (!isGeo(pair) && !isConv(pair) && !isEq(pair)) updateFactProgress(studentName ?? "", pair.a, pair.b, false);
    if (isEq(pair)) {
      const ansText = pair.op === "eq-l6" ? (pair.eqStr?.split("|")[2] ?? "")
        : pair.op === "eq-l4" ? `${pair.answer}, ${pair.c}` : undefined;
      setPracFeedback({ correct: false, answer: pair.answer ?? 0, answerText: ansText });
    } else if (isConv(pair)) {
      const ca = convAnswer(pair);
      setPracFeedback({ correct: false, answer: ca.isFraction ? 0 : parseFloat(ca.answerStr), answerText: ca.isFraction ? ca.answerStr : undefined });
    } else {
      const skipExp = isGeo(pair) ? geoAnswer(pair) : { value: signedExpected(pair, questionSigns), hasPi: false };
      setPracFeedback({ correct: false, answer: skipExp.value, hasPi: skipExp.hasPi });
    }
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

    // If a level change was staged, use that queue instead
    if (pendingEqQueueRef.current !== null) {
      newQueue = pendingEqQueueRef.current;
      pendingEqQueueRef.current = null;
    }

    // Eq review: refill queue when exhausted until timer expires
    if (newQueue.length === 0 && activeOpRef.current === "eq" && eqLevel(eqPointsRef.current) === "review" && !sessionExpiredRef.current) {
      newQueue = buildEquationQueue("review");
    }

    if (newQueue.length === 0 || sessionExpiredRef.current) {
      endSession();
    } else {
      setQueue(newQueue);
      setQuestionSigns(newQueue[0]?.op === "sq" || newQueue[0]?.op === "sqrt" || isGeo(newQueue[0] ?? {}) || isConv(newQueue[0] ?? {}) || isEq(newQueue[0] ?? {}) || newQueue[0]?.op === "add" ? { negA: false, negB: false } : randomSigns());
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
      } else if (op === "geo") {
        const geoOps = [...new Set(sessionMistakes.map(p => p.op as string))];
        const newGeo = { ...progressRef.current.geo };
        for (const gOp of geoOps) {
          const f = sessionMistakes.filter(p => p.op === gOp);
          newGeo[gOp] = mergeWeights(newGeo[gOp] ?? [], f, [], [], gOp);
          upsertPairWeights(studentName ?? "", gOp, newGeo[gOp]);
        }
        setProgress((prev) => ({ ...prev, geo: newGeo }));
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
    const [done, allWeights, durationStr, eqPts] = await Promise.all([
      fetchInitialTestDone(name),
      fetchAllPairWeights(name),
      fetchSetting("practice_duration_secs", "300"),
      fetchEqPoints(name),
    ]);
    saveStudentName(name);
    setStudentName(name);
    setInitialDone(done);
    setProgress(progressFromWeightMap(allWeights));
    setPracticeDurationSecs(parseInt(durationStr, 10) || 300);
    setEqPoints(eqPts);
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
          label={activeMode === "initial" ? "Initial Test"
            : activeOpRef.current === "sq"   ? "Squares & Roots"
            : activeOpRef.current === "geo"  ? "Geometry"
            : activeOpRef.current === "conv" ? "Conversions"
            : activeOpRef.current === "add"  ? "Addition"
            : activeOpRef.current === "eq"   ? `Solving Equations · ${activeEqLevelRef.current}`
            : activeOpRef.current === "div"  ? "Division" : "Multiplication"}
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
  onReview: (op: "mult" | "div" | "sq" | "geo" | "add" | "conv" | "eq") => void;
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

      <div className="op-section">
        <p className="lobby-heading">Geometry</p>
        <button className="btn-op btn-practice" onClick={() => onReview("geo")}>Practice</button>
      </div>

      <div className="op-section">
        <p className="lobby-heading">Addition</p>
        <button className="btn-op btn-practice" onClick={() => onReview("add")}>Practice</button>
      </div>

      <div className="op-section">
        <p className="lobby-heading">Conversions</p>
        <button className="btn-op btn-practice" onClick={() => onReview("conv")}>Practice</button>
      </div>

      <div className="op-section">
        <p className="lobby-heading">Solving Equations</p>
        <button className="btn-op btn-practice" onClick={() => onReview("eq")}>
          Practice
        </button>
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

function GeoFigure({ pair }: { pair: Pair }) {
  // Extra padding in the viewBox so rotated/edge labels never clip
  const W = 240, H = 190;
  const stroke = "var(--accent)";
  const textFill = "var(--text)";
  const muted = "var(--muted)";
  const sw = 2.5;
  const fs = 14;

  if (pair.op === "g-ra" || pair.op === "g-rp") {
    const rx = 50, ry = 25, rw = 140, rh = 110;
    const midX = rx + rw / 2;
    const midY = ry + rh / 2;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke={stroke} strokeWidth={sw} rx={3} />
        {/* base label below */}
        <text x={midX} y={ry + rh + 22} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">b = {pair.a}</text>
        {/* height label left, rotated */}
        <text x={rx - 20} y={midY} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600"
          transform={`rotate(-90 ${rx - 20} ${midY})`}>h = {pair.b}</text>
      </svg>
    );
  }

  if (pair.op === "g-ta") {
    const bx = 45, by = 150, bw = 150, th = 110;
    const apex = { x: bx, y: by - th };
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <polygon points={`${apex.x},${apex.y} ${bx},${by} ${bx + bw},${by}`} fill="none" stroke={stroke} strokeWidth={sw} />
        {/* dashed height */}
        <line x1={bx} y1={by} x2={apex.x} y2={apex.y} stroke={muted} strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={bx + bw / 2} y={by + 20} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">b = {pair.a}</text>
        <text x={bx - 22} y={by - th / 2} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600"
          transform={`rotate(-90 ${bx - 22} ${by - th / 2})`}>h = {pair.b}</text>
      </svg>
    );
  }

  if (pair.op === "g-tp") {
    const ax = 120, ay = 20;
    const bx2 = 30, by2 = 155;
    const cx2 = 210, cy2 = 155;
    // Offset labels away from the line midpoints so they don't sit on the edge
    const midAB = { x: (ax + bx2) / 2 - 18, y: (ay + by2) / 2 };
    const midBC = { x: (bx2 + cx2) / 2, y: by2 + 18 };
    const midAC = { x: (ax + cx2) / 2 + 18, y: (ay + cy2) / 2 };
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <polygon points={`${ax},${ay} ${bx2},${by2} ${cx2},${cy2}`} fill="none" stroke={stroke} strokeWidth={sw} />
        <text x={midAB.x} y={midAB.y} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">{pair.a}</text>
        <text x={midBC.x} y={midBC.y} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">{pair.b}</text>
        <text x={midAC.x} y={midAC.y} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">{pair.c ?? 0}</text>
      </svg>
    );
  }

  if (pair.op === "g-ca-r" || pair.op === "g-cc-r") {
    const cx = W / 2, cy = H / 2, r = 72;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={sw} />
        <line x1={cx} y1={cy} x2={cx + r} y2={cy} stroke={muted} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={3} fill={muted} />
        <text x={cx + r / 2} y={cy - 10} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">r = {pair.a}</text>
      </svg>
    );
  }

  if (pair.op === "g-ca-d" || pair.op === "g-cc-d") {
    const cx = W / 2, cy = H / 2, r = 72;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={sw} />
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={muted} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={3} fill={muted} />
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize={fs} fill={textFill} fontWeight="600">d = {pair.a}</text>
      </svg>
    );
  }

  return null;
}

function geoQuestionText(pair: Pair): { title: string; measure: string } {
  switch (pair.op) {
    case "g-ra":   return { title: "Rectangle", measure: "Area = ?" };
    case "g-rp":   return { title: "Rectangle", measure: "Perimeter = ?" };
    case "g-ta":   return { title: "Triangle",  measure: "Area = ?" };
    case "g-tp":   return { title: "Triangle",  measure: "Perimeter = ?" };
    case "g-ca-r": return { title: "Circle", measure: "Area = ?" };
    case "g-ca-d": return { title: "Circle", measure: "Area = ?" };
    case "g-cc-r": return { title: "Circle", measure: "Circumference = ?" };
    case "g-cc-d": return { title: "Circle", measure: "Circumference = ?" };
    default:       return { title: "", measure: "" };
  }
}

function geoAnswerText(pair: Pair, ans: PracticeFeedback): string {
  const v = ans.answer;
  const pi = ans.hasPi ? "π" : "";
  switch (pair.op) {
    case "g-ra":   return `Area = ${pair.a} × ${pair.b} = ${v}`;
    case "g-rp":   return `Perimeter = 2 × (${pair.a} + ${pair.b}) = ${v}`;
    case "g-ta":   return `Area = ½ × ${pair.a} × ${pair.b} = ${v}`;
    case "g-tp":   return `Perimeter = ${pair.a} + ${pair.b} + ${pair.c ?? 0} = ${v}`;
    case "g-ca-r": return `Area = π × ${pair.a}² = ${v}${pi}`;
    case "g-ca-d": return `Area = π × (${pair.a}/2)² = ${v}${pi}`;
    case "g-cc-r": return `Circumference = 2π × ${pair.a} = ${v}${pi}`;
    case "g-cc-d": return `Circumference = π × ${pair.a} = ${v}${pi}`;
    default: return `${v}${pi}`;
  }
}

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
  const isAdd  = pair.op === "add";
  const eq      = isEq(pair);
  const geo     = isGeo(pair);
  const conv    = isConv(pair);
  const eqL6Parts = pair.op === "eq-l6" && pair.eqStr ? pair.eqStr.split("|") : null;
  const l6SolveVar = eqL6Parts?.[0] ?? "?";
  const l6Formula  = eqL6Parts?.[1] ?? "";
  const isCircle = pair.op === "g-ca-r" || pair.op === "g-ca-d" || pair.op === "g-cc-r" || pair.op === "g-cc-d";
  const convQ   = conv ? convAnswer(pair) : null;
  const convHint = (op: ConvOp) => {
    if (op === "conv-fd" || op === "conv-pd") return "Write as a decimal (e.g. 0.75)";
    if (op === "conv-fp" || op === "conv-dp") return "Write as a percent number (e.g. 75)";
    return "Write as a fraction (e.g. 3/4)";
  };

  // Signed display values (signs are always {false,false} for sq/sqrt/geo)
  const sA = signs.negA ? -pair.a : pair.a;
  const sB = signs.negB ? -pair.b : pair.b;
  const dividend = isDiv ? (signs.negA ? -(pair.a * pair.b) : pair.a * pair.b) : null;
  const divisor  = isDiv ? sB : null;

  const question = isSq
    ? <>{pair.a}<sup>2</sup> = ?</>
    : isSqrt
    ? <>&radic;{pair.a * pair.a} = ?</>
    : isDiv
    ? <>{dividend} &divide; {divisor} = ?</>
    : isAdd
    ? <>{pair.a} + {pair.b} = ?</>
    : <>{sA} &times; {sB} = ?</>;



  const geoQ = geo ? geoQuestionText(pair) : null;

  const appendPi = () => {
    if (!input.includes("π")) onInput(input + "π");
  };

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
          {eq ? (
            <div className="conv-question">
              {pair.op === "eq-l6" ? (
                <>
                  <p className="conv-given">{l6Formula}</p>
                  <p className="conv-hint">Solve for {l6SolveVar}</p>
                </>
              ) : (
                <p className="conv-given">{pair.eqStr}</p>
              )}
              {pair.op === "eq-l4" && <p className="conv-hint">Enter both solutions separated by a comma (e.g. 5, −3)</p>}
            </div>
          ) : conv && convQ ? (
            <div className="conv-question">
              <p className="conv-given">{convQ.given}</p>
              <p className="conv-hint">{convHint(pair.op as ConvOp)}</p>
            </div>
          ) : geo && geoQ ? (
            <div className="geo-question">
              <p className="geo-shape">{geoQ.title}</p>
              <GeoFigure pair={pair} />
              <p className="problem">{geoQ.measure}</p>
            </div>
          ) : (
            <p className="problem">{question}</p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "center" }}>
            {pair.op === "eq-l6" && <span className="conv-percent-label">{l6SolveVar} =</span>}
            <input ref={inputRef} className="answer-input"
              type={(geo || conv || eq) ? "text" : "number"} inputMode={geo && isCircle ? "text" : "numeric"}
              value={input} onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder={isCircle ? "e.g. 25π" : convQ?.isFraction ? "e.g. 3/4" : eq ? (pair.op === "eq-l4" ? "e.g. 5, −3" : "") : "your answer"}
              style={{ flex: 1 }} />
            {isCircle && (
              <button className="btn-pi" onClick={appendPi} type="button">π</button>
            )}
            {convQ?.isPercent && <span className="conv-percent-label">%</span>}
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={onSubmit} disabled={!input.trim()}>Submit</button>
            <button className="btn-ghost" onClick={onSkip}>I don&apos;t know</button>
          </div>
        </>
      ) : (
        feedback && (
          <AutoAdvance correct={feedback.correct} onNext={onNext}>
            {eq ? (
              <div className="conv-question">
                {pair.op === "eq-l6" ? (
                  <p className="conv-given">{l6Formula}</p>
                ) : (
                  <p className="conv-given">{pair.eqStr}</p>
                )}
                <p className="conv-given">
                  {pair.op === "eq-l6" ? l6SolveVar
                    : pair.op === "eq-l4" ? "solutions"
                    : pair.op === "eq-l5" ? (pair.eqStr?.match(/[ynmptk]/)?.[0] ?? "x")
                    : "x"} = <strong>{feedback.answerText ?? feedback.answer}</strong>
                </p>
              </div>
            ) : conv && convQ ? (
              <div className="conv-question">
                <p className="conv-given">{convQ.given} = <strong>{feedback.answerText ?? (convQ.isPercent ? `${feedback.answer}%` : feedback.answer)}</strong></p>
              </div>
            ) : geo ? (
              <div className="geo-question">
                <p className="geo-shape">{geoQ?.title}</p>
                <GeoFigure pair={pair} />
                <p className="problem">{geoAnswerText(pair, feedback)}</p>
              </div>
            ) : (
              <p className="problem">
                {isSq   ? <>{pair.a}<sup>2</sup> = {feedback.answer}</>
                : isSqrt ? <>&radic;{pair.a * pair.a} = {feedback.answer}</>
                : isDiv  ? <>{dividend} &divide; {divisor} = {feedback.answer}</>
                : isAdd  ? <>{pair.a} + {pair.b} = {feedback.answer}</>
                :          <>{sA} &times; {sB} = {feedback.answer}</>}
              </p>
            )}
            <p className={`result-label ${feedback.correct ? "correct" : "incorrect"}`}>
              {feedback.correct ? "Correct." : "Incorrect."}
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
