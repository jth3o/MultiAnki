import { createClient } from "@supabase/supabase-js";

// Normalize a pair so smaller number is always first (3×7, never 7×3)
function norm(a: number, b: number): { a: number; b: number } {
  return a <= b ? { a, b } : { a: b, b: a };
}

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

export async function fetchInitialTestDone(name: string): Promise<boolean> {
  const { data } = await supabase
    .from("students")
    .select("initial_test_done")
    .ilike("name", name.trim())
    .single();
  return data?.initial_test_done ?? false;
}

export async function markInitialTestDone(name: string): Promise<void> {
  await supabase
    .from("students")
    .update({ initial_test_done: true })
    .ilike("name", name.trim());
}

// ─── Facts ────────────────────────────────────────────────────────────────────

export async function logFact(payload: {
  student_name: string;
  lesson: string;
  session_mode: string;
  a: number;
  b: number;
  answer_given: number | null;
  correct: boolean;
  time_seconds: number | null;
}) {
  const { a, b } = norm(payload.a, payload.b);
  await supabase.from("facts").insert({ ...payload, a, b });
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
  mastered: boolean;
}

export async function fetchFactStats(
  student_name: string,
  lesson: string
): Promise<FactStatRow[]> {
  const [factsRes, progressRes] = await Promise.all([
    supabase.from("facts").select("a, b, correct").eq("student_name", student_name).eq("lesson", lesson),
    supabase.from("fact_progress").select("a, b, mastered").eq("student_name", student_name),
  ]);

  const masteryMap = new Map<string, boolean>();
  for (const row of progressRes.data ?? []) {
    masteryMap.set(`${row.a}x${row.b}`, row.mastered);
  }

  const map = new Map<string, FactStatRow>();
  for (const row of factsRes.data ?? []) {
    const key = `${row.a}x${row.b}`;
    if (!map.has(key)) map.set(key, { a: row.a, b: row.b, timesCorrect: 0, timesWrong: 0, mastered: masteryMap.get(key) ?? false });
    const s = map.get(key)!;
    if (row.correct) s.timesCorrect++;
    else s.timesWrong++;
  }
  return Array.from(map.values());
}

// ─── Fact progress (streak + mastery) ────────────────────────────────────────

// ─── Teacher queries ──────────────────────────────────────────────────────────

export interface TeacherStudent {
  name: string;
  created_at: string;
}

export interface TeacherFactProgress {
  student_name: string;
  a: number;
  b: number;
  consecutive_correct: number;
  mastered: boolean;
}

export interface TeacherFactRecord {
  student_name: string;
  a: number;
  b: number;
  correct: boolean;
  time_seconds: number | null;
  session_mode: string | null;
}

export interface TeacherSession {
  student_name: string;
  session_type: string;
  lesson: string;
  correct: number;
  total: number;
  created_at: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function fetchSetting(key: string, fallback: string): Promise<string> {
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? fallback;
}

export async function upsertSetting(key: string, value: string): Promise<void> {
  await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
}

export async function fetchTeacherStudents(): Promise<TeacherStudent[]> {
  const { data } = await supabase.from("students").select("name, created_at").order("name");
  return data ?? [];
}

export async function fetchAllFactProgress(): Promise<TeacherFactProgress[]> {
  const { data } = await supabase.from("fact_progress").select("*");
  return data ?? [];
}

export async function fetchAllFacts(): Promise<TeacherFactRecord[]> {
  const { data } = await supabase.from("facts").select("student_name, a, b, correct, time_seconds, session_mode");
  return data ?? [];
}

export async function fetchAllSessions(): Promise<TeacherSession[]> {
  const { data } = await supabase.from("sessions").select("*").order("created_at", { ascending: false });
  return data ?? [];
}

const MASTERY_THRESHOLD = 5;

export async function updateFactProgress(
  student_name: string,
  a: number,
  b: number,
  correct: boolean
): Promise<void> {
  const { a: na, b: nb } = norm(a, b);

  const { data } = await supabase
    .from("fact_progress")
    .select("consecutive_correct, mastered")
    .eq("student_name", student_name)
    .eq("a", na)
    .eq("b", nb)
    .maybeSingle();

  const prev = data?.consecutive_correct ?? 0;
  const newStreak = correct ? prev + 1 : 0;
  const mastered = newStreak >= MASTERY_THRESHOLD;

  await supabase.from("fact_progress").upsert(
    { student_name, a: na, b: nb, consecutive_correct: newStreak, mastered, updated_at: new Date().toISOString() },
    { onConflict: "student_name,a,b" }
  );
}
