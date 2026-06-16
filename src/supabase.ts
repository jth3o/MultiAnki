import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xftkfdzqfunmqwwbskll.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdGtmZHpxZnVubXF3d2Jza2xsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjcyNDUsImV4cCI6MjA5NzIwMzI0NX0.8b9u0NeY6ezvlE-T7vECewn0s8wa6_VSe4hatQe19O4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Students ─────────────────────────────────────────────────────────────────

export async function checkStudent(name: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .ilike("name", name.trim())
    .single();
  if (error) return false;
  return !!data;
}

// ─── Facts ────────────────────────────────────────────────────────────────────

export async function logFact(payload: {
  student_name: string;
  lesson: string;
  a: number;
  b: number;
  answer_given: number | null;
  correct: boolean;
}) {
  await supabase.from("facts").insert(payload);
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function logSession(payload: {
  student_name: string;
  session_type: string;
  lesson: string;
  correct: number;
  total: number;
}) {
  await supabase.from("sessions").insert(payload);
}

// ─── Mistakes (per student, across all devices) ───────────────────────────────

export async function fetchMistakes(student_name: string): Promise<{ a: number; b: number }[]> {
  const { data, error } = await supabase
    .from("facts")
    .select("a, b")
    .eq("student_name", student_name)
    .eq("correct", false);
  if (error || !data) return [];
  return data.map((r) => ({ a: r.a, b: r.b }));
}

// ─── Fact stats (for weighted 3-min queue) ────────────────────────────────────

export interface FactStatRow {
  a: number;
  b: number;
  timesCorrect: number;
  timesWrong: number;
}

export async function fetchFactStats(
  student_name: string,
  lesson: string
): Promise<FactStatRow[]> {
  const { data, error } = await supabase
    .from("facts")
    .select("a, b, correct")
    .eq("student_name", student_name)
    .eq("lesson", lesson);

  if (error || !data) return [];

  const map = new Map<string, FactStatRow>();
  for (const row of data) {
    const key = `${row.a}x${row.b}`;
    if (!map.has(key)) map.set(key, { a: row.a, b: row.b, timesCorrect: 0, timesWrong: 0 });
    const s = map.get(key)!;
    if (row.correct) s.timesCorrect++;
    else s.timesWrong++;
  }
  return Array.from(map.values());
}
