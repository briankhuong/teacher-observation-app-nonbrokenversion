// src/App.tsx
import React, { useState } from "react";
import { DashboardShell } from "./DashboardShell";
import { SCHOOL_MASTER_LIST } from "./schoolMaster";
import { ObservationWorkspaceShell } from "./ObservationWorkspaceShell";
import { TeachersScreen } from "./TeachersScreen";
import { SchoolsScreen } from "./SchoolsScreen";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./supabaseClient";

type Screen = "dashboard" | "workspace" | "teachers" | "schools";
type SupportType = "Training" | "LVA" | "Visit";

interface NewObservationMeta {
  teacherName: string;
  schoolName: string;
  campus: string;
  unit: string;
  lesson: string;
  supportType: SupportType;
  date: string; // "YYYY-MM-DD"
  // 🔹 for newly created obs we also pass the Supabase id back up
  observationId?: string;
}

interface SelectedObservationMeta extends NewObservationMeta {
  id: string;
}

// (You don't actually use MOCK_OBS anymore, so you could delete this if you like)
const MOCK_OBS: SelectedObservationMeta = {
  id: "demo-1",
  teacherName: "Daisy Nguyen",
  schoolName: "VSK Sunshine",
  campus: "Campus A",
  unit: "3",
  lesson: "2", 
  supportType: "LVA",
  date: new Date().toISOString().slice(0, 10),
};

const App: React.FC = () => {
  const { signOut } = useAuth();
  const [showNewObservationForm, setShowNewObservationForm] = useState(false);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [selectedObservation, setSelectedObservation] =
    useState<SelectedObservationMeta | null>(null);

  const goToDashboard = () => setScreen("dashboard");
  const goToTeachers = () => setScreen("teachers");
  const goToSchools = () => setScreen("schools");

  const handleCreateObservationFromForm = (meta: NewObservationMeta) => {
    // Prefer the real Supabase id, but keep a fallback just in case
    const id = meta.observationId ?? `obs-${Date.now()}`;

    const fullMeta: SelectedObservationMeta = {
      id,
      ...meta,
    };

    setSelectedObservation(fullMeta);
    setShowNewObservationForm(false);
    setScreen("workspace");
  };

  const openObservation = (obs: any) => {
    const withDate: SelectedObservationMeta = {
      id: obs.id,
      teacherName: obs.teacherName,
      schoolName: obs.schoolName,
      campus: obs.campus,
      unit: obs.unit,
      lesson: obs.lesson,
      supportType: obs.supportType,
      date: obs.date || new Date().toISOString().slice(0, 10),
    };
    setSelectedObservation(withDate);
    setScreen("workspace");
  };

  return (
    <div className="app-root">
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="app-title">WebNotes • Teacher Observation</div>
        </div>

        <div className="top-bar-right">
          <span className="badge">Trainer: Brian</span>

          <button className="btn-ghost" onClick={goToDashboard}>
            Dashboard
          </button>

          <button className="btn-ghost" onClick={goToTeachers}>
            Teachers
          </button>

          <button className="btn-ghost" onClick={goToSchools}>
            Schools
          </button>

          <button className="btn-ghost" type="button" onClick={signOut}>
            Sign out
          </button>

          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setShowNewObservationForm(true)}
          >
            New Observation
          </button>
        </div>
      </header>

      <main className="app-shell">
        {screen === "dashboard" && (
          <DashboardShell onOpenObservation={openObservation} />
        )}

        {screen === "workspace" && selectedObservation && (
          <ObservationWorkspaceShell
            observationMeta={selectedObservation}
            onBack={goToDashboard}
          />
        )}

        {screen === "teachers" && <TeachersScreen />}

        {screen === "schools" && <SchoolsScreen />}
      </main>

      {showNewObservationForm && (
        <NewObservationForm
          onCancel={() => setShowNewObservationForm(false)}
          onCreate={handleCreateObservationFromForm}
          onOpenSchools={goToSchools} // 🔹 new: let the form jump to Schools tab
        />
      )}
    </div>
  );
};

interface NewObservationFormProps {
  onCreate: (meta: NewObservationMeta) => void;
  onCancel: () => void;
  onOpenSchools: () => void; // 🔹 NEW
}

interface TeacherOption {
  id: string;
  name: string;
  email: string | null;
  school_name: string;
  campus: string;
  worksheet_url: string | null;
}

interface SchoolRow {
  id: string;
  trainer_id: string;
  school_name: string;
  campus_name: string;
  am_name: string | null;
  am_email: string | null;
  admin_name: string | null;
  admin_email: string | null;
  admin_phone: string | null;
  address_line1: string | null;
  city: string | null;
}

const ADD_NEW_SCHOOL_OPTION = "__ADD_NEW_SCHOOL__";

