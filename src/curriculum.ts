// Geometry op codes:
//   g-ra = rect area (a=base, b=height)
//   g-rp = rect perimeter
//   g-ta = triangle area (a=base even, b=height) → ½ab
//   g-tp = triangle perimeter (a,b,c = three sides)
//   g-ca-r = circle area, radius given (a=r)      → πr²
//   g-ca-d = circle area, diameter given (a=d)    → π(d/2)²
//   g-cc-r = circle circumference, radius (a=r)  → 2πr
//   g-cc-d = circle circumference, diameter (a=d)→ πd
export type GeoOp = "g-ra" | "g-rp" | "g-ta" | "g-tp" | "g-ca-r" | "g-ca-d" | "g-cc-r" | "g-cc-d";

// Conversion op codes: conv-XY means "given X, answer in Y"
//   f = fraction (a/b), d = decimal, p = percent
export type ConvOp = "conv-fd" | "conv-fp" | "conv-df" | "conv-dp" | "conv-pf" | "conv-pd";

export type EqOp = "eq-l1" | "eq-l2" | "eq-l3" | "eq-l4" | "eq-l5" | "eq-l6";

export interface Pair {
  a: number;
  b: number;
  // undefined = multiplication; "div" = (a*b)÷b=a; "sq" = a²; "sqrt" = √(a²)=a; "add" = a+b; GeoOp/ConvOp/EqOp = others
  op?: "div" | "sq" | "sqrt" | "add" | GeoOp | ConvOp | EqOp;
  c?: number;       // triangle perimeter third side, OR abs value second solution
  answer?: number;  // equation answer (x value, or first/larger solution for abs value)
  eqStr?: string;   // display string e.g. "3x + 5 = 14"
}

export function isEq(pair: Partial<Pair>): boolean {
  return typeof pair.op === "string" && pair.op.startsWith("eq-");
}

// Returns which level to serve based on cumulative points (3 pts per level, 18 total)
export function eqLevel(points: number): 1 | 2 | 3 | 4 | 5 | 6 | "review" {
  if (points >= 18) return "review";
  if (points >= 15) return 6;
  if (points >= 12) return 5;
  if (points >= 9)  return 4;
  if (points >= 6)  return 3;
  if (points >= 3)  return 2;
  return 1;
}

export const EQ_LEVEL_NAMES: Record<1|2|3|4|5|6|"review", string> = {
  1: "Simple",
  2: "Multi-Step",
  3: "Both Sides",
  4: "Absolute Value",
  5: "Mixed Variables",
  6: "Formula: y = mx + b",
  review: "Review",
};

// Sign helpers for equation string building
function addC(n: number): string { return n >= 0 ? ` + ${n}` : ` − ${Math.abs(n)}`; }

