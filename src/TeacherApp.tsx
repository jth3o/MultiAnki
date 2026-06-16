import { useState, useEffect } from "react";
import {
  fetchTeacherStudents, fetchAllFactProgress, fetchAllFacts, fetchAllSessions,
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
}

function cellColor(stat: CellStat | undefined): string {
  if (!stat || stat.timesCorrect + stat.timesWrong === 0) return "#f3f4f6";
  if (stat.mastered) return "#16a34a";
  const acc = stat.timesCorrect / (stat.timesCorrect + stat.timesWrong);
  if (acc < 0.4) return "#fca5a5";
  if (acc < 0.7) return "#fde68a";
  return "#86efac";
}

function cellTextColor(stat: CellStat | undefined): string {
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

function buildStudentStats(
  facts: TeacherFactRecord[],
  progress: TeacherFactProgress[],
  studentName: string
): Map<string, CellStat> {
  const map = new Map<string, CellStat>();

  for (const f of facts.filter((f) => f.student_name === studentName)) {
    const key = normKey(f.a, f.b);
    if (!map.has(key)) map.set(key, { timesCorrect: 0, timesWrong: 0, mastered: false });
    const s = map.get(key)!;
    if (f.correct) s.timesCorrect++; else s.timesWrong++;
  }

  for (const p of progress.filter((p) => p.student_name === studentName)) {
    const key = normKey(p.a, p.b);
    if (!map.has(key)) map.set(key, { timesCorrect: 0, timesWrong: 0, mastered: false });
    map.get(key)!.mastered = p.mastered;
  }

  return map;
}

// Build class-wide stats (aggregate across all students)
function buildClassStats(
  facts: TeacherFactRecord[],
  progress: TeacherFactProgress[],
  students: string[]
): Map<string, CellStat> {
  // For class view: average accuracy + % mastered
  const totals = new Map<string, { correct: number; wrong: number; masteredCount: number }>();

  for (const f of facts) {
    const key = normKey(f.a, f.b);
    if (!totals.has(key)) totals.set(key, { correct: 0, wrong: 0, masteredCount: 0 });
    const t = totals.get(key)!;
    if (f.correct) t.correct++; else t.wrong++;
  }

  for (const p of progress) {
    const key = normKey(p.a, p.b);
    if (!totals.has(key)) totals.set(key, { correct: 0, wrong: 0, masteredCount: 0 });
    if (p.mastered) totals.get(key)!.masteredCount++;
  }

  const result = new Map<string, CellStat>();
  for (const [key, t] of totals) {
    const masteredByMost = t.masteredCount >= Math.ceil(students.length / 2);
    result.set(key, {
      timesCorrect: t.correct,
      timesWrong: t.wrong,
      mastered: masteredByMost,
    });
  }
  return result;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function Heatmap({ stats, title }: { stats: Map<string, CellStat>; title?: string }) {
  const [tooltip, setTooltip] = useState<{ a: number; b: number; stat: CellStat } | null>(null);

  return (
    <div className="heatmap-wrap">
      {title && <p className="heatmap-title">{title}</p>}
      <div className="heatmap-grid">
        {/* Column headers */}
        <div className="hm-corner" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="hm-header">{i + 1}</div>
        ))}
        {/* Rows */}
        {Array.from({ length: 12 }, (_, ai) => (
          <>
            <div key={`r${ai}`} className="hm-header">{ai + 1}</div>
            {Array.from({ length: 12 }, (_, bi) => {
              const a = ai + 1, b = bi + 1;
              const stat = stats.get(normKey(a, b));
              const total = stat ? stat.timesCorrect + stat.timesWrong : 0;
              return (
                <div
                  key={`${a}x${b}`}
                  className="hm-cell"
                  style={{ background: cellColor(stat), color: cellTextColor(stat) }}
                  onMouseEnter={() => stat && setTooltip({ a, b, stat })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {total > 0 ? `${a}×${b}` : ""}
                </div>
              );
            })}
          </>
        ))}
      </div>

      {tooltip && (
        <div className="hm-tooltip">
          <strong>{tooltip.a} × {tooltip.b}</strong>
          <span>{tooltip.stat.timesCorrect} correct / {tooltip.stat.timesCorrect + tooltip.stat.timesWrong} seen</span>
          {tooltip.stat.mastered && <span className="hm-mastered">✓ Mastered</span>}
        </div>
      )}

      <div className="hm-legend">
        <span><span className="legend-dot" style={{ background: "#f3f4f6" }} />Not seen</span>
        <span><span className="legend-dot" style={{ background: "#fca5a5" }} />Struggling</span>
        <span><span className="legend-dot" style={{ background: "#fde68a" }} />In progress</span>
        <span><span className="legend-dot" style={{ background: "#86efac" }} />Doing well</span>
        <span><span className="legend-dot" style={{ background: "#16a34a" }} />Mastered</span>
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
  const stats = buildStudentStats(facts, progress, student.name);
  const masteredCount = [...stats.values()].filter((s) => s.mastered).length;
  const totalSeen = [...stats.values()].filter((s) => s.timesCorrect + s.timesWrong > 0).length;
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

      <Heatmap stats={stats} title="Fact performance" />

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

  const classStats = buildClassStats(facts, progress, students.map((s) => s.name));

  return (
    <div className="teacher-shell">
      <header className="teacher-header">
        <span className="teacher-logo">MultiAnki — Teacher</span>
      </header>

      <Heatmap stats={classStats} title="Class overview — fact performance across all students" />

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
