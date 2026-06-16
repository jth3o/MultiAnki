export interface Fact {
  a: number;
  b: number;
  timesSeen: number;
  timesCorrect: number;
}

export function buildFactSpace(): Fact[] {
  const facts: Fact[] = [];
  for (let a = 1; a <= 12; a++) {
    for (let b = 1; b <= 12; b++) {
      facts.push({ a, b, timesSeen: 0, timesCorrect: 0 });
    }
  }
  return facts;
}

// Weight: new/incorrect facts appear more often than well-known ones.
// Base weight is 10. Each correct answer reduces it by 1 (floor 1).
// Each incorrect bumps it back up by 3.
export function weight(fact: Fact): number {
  const base = 10;
  const correct = fact.timesCorrect;
  const wrong = fact.timesSeen - fact.timesCorrect;
  return Math.max(1, base - correct + wrong * 3);
}

export function pickFact(facts: Fact[]): Fact {
  const weights = facts.map(weight);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < facts.length; i++) {
    r -= weights[i];
    if (r <= 0) return facts[i];
  }
  return facts[facts.length - 1];
}

const STORAGE_KEY = "multianki_facts";

export function loadFacts(): Fact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Fact[];
  } catch {
    // ignore
  }
  return buildFactSpace();
}

export function saveFacts(facts: Fact[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(facts));
  } catch {
    // ignore
  }
}