export function buildEquationQueue(level: 1 | 2 | 3 | 4 | 5 | 6 | "review"): Pair[] {
  if (level === "review") {
    return shuffle([
      ...buildEquationQueue(1).slice(0, 10),
      ...buildEquationQueue(2).slice(0, 10),
      ...buildEquationQueue(3).slice(0, 10),
      ...buildEquationQueue(4).slice(0, 10),
      ...buildEquationQueue(5).slice(0, 10),
      ...buildEquationQueue(6).slice(0, 10),
    ]);
  }

  if (level === 6) {
    // eqStr format: "solveVar|formula|displayAnswer|accepted1|accepted2|..."
    // Accepted forms are lowercase with spaces stripped for comparison.
    const f = (solveVar: string, formula: string, display: string, ...accepted: string[]): Pair => ({
      a: 0, b: 0, op: "eq-l6",
      eqStr: [solveVar, formula, display, ...accepted].join("|"),
    });
    const problems: Pair[] = [
      // y = mx + b
      f("b", "y = mx + b",     "y − mx",       "y-mx", "-mx+y"),
      f("m", "y = mx + b",     "(y − b) / x",  "(y-b)/x"),
      f("x", "y = mx + b",     "(y − b) / m",  "(y-b)/m"),
      // d = rt
      f("t", "d = rt",          "d / r",        "d/r"),
      f("r", "d = rt",          "d / t",        "d/t"),
      // A = lw
      f("w", "A = lw",          "A / l",        "a/l"),
      f("l", "A = lw",          "A / w",        "a/w"),
      // P = 2l + 2w
      f("l", "P = 2l + 2w",    "(P − 2w) / 2", "(p-2w)/2", "p/2-w"),
      f("w", "P = 2l + 2w",    "(P − 2l) / 2", "(p-2l)/2", "p/2-l"),
      // F = ma
      f("a", "F = ma",          "F / m",        "f/m"),
      f("m", "F = ma",          "F / a",        "f/a"),
      // A = ½bh
      f("h", "A = ½bh",        "2A / b",       "2a/b"),
      f("b", "A = ½bh",        "2A / h",       "2a/h"),
      // V = lwh
      f("h", "V = lwh",        "V / (lw)",     "v/(lw)", "v/lw"),
      f("l", "V = lwh",        "V / (wh)",     "v/(wh)", "v/wh"),
      f("w", "V = lwh",        "V / (lh)",     "v/(lh)", "v/lh"),
      // V = IR  (Ohm's law)
      f("I", "V = IR",          "V / R",        "v/r"),
      f("R", "V = IR",          "V / I",        "v/i"),
      // y = kx  (direct variation)
      f("k", "y = kx",          "y / x",        "y/x"),
      f("x", "y = kx",          "y / k",        "y/k"),
      // s = (a + b) / 2  (average / midpoint)
      f("a", "s = (a + b) / 2", "2s − b",      "2s-b", "-b+2s"),
      f("b", "s = (a + b) / 2", "2s − a",      "2s-a", "-a+2s"),
    ];
    return shuffle(problems);
  }

  if (level === 5) {
    const altVars = ["y", "n", "m", "p", "t", "k"];
    const rv = () => altVars[Math.floor(Math.random() * altVars.length)];
    const pool = [
      ...buildEquationQueue(1).slice(0, 20),
      ...buildEquationQueue(2).slice(0, 20),
      ...buildEquationQueue(3).slice(0, 20),
    ];
    return shuffle(pool.map(p => {
      const v = rv();
      return { ...p, op: "eq-l5" as const, eqStr: p.eqStr?.replace(/x/g, v) };
    }));
  }

  const pairs: Pair[] = [];

  if (level === 1) {
    for (let x = -10; x <= 15; x++) {
      if (x === 0) continue;
      for (let a = 1; a <= 12; a++) {
        pairs.push({ a, b: 0, op: "eq-l1", answer: x, eqStr: `x + ${a} = ${x + a}` });
        pairs.push({ a, b: 0, op: "eq-l1", answer: x, eqStr: `x − ${a} = ${x - a}` });
      }
    }
    for (let a = 2; a <= 10; a++) {
      for (let x = -10; x <= 10; x++) {
        if (x === 0) continue;
        pairs.push({ a, b: a * x, op: "eq-l1", answer: x, eqStr: `${a}x = ${a * x}` });
      }
    }
    for (let a = 2; a <= 8; a++) {
      for (let b = -8; b <= 8; b++) {
        if (b === 0) continue;
        pairs.push({ a, b, op: "eq-l1", answer: a * b, eqStr: `x ÷ ${a} = ${b}` });
      }
    }
  }

  if (level === 2) {
    const consts = [-12, -9, -6, -3, 3, 6, 9, 12];
    for (let a = 2; a <= 7; a++) {
      for (let x = -6; x <= 10; x++) {
        if (x === 0) continue;
        for (const b of consts) {
          pairs.push({ a, b, op: "eq-l2", answer: x, eqStr: `${a}x${addC(b)} = ${a * x + b}` });
        }
      }
    }
    // like terms: ax + bx = c
    for (let a = 2; a <= 7; a++) {
      for (let b = 1; b <= 4; b++) {
        for (let x = 1; x <= 12; x++) {
          pairs.push({ a, b, op: "eq-l2", answer: x, eqStr: `${a}x + ${b}x = ${(a + b) * x}` });
        }
      }
    }
  }

  if (level === 3) {
    // ax + b = cx + d  (a > c, integer solution x > 0)
    const consts = [-12, -9, -6, -3, 3, 6, 9, 12];
    for (let a = 3; a <= 8; a++) {
      for (let c = 1; c <= 3; c++) {
        if (c >= a) continue;
        for (let x = 1; x <= 12; x++) {
          for (const b of consts) {
            const d = (a - c) * x + b;
            pairs.push({ a, b, op: "eq-l3", answer: x, eqStr: `${a}x${addC(b)} = ${c}x${addC(d)}` });
          }
        }
      }
    }
  }

  if (level === 4) {
    // |x + a| = b  →  x = b−a  or  x = −b−a
    for (let a = 1; a <= 12; a++) {
      for (let b = 2; b <= 12; b++) {
        const s1 = b - a, s2 = -b - a;
        pairs.push({ a, b, op: "eq-l4", answer: Math.max(s1, s2), c: Math.min(s1, s2), eqStr: `|x + ${a}| = ${b}` });
      }
    }
    // |x − a| = b  →  x = a+b  or  x = a−b
    for (let a = 1; a <= 12; a++) {
      for (let b = 2; b <= 12; b++) {
        const s1 = a + b, s2 = a - b;
        pairs.push({ a, b, op: "eq-l4", answer: Math.max(s1, s2), c: Math.min(s1, s2), eqStr: `|x − ${a}| = ${b}` });
      }
    }
    // |ax| = b  →  x = b/a  or  x = −b/a
    for (let a = 2; a <= 8; a++) {
      for (let k = 1; k <= 8; k++) {
        pairs.push({ a, b: a * k, op: "eq-l4", answer: k, c: -k, eqStr: `|${a}x| = ${a * k}` });
      }
    }
  }

  return shuffle(pairs).slice(0, 60);
}

