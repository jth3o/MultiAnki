// ─────────────────────────────────────────────────────────────────────────────
// ADD STUDENT NAMES HERE
// One name per line, inside the array.
// Names are case-insensitive when students type them in.
// ─────────────────────────────────────────────────────────────────────────────

export const APPROVED_NAMES: string[] = [
  "James",
  "Davielle",
];

// ─────────────────────────────────────────────────────────────────────────────

export function isApproved(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return APPROVED_NAMES.some((name) => name.toLowerCase() === normalized);
}

export function normalizeName(input: string): string {
  const normalized = input.trim().toLowerCase();
  return (
    APPROVED_NAMES.find((name) => name.toLowerCase() === normalized) ??
    input.trim()
  );
}
