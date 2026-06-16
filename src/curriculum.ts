export interface Pair {
  a: number;
  b: number;
}

export interface Lesson {
  id: string;
  label: string;          // e.g. "Lesson 1"
  multipliers: number[];  // e.g. [1, 2, 3]
  tag: string;            // e.g. "1, 2, 3"
}

export const LESSONS: Lesson[] = [
  { id: "lesson-1", label: "Lesson 1", multipliers: [1, 2, 3],   tag: "1, 2, 3"   },
  { id: "lesson-2", label: "Lesson 2", multipliers: [4, 5, 6],   tag: "4, 5, 6"   },
  { id: "lesson-3", label: "Lesson 3", multipliers: [7, 8, 9],   tag: "7, 8, 9"   },
  { id: "lesson-4", label: "Lesson 4", multipliers: [10, 11, 12], tag: "10, 11, 12" },
];

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