export function isConv(pair: Pair): boolean {
  return typeof pair.op === "string" && pair.op.startsWith("conv-");
}

export interface ConvAnswer {
  given: string;       // shown to the student
  answerStr: string;   // correct answer as string
  isFraction: boolean; // answer is typed as "3/4"
  isPercent: boolean;  // show % suffix next to input
}

export function convAnswer(pair: Pair): ConvAnswer {
  const { a, b } = pair;
  const dec = a / b;
  const pct = dec * 100;
  const decStr = String(parseFloat(dec.toFixed(10)));
  const pctStr = String(parseFloat(pct.toFixed(10)));
  const fracStr = `${a}/${b}`;
  switch (pair.op) {
    case "conv-fd": return { given: fracStr,        answerStr: decStr,  isFraction: false, isPercent: false };
    case "conv-fp": return { given: fracStr,        answerStr: pctStr,  isFraction: false, isPercent: true  };
    case "conv-df": return { given: decStr,         answerStr: fracStr, isFraction: true,  isPercent: false };
    case "conv-dp": return { given: decStr,         answerStr: pctStr,  isFraction: false, isPercent: true  };
    case "conv-pf": return { given: pctStr + "%",   answerStr: fracStr, isFraction: true,  isPercent: false };
    case "conv-pd": return { given: pctStr + "%",   answerStr: decStr,  isFraction: false, isPercent: false };
    default:        return { given: "",             answerStr: "",      isFraction: false, isPercent: false };
  }
}

// Curated fractions with terminating decimal equivalents
const CONV_FRACS: [number, number][] = [
  [1,2], [1,4], [3,4],
  [1,5], [2,5], [3,5], [4,5],
  [1,8], [3,8], [5,8], [7,8],
  [1,10], [3,10], [7,10], [9,10],
];
const CONV_OPS: ConvOp[] = ["conv-fd", "conv-fp", "conv-df", "conv-dp", "conv-pf", "conv-pd"];

// 90 conversion facts: 15 fractions × 6 conversion directions
export function buildConversionQueue(): Pair[] {
  const pairs: Pair[] = [];
  for (const [a, b] of CONV_FRACS)
    for (const op of CONV_OPS)
      pairs.push({ a, b, op });
  return shuffle(pairs);
}

export function isGeo(pair: Pair): boolean {
  return typeof pair.op === "string" && pair.op.startsWith("g-");
}

export interface GeoAnswer { value: number; hasPi: boolean; }

