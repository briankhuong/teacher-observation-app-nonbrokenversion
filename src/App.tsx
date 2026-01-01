// src/App.tsx
import React, { useState, useEffect } from 'react';
import { DashboardShell } from "./DashboardShell";
import { SCHOOL_MASTER_LIST } from "./schoolMaster";
import { ObservationWorkspaceShell } from "./ObservationWorkspaceShell";
import { TeachersScreen } from "./TeachersScreen";
import { SchoolsScreen } from "./SchoolsScreen";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./supabaseClient";
import { TrainerSettingsModal } from "./components/TrainerSettingsModal";


// --- Types ---
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
  observationId?: string;
}

interface SelectedObservationMeta extends NewObservationMeta {
  id: string;
}

// --- Main App Component ---
const App: React.FC = () => {
  const { signOut } = useAuth();
  
  // Local state for session handling (The Login Fix)

  const [showNewObservationForm, setShowNewObservationForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [selectedObservation, setSelectedObservation] =
    useState<SelectedObservationMeta | null>(null);


// 1. AUTH & NETWORK LISTENERS
  const [isOnline, setIsOnline] = useState(navigator.onLine); // 🟢 New state
  const [session, setSession] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false); // 🟢 NEW
  
  useEffect(() => {
    // --- Auth Logic ---
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // --- 🟢 NEW: Warm-up Logic (Fixes OCR Cold Start) ---
// --- 🟢 NEW: Warm-up Logic (Fixes OCR Cold Start) ---
    const warmUpServices = async () => {
      try {
        const MERGE_SERVER_BASE = import.meta.env.VITE_MERGE_SERVER_BASE;
        if (MERGE_SERVER_BASE) {
          // 🟢 UPDATED: Pointing to the Gemini route
          // Using "HEAD" is a lightweight way to wake the server without sending data
          fetch(`${MERGE_SERVER_BASE}/api/ocr-gemini`, { method: "HEAD" }).catch(() => {});
          console.log("🚀 Gemini OCR Server warm-up signaled...");
        }
      } catch (e) {
        // Silently fail, it's just a background optimization
      }
    };
    warmUpServices();

    // --- Network Logic (Fixes the "sticky" badge) ---
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);



  const goToDashboard = () => setScreen("dashboard");
  const goToTeachers = () => setScreen("teachers");
  const goToSchools = () => setScreen("schools");

  const handleCreateObservationFromForm = (meta: NewObservationMeta) => {
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

// 🟢 NEW: Calculate the trainer name for the Top Bar
  const trainerName = React.useMemo(() => {
    if (!session?.user) return null;
    const u = session.user;
    // Check Azure/Microsoft fields first, then custom, then fallback to email
    return (
      u.user_metadata?.full_name || 
      u.user_metadata?.name || 
      u.user_metadata?.display_name || 
      u.email
    );
  }, [session]);



  return (
    <div className="app-root">
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="app-title">GSVN • Trainer Webnotes</div>
        </div>

        <div className="top-bar-right">
        <span 
          className="badge" 
          onClick={() => {
            if (trainerName) setShowSettings(true);
          }}
          style={{ 
            cursor: trainerName ? 'pointer' : 'default',
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px' 
          }}
          title="Click to open Trainer Settings"
        >
          {trainerName ? `Trainer: ${trainerName}` : 'Not Signed In'}
          {trainerName && <span>⚙️</span>} {/* Optional: Visual cue */}
        </span>
        {/* 🟢 NEW: Offline/Online Indicator */}
          <span className={`badge ${isOnline ? 'badge-success' : 'badge-warning'}`}>
          {isOnline ? '🟢 Online' : '🟠 Offline Mode'}
          {/* 🟢 NEW: Sync Spinner */}
          {isSyncing && <span className="sync-spinner"> 🔄 Syncing...</span>}
        </span>
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
            isOnline={isOnline} // 🟢 Pass the state down as a prop
            isSyncing={isSyncing}       // 🟢 PASS DOWN
            setIsSyncing={setIsSyncing} // 🟢 PASS DOWN
          />
        )}

        {screen === "teachers" && <TeachersScreen />}

        {screen === "schools" && <SchoolsScreen />}
      </main>

      {showNewObservationForm && (
        <NewObservationForm
          onCancel={() => setShowNewObservationForm(false)}
          onCreate={handleCreateObservationFromForm}
          onOpenSchools={goToSchools}
        />
      )}
      <TrainerSettingsModal 
        open={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
};

// --- New Observation Form Interfaces ---
interface NewObservationFormProps {
  onCreate: (meta: NewObservationMeta) => void;
  onCancel: () => void;
  onOpenSchools: () => void;
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

// --- New Observation Form Component ---
// --- New Observation Form Component ---
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

  const [worksheetUrl, setWorksheetUrl] = useState("");
  const [autoCreatedTeacherMsg, setAutoCreatedTeacherMsg] = useState<string | null>(null);

  // --- NEW: Search State ---
  const [teacherSearchTerm, setTeacherSearchTerm] = useState("");

  // Data Loading State
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);

  // 1. Load teachers (Filtered by User ID)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadTeachers() {
      try {
        setTeachersLoading(true);
        setTeachersError(null);

        const { data, error } = await supabase
          .from("teachers")
          .select("id, name, email, school_name, campus, worksheet_url")
          .eq("trainer_id", user!.id)
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
    return () => { cancelled = true; };
  }, [user]);

  // 2. Load schools
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadSchools() {
      try {
        setSchoolsLoading(true);
        setSchoolsError(null);

        const { data, error } = await supabase
          .from("schools")
          .select("*")
          .eq("trainer_id", user!.id)
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
    return () => { cancelled = true; };
  }, [user]);

  // --- NEW: Filter Logic ---
  const filteredTeachers = React.useMemo(() => {
    if (!teacherSearchTerm) return teachers;
    const lower = teacherSearchTerm.toLowerCase();
    return teachers.filter(t => 
      t.name.toLowerCase().includes(lower) || 
      t.school_name.toLowerCase().includes(lower) ||
      t.campus.toLowerCase().includes(lower)
    );
  }, [teachers, teacherSearchTerm]);

  // Options Logic
  const schoolOptions = React.useMemo(() => {
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
    return SCHOOL_MASTER_LIST.filter((s) => s.schoolName === schoolName)
      .map((s) => s.campusName)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }, [schoolName, schools]);

  const handleSelectTeacher = (id: string) => {
    setSelectedTeacherId(id);
    setAutoCreatedTeacherMsg(null);
    // Clear search so the dropdown looks normal again (optional preference)
    // setTeacherSearchTerm(""); 

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
          console.error("[DB] create teacher error", error);
          alert("Could not create teacher in the database.");
          return;
        }

        teacherId = data.id;
        // Optimistically update list
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
        setAutoCreatedTeacherMsg(`New teacher saved: ${teacherName.trim()} — ${schoolName} (${campus})`);
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

    // 2) Build meta object
    const meta = {
      teacherName,
      schoolName,
      campus,
      unit,
      lesson,
      supportType,
      date,
    };

    // 3) Insert observation
    const { data: obs, error: obsError } = await supabase
      .from("observations")
      .insert({
        trainer_id: currentUser.id,
        teacher_id: teacherId,
        status: "draft",
        meta,
        indicators: [],
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

    // 4) Notify parent
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
          {/* Teacher Picker Section */}
          <div className="form-row">
            <label>Existing teacher (optional)</label>
            
            {/* --- NEW: Search Box --- */}
            <input 
              type="text" 
              className="input mb-2" 
              placeholder="🔍 Type name or school to filter..." 
              value={teacherSearchTerm}
              onChange={(e) => setTeacherSearchTerm(e.target.value)}
            />

            <select
              className="select"
              value={selectedTeacherId}
              onChange={(e) => handleSelectTeacher(e.target.value)}
              disabled={teachersLoading || !!teachersError}
            >
              <option value="">
                {teachersLoading
                  ? "Loading teachers…"
                  : filteredTeachers.length === 0 
                    ? "No matches found" 
                    : "Select teacher from list…"}
              </option>
              
              {/* --- UPDATED: Map over filteredTeachers --- */}
              {filteredTeachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.school_name} ({t.campus})
                </option>
              ))}
            </select>
            
            {teachersError && (
              <div className="field-error">
                Could not load teachers ({teachersError}). You can still type a new teacher below.
              </div>
            )}
            <div className="hint">
              Search and pick a teacher, or leave blank to create a new one below.
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

          <div className="form-row">
            <label>Worksheet link (optional)</label>
            <input
              className="input"
              type="url"
              value={worksheetUrl}
              onChange={(e) => setWorksheetUrl(e.target.value)}
              placeholder="Paste Excel / OneDrive link..."
            />
          </div>

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