const NewObservationForm: React.FC<NewObservationFormProps> = ({
  onCreate,
  onCancel,
  onOpenSchools,
}) => {
  const todayISO = new Date().toISOString().slice(0, 10);
  const { user } = useAuth();

  const [teacherName, setTeacherName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [campus, setCampus] = useState("");
  const [unit, setUnit] = useState("");
  const [lesson, setLesson] = useState("");
  const [supportType, setSupportType] = useState<SupportType>("Visit");
  const [date, setDate] = useState<string>(todayISO);

  // Worksheet link used when auto-creating a teacher
  const [worksheetUrl, setWorksheetUrl] = useState("");

  // Hint when we auto-create a teacher
  const [autoCreatedTeacherMsg, setAutoCreatedTeacherMsg] = useState<
    string | null
  >(null);

  // ---- Teachers for dropdown ----
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  // ---- Schools for dropdowns ----
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);

  // Load teachers for this trainer
  React.useEffect(() => {
    let cancelled = false;

    async function loadTeachers() {
      try {
        setTeachersLoading(true);
        setTeachersError(null);

        const { data, error } = await supabase
          .from("teachers")
          .select("id, name, email, school_name, campus, worksheet_url")
          .order("name", { ascending: true });

        if (error) {
          console.error("[DB] load teachers error", error);
          if (!cancelled) setTeachersError(error.message);
          return;
        }

        if (!cancelled && data) {
          setTeachers(data as TeacherOption[]);
        }
      } finally {
        if (!cancelled) setTeachersLoading(false);
      }
    }

    loadTeachers();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load schools for this trainer
  React.useEffect(() => {
    if (!user) return;

    const currentUser = user;
    let cancelled = false;

    async function loadSchools() {
      try {
        setSchoolsLoading(true);
        setSchoolsError(null);

        const { data, error } = await supabase
          .from("schools")
          .select(
            "*"
          )
          .eq("trainer_id", currentUser.id)
          .order("school_name", { ascending: true })
          .order("campus_name", { ascending: true });

        if (error) {
          console.error("[DB] load schools error", error);
          if (!cancelled) setSchoolsError(error.message);
          return;
        }

        if (!cancelled && data) {
          setSchools(data as SchoolRow[]);
        }
      } finally {
        if (!cancelled) setSchoolsLoading(false);
      }
    }

    loadSchools();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // ---- Options for School & Campus ----

  const schoolOptions = React.useMemo(() => {
    // Prefer dynamic schools; fall back to SCHOOL_MASTER_LIST if none
    const names = (schools.length
      ? schools.map((s) => s.school_name)
      : SCHOOL_MASTER_LIST.map((s) => s.schoolName)
    ).filter(Boolean);

    return Array.from(new Set(names)).sort();
  }, [schools]);

  const campusOptions = React.useMemo(() => {
    if (!schoolName) return [];

    if (schools.length) {
      const campuses = schools
        .filter((s) => s.school_name === schoolName)
        .map((s) => s.campus_name)
        .filter(Boolean);

      return Array.from(new Set(campuses));
    }

    // Fallback: static master list
    return SCHOOL_MASTER_LIST.filter((s) => s.schoolName === schoolName)
      .map((s) => s.campusName)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }, [schoolName, schools]);

  const handleSelectTeacher = (id: string) => {
    setSelectedTeacherId(id);
    setAutoCreatedTeacherMsg(null); // clear old hint when switching teacher

    if (!id) return;

    const t = teachers.find((x) => x.id === id);
    if (!t) return;

    setTeacherName(t.name);
    setSchoolName(t.school_name);
    setCampus(t.campus);
    setWorksheetUrl(t.worksheet_url ?? "");
  };

  const handleSchoolChange = (value: string) => {
    if (value === ADD_NEW_SCHOOL_OPTION) {
      // Jump out to full Schools screen so you can create full metadata
      onCancel();
      onOpenSchools();
      return;
    }

    setSchoolName(value);
    setCampus("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!teacherName || !schoolName || !campus || !unit || !lesson || !date) {
    alert("Please fill teacher, school, campus, unit, lesson, and date.");
    return;
  }

  if (!user) {
    alert("Missing user session – please sign out and sign in again.");
    return;
  }

  const currentUser = user as any;
  let teacherId = selectedTeacherId;
  setAutoCreatedTeacherMsg(null);

  // 1) If no teacher selected, create one
  if (!teacherId) {
    try {
      const cleanUrl = worksheetUrl.trim() || null;

      const { data, error } = await supabase
        .from("teachers")
        .insert({
          trainer_id: currentUser.id,
          name: teacherName.trim(),
          email: null,
          school_name: schoolName,
          campus,
          worksheet_url: cleanUrl,
        })
        .select("id, worksheet_url")
        .single();

      if (error) {
        console.error("[DB] create teacher from observation error", error);
        alert("Could not create teacher in the database.");
        return;
      }

      teacherId = data.id;

      setTeachers((prev) => [
        ...prev,
        {
          id: data.id,
          name: teacherName.trim(),
          email: null,
          school_name: schoolName,
          campus,
          worksheet_url: data.worksheet_url ?? null,
        },
      ]);
      setSelectedTeacherId(data.id);
      setWorksheetUrl(data.worksheet_url ?? "");

      setAutoCreatedTeacherMsg(
        `New teacher saved: ${teacherName.trim()} — ${schoolName} (${campus})`
      );
    } catch (err) {
      console.error("[DB] unexpected error creating teacher", err);
      alert("Unexpected error creating teacher.");
      return;
    }
  }

  if (!teacherId) {
    alert("Could not determine teacher record. Please try again.");
    return;
  }

  // 2) Build meta object (UI blob)
  const meta = {
    teacherName,
    schoolName,
    campus,
    unit,
    lesson,
    supportType,
    date,
  };

  // 3) Insert observation (HYBRID: meta + mirrored columns)
  const { data: obs, error: obsError } = await supabase
    .from("observations")
    .insert({
      trainer_id: currentUser.id,
      teacher_id: teacherId,
      status: "draft",

      // UI blob
      meta,
      indicators: [],

      // For reporting / constraints: **mirror meta into real columns**
      teacher_name: meta.teacherName,
      school_name: meta.schoolName,
      campus: meta.campus,
      unit: meta.unit,
      lesson: meta.lesson,
      support_type: meta.supportType,
      observation_date: meta.date,
    })
    .select("id")
    .single();

  if (obsError) {
    console.error("[DB] create observation error", obsError);
    alert(`Could not save observation: ${obsError.message}`);
    return;
  }

  // 4) Notify parent with meta + new id
  onCreate({
    observationId: obs.id,
    ...meta,
  });
};

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <div className="modal-title">New observation</div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          {/* Existing teacher picker */}
          <div className="form-row">
            <label>Existing teacher (optional)</label>
            <select
              className="select"
              value={selectedTeacherId}
              onChange={(e) => handleSelectTeacher(e.target.value)}
              disabled={teachersLoading || !!teachersError}
            >
              <option value="">
                {teachersLoading
                  ? "Loading teachers…"
                  : "Select teacher from your list…"}
              </option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.school_name} ({t.campus})
                </option>
              ))}
            </select>
            {teachersError && (
              <div className="field-error">
                Could not load teachers ({teachersError}). You can still type a
                new teacher below.
              </div>
            )}
            <div className="hint">
              Pick an existing teacher, or leave this blank and type a new one.
            </div>
            {autoCreatedTeacherMsg && (
              <div className="hint">{autoCreatedTeacherMsg}</div>
            )}
          </div>

          <div className="form-row">
            <label>Teacher name</label>
            <input
              className="input"
              type="text"
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
            />
          </div>

          {/* Worksheet link for teacher */}
          <div className="form-row">
            <label>Worksheet link (optional)</label>
            <input
              className="input"
              type="url"
              value={worksheetUrl}
              onChange={(e) => setWorksheetUrl(e.target.value)}
              placeholder="Paste Excel / OneDrive link for this teacher…"
            />
            <div className="hint">
              Saved into the teacher record if a new teacher is created.
            </div>
          </div>

          {/* School / campus driven by Supabase schools */}
          <div className="form-row">
            <label>School</label>
            <select
              className="select"
              value={schoolName}
              onChange={(e) => handleSchoolChange(e.target.value)}
            >
              <option value="">
                {schoolsLoading ? "Loading schools…" : "Select school…"}
              </option>
              {schoolOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={ADD_NEW_SCHOOL_OPTION}>+ Add new school…</option>
            </select>
            {schoolsError && (
              <div className="field-error">
                Could not load schools ({schoolsError}). Falling back to the
                built-in list.
              </div>
            )}
          </div>

          <div className="form-row">
            <label>Campus</label>
            <select
              className="select"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              disabled={!schoolName}
            >
              <option value="">Select campus…</option>
              {campusOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Unit, lesson, support type, date */}
          <div className="form-row">
            <label>Unit</label>
            <input
              className="input"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. 5"
            />
          </div>

          <div className="form-row">
            <label>Lesson</label>
            <input
              className="input"
              type="text"
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              placeholder="e.g. 3"
            />
          </div>

          <div className="form-row">
            <label>Support type</label>
            <select
              className="select"
              value={supportType}
              onChange={(e) => setSupportType(e.target.value as SupportType)}
            >
              <option value="Visit">Visit</option>
              <option value="LVA">LVA</option>
              <option value="Training">Training</option>
            </select>
          </div>

          <div className="form-row">
            <label>Date</label>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create & open
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default App;