export function geoAnswer(pair: Pair): GeoAnswer {
  switch (pair.op) {
    case "g-ra":  return { value: pair.a * pair.b, hasPi: false };
    case "g-rp":  return { value: 2 * (pair.a + pair.b), hasPi: false };
    case "g-ta":  return { value: (pair.a * pair.b) / 2, hasPi: false };
    case "g-tp":  return { value: pair.a + pair.b + (pair.c ?? 0), hasPi: false };
    case "g-ca-r": return { value: pair.a * pair.a, hasPi: true };
    case "g-ca-d": return { value: (pair.a / 2) * (pair.a / 2), hasPi: true };
    case "g-cc-r": return { value: 2 * pair.a, hasPi: true };
    case "g-cc-d": return { value: pair.a, hasPi: true };
    default: return { value: 0, hasPi: false };
  }
}

export interface Lesson {
  id: string;
  label: string;
  multipliers: number[];
  tag: string;
}

export type SessionMode = "initial" | "5min" | "3min" | "practice";

export const LESSONS: Lesson[] = [
  { id: "lesson-1", label: "Lesson 1", multipliers: [1, 2, 3],    tag: "1, 2, 3"    },
  { id: "lesson-2", label: "Lesson 2", multipliers: [4, 5, 6],    tag: "4, 5, 6"    },
  { id: "lesson-3", label: "Lesson 3", multipliers: [7, 8, 9],    tag: "7, 8, 9"    },
  { id: "lesson-4", label: "Lesson 4", multipliers: [10, 11, 12], tag: "10, 11, 12" },
];

export const DURATIONS: Record<SessionMode, number> = {
  "initial":  600, // 10 minutes
  "5min":     300, // 5 minutes
  "3min":     180, // 3 minutes
  "practice":   0, // untimed
};

// ─── Initial test queue ───────────────────────────────────────────────────────
// All 78 unique pairs across 1–12 (a ≤ b, no commutative duplicates).
// Ends when all 78 are answered or 10 minutes runs out.

export function buildInitialQueue(): Pair[] {
  const pairs: Pair[] = [];
  for (let a = 1; a <= 12; a++) {
    for (let b = a; b <= 12; b++) {
      pairs.push({ a, b });
    }
  }
  return shuffle(pairs);
}

// ─── Pre-test queue ───────────────────────────────────────────────────────────
// Unique pairs within the lesson group (a ≤ b when both are in the group).
// Ends when all are answered or 5 minutes runs out.

export function buildFiveMinQueue(lesson: Lesson): Pair[] {
  const inGroup = new Set(lesson.multipliers);
  const pairs: Pair[] = [];
  for (const a of lesson.multipliers) {
    for (let b = 1; b <= 12; b++) {
      if (inGroup.has(b) && b < a) continue; // skip commutative duplicate within group
      pairs.push({ a, b });
    }
  }
  return shuffle(pairs);
}

// ─── Learn queue (3-min, weighted) ────────────────────────────────────────────
// All 36 facts for the lesson (1×2 and 2×1 are separate).
// Weighted: missed facts appear more, mastered facts appear rarely.

export interface FactStat {
  a: number;
  b: number;
  timesCorrect: number;
  timesWrong: number;
  mastered: boolean;
}

function factWeight(stat: FactStat | undefined): number {
  if (stat?.mastered) return 1;           // mastered: rare retention check
  if (!stat) return 3;                    // unseen: moderate
  return Math.max(2, 3 + stat.timesWrong * 3 - stat.timesCorrect * 2);
}

function normKey(a: number, b: number): string {
  return a <= b ? `${a}x${b}` : `${b}x${a}`;
}


// Each fact appears exactly 4 times. Harder facts are sorted earlier in each
// pass so students drill weak spots first within each round.
export function buildLearnQueue(lesson: Lesson, stats: FactStat[]): Pair[] {
  const allPairs = factsForLesson(lesson);
  const statsMap = new Map<string, FactStat>();
  for (const s of stats) statsMap.set(`${s.a}x${s.b}`, s);

  const queue: Pair[] = [];
  for (let pass = 0; pass < 4; pass++) {
    // Sort by weight descending so harder facts come up first each pass,
    // then shuffle within equal-weight groups for variety
    const sorted = [...allPairs].sort((a, b) => {
      const wa = factWeight(statsMap.get(normKey(a.a, a.b)));
      const wb = factWeight(statsMap.get(normKey(b.a, b.b)));
      return wb - wa + (Math.random() - 0.5) * 0.5;
    });
    queue.push(...sorted);
  }
  return queue;
}

