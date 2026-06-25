import { useState, useEffect } from "react";
import {
  fetchTeacherStudents, fetchAllFactProgress, fetchAllFacts, fetchAllSessions,
  fetchSetting, upsertSetting,
  type TeacherStudent, type TeacherFactProgress, type TeacherFactRecord, type TeacherSession,
} from "./supabase";
import "./teacher.css";

// ─── Change this password ──────────────────────────────────────────────────────
const TEACHER_PASSWORD = "teacher123";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normKey(a: number, b: number) {
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
}

interface CellStat {
  timesCorrect: number;
  timesWrong: number;
  mastered: boolean;
  totalTime: number;   // sum of time_seconds
  timeCount: number;   // number of timed entries
}

function avgTime(stat: CellStat): number | null {
  return stat.timeCount > 0 ? Math.round(stat.totalTime / stat.timeCount) : null;
}

function cellColor(stat: CellStat | undefined, mode: "accuracy" | "time"): string {
  if (!stat || stat.timesCorrect + stat.timesWrong === 0) return "#f3f4f6";

  if (mode === "time") {
    const avg = avgTime(stat);
    if (avg === null) return "#f3f4f6";
    if (avg <= 3)  return "#16a34a"; // fast
    if (avg <= 6)  return "#86efac"; // ok
    if (avg <= 10) return "#fde68a"; // slow
    return "#fca5a5";                // very slow
  }

  if (stat.mastered) return "#16a34a";
  const acc = stat.timesCorrect / (stat.timesCorrect + stat.timesWrong);
  if (acc < 0.4) return "#fca5a5";
  if (acc < 0.7) return "#fde68a";
  return "#86efac";
}

