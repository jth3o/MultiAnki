export interface Pair {
  a: number;
  b: number;
}

export type StageType = "timed" | "morning" | "afternoon";

export interface Stage {
  type: StageType;
  label: string;
  description: string;
  groupIndex: number | null; // null = all tables
}

// The four groups of multipliers students work through
export const GROUPS = [
  { multipliers: [1, 2, 3], label: "1, 2, 3" },
  { multipliers: [4, 5, 6], label: "4, 5, 6" },
  { multipliers: [7, 8, 9], label: "7, 8, 9" },
  { multipliers: [10, 11, 12], label: "10, 11, 12" },
];

// The full learning sequence, matching the schedule image
export const CURRICULUM: Stage[] = [
  {
    type: "timed",
    label: "100 Second Challenge",
    description: "Answer as many facts as you can in 100 seconds. This is just a baseline — don't worry about the score.",
    groupIndex: null,
  },
  {
    type: "morning",
    label: "Morning: 1, 2, 3",
    description: "Work through every fact for 1×, 2×, and 3×.",
    groupIndex: 0,
  },
  {
    type: "afternoon",
    label: "Afternoon: Mistakes",
    description: "Review the facts you missed this morning. Keep going until you get each one right.",
    groupIndex: 0,
  },
  {
    type: "morning",
    label: "Morning: 4, 5, 6",
    description: "Work through every fact for 4×, 5×, and 6×.",
    groupIndex: 1,
  },
  {
    type: "afternoon",
    label: "Afternoon: Mistakes",
    description: "Review the facts you missed this morning. Keep going until you get each one right.",
    groupIndex: 1,
  },
  {
    type: "morning",
    label: "Morning: 7, 8, 9",
    description: "Work through every fact for 7×, 8×, and 9×.",
    groupIndex: 2,
  },
  {
    type: "afternoon",
    label: "Afternoon: Mistakes",
    description: "Review the facts you missed this morning. Keep going until you get each one right.",
    groupIndex: 2,
  },
  {
    type: "morning",
    label: "Morning: 10, 11, 12",
    description: "Work through every fact for 10×, 11×, and 12×.",
    groupIndex: 3,
  },
  {
    type: "afternoon",
    label: "Afternoon: Mastery",
    description: "Review the facts you missed this morning. Keep going until you get each one right.",
    groupIndex: 3,
  },
  {
    type: "morning",
    label: "All Tables",
    description: "All 144 facts, 1×1 through 12×12.",
    groupIndex: null,
  },
  {
    type: "afternoon",
    label: "All Tables — Review",
    description: "Review any facts you missed this morning.",
    groupIndex: null,
  },
];

export function factsForGroup(groupIndex: number | null): Pair[] {
  const multipliers =
    groupIndex === null
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      : GROUPS[groupIndex].multipliers;

  const pairs: Pair[] = [];
  for (const a of multipliers) {
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
