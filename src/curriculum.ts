export interface Pair {
  a: number;
  b: number;
}

export interface Lesson {
  id: string;
  label: string;
  multipliers: number[];
  tag: string;
}

export type SessionMode = "initial" | "5min" | "3min";

export const LESSONS: Lesson[] = [
  { id: "lesson-1", label: "Lesson 1", multipliers: [1, 2, 3],    tag: "1, 2, 3"    },
  { id: "lesson-2", label: "Lesson 2", multipliers: [4, 5, 6],    tag: "4, 5, 6"    },
  { id: "lesson-3", label: "Lesson 3", multipliers: [7, 8, 9],    tag: "7, 8, 9"    },
  { id: "lesson-4", label: "Lesson 4", multipliers: [10, 11, 12], tag: "10, 11, 12" },
];

export const DURATIONS: Record<SessionMode, number> = {
  "initial": 600, // 10 minutes
  "5min":    300, // 5 minutes
  "3min":    180, // 3 minutes
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

function weightedPick(pairs: Pair[], stats: Map<string, FactStat>): Pair {
  const weights = pairs.map((p) => factWeight(stats.get(`${p.a}x${p.b}`)));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pairs.length; i++) {
    r -= weights[i];
    if (r <= 0) return pairs[i];
  }
  return pairs[pairs.length - 1];
}

export function buildThreeMinQueue(lesson: Lesson, stats: FactStat[]): Pair[] {
  const allPairs = factsForLesson(lesson);
  const statsMap = new Map<string, FactStat>();
  for (const s of stats) statsMap.set(`${s.a}x${s.b}`, s);
  const queue: Pair[] = [];
  for (let i = 0; i < 80; i++) queue.push(weightedPick(allPairs, statsMap));
  return queue;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function factsForLesson(lesson: Lesson): Pair[] {
  const pairs: Pair[] = [];
  for (const a of lesson.multipliers) {
    for (let b = 1; b <= 12; b++) pairs.push({ a, b });
  }
  return pairs;
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