function cellTextColor(stat: CellStat | undefined, mode: "accuracy" | "time"): string {
  if (mode === "time") {
    const avg = stat ? avgTime(stat) : null;
    return avg !== null && avg <= 3 ? "#fff" : "#374151";
  }
  if (stat?.mastered) return "#fff";
  return "#374151";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

// ─── Build per-student stats map ──────────────────────────────────────────────

function emptyCell(): CellStat {
  return { timesCorrect: 0, timesWrong: 0, mastered: false, totalTime: 0, timeCount: 0 };
}

function buildStudentStats(
  facts: TeacherFactRecord[],
  progress: TeacherFactProgress[],
  studentName: string
): Map<string, CellStat> {
  const map = new Map<string, CellStat>();

  for (const f of facts.filter((f) => f.student_name === studentName)) {
    const key = normKey(f.a, f.b);
    if (!map.has(key)) map.set(key, emptyCell());
    const s = map.get(key)!;
    if (f.correct) s.timesCorrect++; else s.timesWrong++;
    if (f.time_seconds != null) { s.totalTime += f.time_seconds; s.timeCount++; }
  }

  for (const p of progress.filter((p) => p.student_name === studentName)) {
    const key = normKey(p.a, p.b);
    if (!map.has(key)) map.set(key, emptyCell());
    map.get(key)!.mastered = p.mastered;
  }

  return map;
}

function buildClassStats(
  facts: TeacherFactRecord[],
  progress: TeacherFactProgress[],
  students: string[]
): Map<string, CellStat> {
  const totals = new Map<string, { correct: number; wrong: number; masteredCount: number; totalTime: number; timeCount: number }>();

  for (const f of facts) {
    const key = normKey(f.a, f.b);
    if (!totals.has(key)) totals.set(key, { correct: 0, wrong: 0, masteredCount: 0, totalTime: 0, timeCount: 0 });
    const t = totals.get(key)!;
    if (f.correct) t.correct++; else t.wrong++;
    if (f.time_seconds != null) { t.totalTime += f.time_seconds; t.timeCount++; }
  }

  for (const p of progress) {
    const key = normKey(p.a, p.b);
    if (!totals.has(key)) totals.set(key, { correct: 0, wrong: 0, masteredCount: 0, totalTime: 0, timeCount: 0 });
    if (p.mastered) totals.get(key)!.masteredCount++;
  }

  const result = new Map<string, CellStat>();
  for (const [key, t] of totals) {
    result.set(key, {
      timesCorrect: t.correct,
      timesWrong: t.wrong,
      mastered: t.masteredCount >= Math.ceil(students.length / 2),
      totalTime: t.totalTime,
      timeCount: t.timeCount,
    });
  }
  return result;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

type SessionFilter = "all" | "initial" | "5min" | "3min" | "quiz";

const SESSION_FILTERS: { key: SessionFilter; label: string; disabled?: boolean }[] = [
  { key: "all",     label: "All" },
  { key: "initial", label: "Initial test" },
  { key: "5min",    label: "Pre-test" },
  { key: "3min",    label: "Learn" },
  { key: "quiz",    label: "Quiz", disabled: true },
];

function Heatmap({ facts, progress, studentName, title }: {
  facts: TeacherFactRecord[];
  progress: TeacherFactProgress[];
  studentName?: string;
  title?: string;
}) {
  const [mode, setMode] = useState<"accuracy" | "time">("accuracy");
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [selected, setSelected] = useState<{ a: number; b: number; stat: CellStat } | null>(null);

  const filteredFacts = filter === "all"
    ? facts
    : facts.filter((f) => f.session_mode === filter);

  const stats = studentName
    ? buildStudentStats(filteredFacts, progress, studentName)
    : buildClassStats(filteredFacts, progress, [...new Set(facts.map((f) => f.student_name))]);

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-header">
        {title && <p className="heatmap-title">{title}</p>}
        <div className="hm-toggle">
          <button className={mode === "accuracy" ? "active" : ""} onClick={() => setMode("accuracy")}>Accuracy</button>
          <button className={mode === "time" ? "active" : ""} onClick={() => setMode("time")}>Time</button>
        </div>
      </div>

      <div className="hm-filters">
        {SESSION_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`hm-filter-pill ${filter === f.key ? "active" : ""}`}
            onClick={() => { if (!f.disabled) { setFilter(f.key); setSelected(null); } }}
            disabled={f.disabled}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="heatmap-grid">
        <div className="hm-corner" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="hm-header">{i + 1}</div>
        ))}
        {Array.from({ length: 12 }, (_, ai) => (
          <>
            <div key={`r${ai}`} className="hm-header">{ai + 1}</div>
            {Array.from({ length: 12 }, (_, bi) => {
              const a = ai + 1, b = bi + 1;
              const stat = stats.get(normKey(a, b));
              const total = stat ? stat.timesCorrect + stat.timesWrong : 0;
              const avg = stat ? avgTime(stat) : null;
              return (
                <div
                  key={`${a}x${b}`}
                  className="hm-cell"
                  style={{ background: cellColor(stat, mode), color: cellTextColor(stat, mode), cursor: total > 0 ? "pointer" : "default", outline: selected?.a === a && selected?.b === b ? "2px solid #2563eb" : "none" }}
                  onClick={() => stat && total > 0 && setSelected(selected?.a === a && selected?.b === b ? null : { a, b, stat })}
                >
                  {mode === "time" && avg !== null ? `${avg}s` : total > 0 ? `${a}×${b}` : ""}
                </div>
              );
            })}
          </>
        ))}
      </div>

      {selected && (
        <div className="hm-selected">
          <span className="hm-selected-fact">{selected.a} × {selected.b} = {selected.a * selected.b}</span>
          <span>{selected.stat.timesCorrect} correct / {selected.stat.timesCorrect + selected.stat.timesWrong} seen</span>
          {avgTime(selected.stat) !== null && <span>avg {avgTime(selected.stat)}s per answer</span>}
          {selected.stat.mastered && <span className="hm-mastered">✓ Mastered</span>}
          <button className="hm-close" onClick={() => setSelected(null)}>✕</button>
        </div>
      )}

      <div className="hm-legend">
        {mode === "accuracy" ? (
          <>
            <span><span className="legend-dot" style={{ background: "#f3f4f6" }} />Not seen</span>
            <span><span className="legend-dot" style={{ background: "#fca5a5" }} />Struggling</span>
            <span><span className="legend-dot" style={{ background: "#fde68a" }} />In progress</span>
            <span><span className="legend-dot" style={{ background: "#86efac" }} />Doing well</span>
            <span><span className="legend-dot" style={{ background: "#16a34a" }} />Mastered</span>
          </>
        ) : (
          <>
            <span><span className="legend-dot" style={{ background: "#f3f4f6" }} />Not seen</span>
            <span><span className="legend-dot" style={{ background: "#16a34a" }} />≤3s (fast)</span>
            <span><span className="legend-dot" style={{ background: "#86efac" }} />4–6s</span>
            <span><span className="legend-dot" style={{ background: "#fde68a" }} />7–10s</span>
            <span><span className="legend-dot" style={{ background: "#fca5a5" }} />&gt;10s (slow)</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Student detail ────────────────────────────────────────────────────────────

function StudentDetail({
  student, facts, progress, sessions, onBack,
}: {
  student: TeacherStudent;
  facts: TeacherFactRecord[];
  progress: TeacherFactProgress[];
  sessions: TeacherSession[];
  onBack: () => void;
}) {
  const allStats = buildStudentStats(facts, progress, student.name);
  const masteredCount = [...allStats.values()].filter((s) => s.mastered).length;
  const totalSeen = [...allStats.values()].filter((s) => s.timesCorrect + s.timesWrong > 0).length;
  const studentSessions = sessions.filter((s) => s.student_name === student.name).slice(0, 10);

  return (
    <div className="teacher-shell">
      <header className="teacher-header">
        <button className="btn-back-teacher" onClick={onBack}>← Students</button>
        <span className="teacher-logo">MultiAnki — Teacher</span>
      </header>

      <div className="detail-hero">
        <h1 className="detail-name">{student.name}</h1>
        <div className="detail-stats">
          <div className="detail-stat">
            <span className="ds-value">{masteredCount}</span>
            <span className="ds-label">Mastered</span>
          </div>
          <div className="detail-stat">
            <span className="ds-value">{totalSeen}</span>
            <span className="ds-label">Facts seen</span>
          </div>
          <div className="detail-stat">
            <span className="ds-value">{78 - totalSeen}</span>
            <span className="ds-label">Not yet seen</span>
          </div>
        </div>
      </div>

      <Heatmap facts={facts.filter(f => f.student_name === student.name)} progress={progress} studentName={student.name} title="Fact performance" />

      <div className="sessions-section">
        <p className="section-title">Recent sessions</p>
        {studentSessions.length === 0 ? (
          <p className="empty-state">No sessions yet.</p>
        ) : (
          <table className="sessions-table">
            <thead>
              <tr><th>When</th><th>Type</th><th>Lesson</th><th>Score</th></tr>
            </thead>
            <tbody>
              {studentSessions.map((s, i) => (
                <tr key={i}>
                  <td>{relativeTime(s.created_at)}</td>
                  <td className="capitalize">{s.session_type}</td>
                  <td>{s.lesson}</td>
                  <td>{s.correct} / {s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Session settings ─────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { label: "1 minute",  value: 60  },
  { label: "2 minutes", value: 120 },
  { label: "3 minutes", value: 180 },
  { label: "5 minutes", value: 300 },
  { label: "10 minutes",value: 600 },
];

function SessionSettings() {
  const [duration, setDuration]   = useState<number | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  useEffect(() => {
    fetchSetting("practice_duration_secs", "300").then((v) =>
      setDuration(parseInt(v, 10) || 300)
    );
  }, []);

  const handleChange = async (val: number) => {
    setDuration(val);
    setSaving(true);
    setSaved(false);
    await upsertSetting("practice_duration_secs", String(val));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (duration === null) return null;

  return (
    <div className="settings-section">
      <p className="section-title">Session settings</p>
      <div className="settings-row">
        <label className="settings-label">Practice session length</label>
        <select
          className="settings-select"
          value={duration}
          onChange={(e) => handleChange(Number(e.target.value))}
          disabled={saving}
        >
          {DURATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {saved && <span className="settings-saved">Saved</span>}
      </div>
      <p className="settings-hint">
        Students will finish a practice session after this amount of time — their current question completes first, then the session ends.
      </p>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({
  students, facts, progress, sessions,
}: {
  students: TeacherStudent[];
  facts: TeacherFactRecord[];
  progress: TeacherFactProgress[];
  sessions: TeacherSession[];
}) {
  const [selected, setSelected] = useState<TeacherStudent | null>(null);

  if (selected) {
    return (
      <StudentDetail
        student={selected}
        facts={facts}
        progress={progress}
        sessions={sessions}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="teacher-shell">
      <header className="teacher-header">
        <span className="teacher-logo">MultiAnki — Teacher</span>
      </header>

      <SessionSettings />

      <Heatmap facts={facts} progress={progress} title="Class overview — fact performance across all students" />

      <div className="students-section">
        <p className="section-title">Students</p>
        <table className="students-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Facts seen</th>
              <th>Mastered</th>
              <th>Last session</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const stats = buildStudentStats(facts, progress, student.name);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const mastered = [...stats.values()].filter((s) => s.mastered).length;
              const seen = [...stats.values()].filter((s) => s.timesCorrect + s.timesWrong > 0).length;
              const lastSession = sessions.find((s) => s.student_name === student.name);
              return (
                <tr key={student.name} className="student-row" onClick={() => setSelected(student)}>
                  <td className="student-name-cell">{student.name}</td>
                  <td>{seen} / 78</td>
                  <td>
                    <span className="mastery-pill">{mastered} / 78</span>
                  </td>
                  <td>{lastSession ? relativeTime(lastSession.created_at) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Teacher App ──────────────────────────────────────────────────────────────

export default function TeacherApp() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem("teacher_authed") === "true"
  );
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    students: TeacherStudent[];
    facts: TeacherFactRecord[];
    progress: TeacherFactProgress[];
    sessions: TeacherSession[];
  } | null>(null);

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    Promise.all([
      fetchTeacherStudents(),
      fetchAllFacts(),
      fetchAllFactProgress(),
      fetchAllSessions(),
    ]).then(([students, facts, progress, sessions]) => {
      setData({ students, facts, progress, sessions });
      setLoading(false);
    });
  }, [authed]);

  const attemptLogin = () => {
    if (pw === TEACHER_PASSWORD) {
      sessionStorage.setItem("teacher_authed", "true");
      setAuthed(true);
    } else {
      setPwError(true);
      setPw("");
    }
  };

  if (!authed) {
    return (
      <div className="teacher-gate">
        <div className="teacher-gate-card">
          <p className="teacher-gate-title">Teacher access</p>
          <input
            className="teacher-input"
            type="password"
            value={pw}
            placeholder="Password"
            onChange={(e) => { setPw(e.target.value); setPwError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") attemptLogin(); }}
            autoFocus
          />
          {pwError && <p className="teacher-gate-error">Incorrect password.</p>}
          <button className="teacher-btn" onClick={attemptLogin}>Enter</button>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="teacher-gate">
        <p className="teacher-loading">Loading data…</p>
      </div>
    );
  }

  return (
    <Dashboard
      students={data.students}
      facts={data.facts}
      progress={data.progress}
      sessions={data.sessions}
    />
  );
}