// Keep old name as alias for any remaining references
export function buildThreeMinQueue(lesson: Lesson, stats: FactStat[]): Pair[] {
  return buildLearnQueue(lesson, stats);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function factsForLesson(lesson: Lesson): Pair[] {
  const pairs: Pair[] = [];
  for (const a of lesson.multipliers) {
    for (let b = 1; b <= 12; b++) pairs.push({ a, b });
  }
  return pairs;
}

// ─── Geometry queue ───────────────────────────────────────────────────────────
// Mixes rect area/perim, triangle area/perim, and circle area/circumference
// (both radius and diameter variants for circles).

export function buildGeoQueue(): Pair[] {
  const pairs: Pair[] = [];

  // Rectangle: base 2–10, height ≥ base (avoid duplicates)
  for (let b = 2; b <= 10; b++) {
    for (let h = b; h <= 10; h++) {
      pairs.push({ a: b, b: h, op: "g-ra" });
      pairs.push({ a: b, b: h, op: "g-rp" });
    }
  }

  // Triangle area: base even 2–12 so ½bh is always an integer
  for (let b = 2; b <= 12; b += 2) {
    for (let h = 2; h <= 10; h++) {
      pairs.push({ a: b, b: h, op: "g-ta" });
    }
  }

  // Triangle perimeter: curated set of valid triangles
  const triSides: [number, number, number][] = [
    [3,4,5],[6,8,10],[9,12,15],[5,12,13],[8,15,17],
    [3,3,3],[4,4,4],[5,5,5],[6,6,6],[7,7,7],[8,8,8],
    [3,3,5],[4,4,6],[5,5,7],[5,5,8],[6,6,8],
    [3,4,6],[4,5,7],[5,6,8],[6,7,9],
  ];
  for (const [a, b, c] of triSides) pairs.push({ a, b, op: "g-tp", c });

  // Circles: radius and diameter, r = 1–12
  for (let r = 1; r <= 12; r++) {
    pairs.push({ a: r,     b: 0, op: "g-ca-r" });
    pairs.push({ a: r,     b: 0, op: "g-cc-r" });
    pairs.push({ a: r * 2, b: 0, op: "g-ca-d" });
    pairs.push({ a: r * 2, b: 0, op: "g-cc-d" });
  }

  return shuffle(pairs);
}

// 24 squares-and-roots facts: n² and √(n²) for n in 1–12, shuffled together.
export function buildSquaresAndRootsQueue(): Pair[] {
  const pairs: Pair[] = [];
  for (let n = 1; n <= 12; n++) {
    pairs.push({ a: n, b: n, op: "sq" });
    pairs.push({ a: n, b: n, op: "sqrt" });
  }
  return shuffle(pairs);
}

// All 144 division facts: (a×b) ÷ b = a for a,b in 1–12.
export function buildDivisionQueue(): Pair[] {
  const pairs: Pair[] = [];
  for (let a = 1; a <= 12; a++) {
    for (let b = 1; b <= 12; b++) {
      pairs.push({ a, b, op: "div" });
    }
  }
  return shuffle(pairs);
}

// 300 four-digit addition facts (sums in 1000–9999), using random addends.
// The pool is seeded deterministically so the same 300 facts are always available.
export function buildAdditionQueue(): Pair[] {
  // Simple seeded LCG so the pool is stable across calls
  let seed = 20250702;
  const rand = (min: number, max: number) => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return min + (seed % (max - min + 1));
  };

  const seen = new Set<string>();
  const pool: [number, number][] = [];

  while (pool.length < 300) {
    // Mix of ranges: 3+3, 4+3, 4+4 digits
    const kind = pool.length % 3;
    let a: number, b: number;
    if (kind === 0) {
      a = rand(100, 999); b = rand(100, 999);
    } else if (kind === 1) {
      a = rand(1000, 4999); b = rand(100, 999);
    } else {
      a = rand(1000, 4000); b = rand(1000, 4000);
    }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const sum = lo + hi;
    if (sum < 1000 || sum > 9999) continue;
    const key = `${lo}+${hi}`;
    if (!seen.has(key)) { seen.add(key); pool.push([lo, hi]); }
  }

  return shuffle(pool.map(([a, b]) => ({ a, b, op: "add" as const })));
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
