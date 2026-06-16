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

export type SessionMode = "5min" | "3min";

export const LESSONS: Lesson[] = [
  { id: "lesson-1", label: "Lesson 1", multipliers: [1, 2, 3],    tag: "1, 2, 3"    },
  { id: "lesson-2", label: "Lesson 2", multipliers: [4, 5, 6],    tag: "4, 5, 6"    },
  { id: "lesson-3", label: "Lesson 3", multipliers: [7, 8, 9],    tag: "7, 8, 9"    },
  { id: "lesson-4", label: "Lesson 4", multipliers: [10, 11, 12], tag: "10, 11, 12" },
];

export const DURATIONS: Record<SessionMode, number> = {
  "5min": 300,
  "3min": 180,
};

// ─── 5-minute queue ───────────────────────────────────────────────────────────
// Deduplicates commutative pairs WITHIN the group.
// 1×2 and 2×1 are both in Lesson 1, so only one appears.
// 1×5 is kept because 5 is not in the group multipliers.

export function buildFiveMinQueue(lesson: Lesson): Pair[] {
  const inGroup = new Set(lesson.multipliers);
  const pairs: Pair[] = [];
  for (const a of lesson.multipliers) {
    for (let b = 1; b <= 12; b++) {
      // Skip if the commutative partner is already included
      if (inGroup.has(b) && b < a) continue;
      pairs.push({ a, b });
    }
  }
  return shuffle(pairs);
}

// ─── 3-minute queue ───────────────────────────────────────────────────────────
// All 36 facts for the lesson (1×2 and 2×1 are separate).
// Weighted by mistake history: missed facts appear more often,
// well-known facts appear occasionally for retention.

export interface FactStat {
  a: number;
  b: number;
  timesCorrect: number;
  timesWrong: number;
}

function factWeight(stat: FactStat | undefined): number {
  if (!stat) return 3; // unseen — moderate chance
  const { timesCorrect, timesWrong } = stat;
  // Struggling facts get high weight; well-known facts fade to 1 (retention only)
  return Math.max(1, 3 + timesWrong * 3 - timesCorrect * 2);
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

  // Pre-generate enough questions for 3 minutes (~5s each = ~36 questions).
  // Generate 80 to be safe; the timer ends the session.
  const queue: Pair[] = [];
  for (let i = 0; i < 80; i++) {
    queue.push(weightedPick(allPairs, statsMap));
  }
  return queue;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function factsForLesson(lesson: Lesson): Pair[] {
  const pairs: Pair[] = [];
  for (const a of lesson.multipliers) {
    for (let b = 1; b <= 12; b++) {
      pairs.push({ a, b });
    }
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
