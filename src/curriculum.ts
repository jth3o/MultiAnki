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

export interface Pair {
  a: number;
  b: number;
  // undefined = multiplication; "div" = (a*b)÷b=a; "sq" = a²; "sqrt" = √(a²)=a; "add" = a+b; GeoOp = geometry
  op?: "div" | "sq" | "sqrt" | "add" | GeoOp;
  c?: number; // third side for triangle perimeter
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

// 300 four-digit addition facts (sums in 1000–9999).
export function buildAdditionQueue(): Pair[] {
  const pool: [number, number][] = [];
  const seen = new Set<string>();

  const tryAdd = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const sum = lo + hi;
    if (sum < 1000 || sum > 9999) return;
    const key = `${lo}+${hi}`;
    if (!seen.has(key)) { seen.add(key); pool.push([lo, hi]); }
  };

  // 3-digit addends (100–999, varied steps)
  const d3 = [100,125,150,175,200,225,250,275,300,325,350,375,400,425,450,475,
              500,525,550,575,600,625,650,675,700,725,750,775,800,825,850,875,900,925,950,975,999];
  // 4-digit addends (1000–4999)
  const d4 = [1000,1250,1500,1750,2000,2250,2500,2750,3000,3250,3500,3750,4000,4250,4500,4750,4999];

  // 3-digit + 3-digit with 4-digit sum
  for (let i = 0; i < d3.length; i++)
    for (let j = i; j < d3.length; j++)
      tryAdd(d3[i], d3[j]);

  // 4-digit + 3-digit
  for (const a of d4)
    for (const b of d3)
      tryAdd(a, b);

  // 4-digit + 4-digit
  for (let i = 0; i < d4.length; i++)
    for (let j = i; j < d4.length; j++)
      tryAdd(d4[i], d4[j]);

  return shuffle(pool).slice(0, 300).map(([a, b]) => ({ a, b, op: "add" as const }));
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
