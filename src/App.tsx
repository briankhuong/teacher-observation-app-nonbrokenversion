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
// src/App.tsx
import { get, set, keys, clear } from 'idb-keyval';
import { INITIAL_INDICATORS } from "./constants"; // 🟢 NEW (Correct)
// ... existing imports


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
  teacher_id?: string; 
  grapeseed_id?: string | null;
}

interface SelectedObservationMeta extends NewObservationMeta {
  id: string;
}

// --- Main App Component ---
const App: React.FC = () => {
  const { signOut } = useAuth();

// Inside src/App.tsx

const handleLogout = async () => {
  // 1. Check for unsynced data first
  const allKeys = await keys();
  const observationKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith('obs-v1-')
  );
  
  let unsyncedCount = 0;
  
  // Check each observation to see if it needs syncing
  for (const key of observationKeys) {
    const obs = await get(key);
    // If local update time is newer than last sync time, it's unsynced
    if (obs && obs.updatedAt > (obs.lastSync || 0)) {
      unsyncedCount++;
    }
  }

  // 2. If unsynced items exist, WARN the user aggressively
  if (unsyncedCount > 0) {
    const forceLogout = window.confirm(
      `⚠️ DANGER: You have ${unsyncedCount} unsynced observations!\n\n` +
      `If you sign out now, these will be PERMANENTLY LOST.\n\n` +
      `Are you sure you want to delete them and sign out?`
    );
    if (!forceLogout) return; // Stop! Don't logout.
  } else {
    // Normal confirmation if everything is safe
    if (!window.confirm("Are you sure you want to sign out?")) return;
  }

  try {
    await clear(); // Now it is safe(r) to wipe
    await signOut(); 
    window.location.reload(); 
  } catch (e) {
    console.error("Logout error:", e);
  }
};
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

          {/* 🟢 WITH THIS: */}
          <button className="btn-ghost" type="button" onClick={handleLogout}>
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
  grapeseed_id?: string | null;
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

  // --- Search State ---
  const [teacherSearchTerm, setTeacherSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Data Loading State
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teachersError, setTeachersError] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);

  // 1. Load teachers (Network First -> Cache Fallback)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadTeachers() {
      setTeachersLoading(true);
      let loadedData: TeacherOption[] = [];

      // A. Try Network First
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase
            .from("teachers")
            .select("id,grapeseed_id, name, email, school_name, campus, worksheet_url")
            .eq("trainer_id", user!.id)
            .order("name", { ascending: true });

          if (data && !error) {
            loadedData = data as TeacherOption[];
            await set('offline_teachers', loadedData); 
          }
        } catch (err) {
          console.warn("Network fetch failed, checking cache...");
        }
      }

      // B. If Network failed or yielded nothing (Offline), load from Cache
      if (loadedData.length === 0) {
        const cached = await get<TeacherOption[]>('offline_teachers');
        if (cached) {
          loadedData = cached;
        }
      }

      // C. Set State
      if (!cancelled) {
        setTeachers(loadedData);
        setTeachersLoading(false);
      }
    }

    loadTeachers();
    return () => { cancelled = true; };
  }, [user]);

useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadSchools() {
      setSchoolsLoading(true);
      setSchoolsError(null);
      
      let loadedData: SchoolRow[] = [];

      // A. Try Network First
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase
            .from("schools")
            .select("*")
            .eq("trainer_id", user!.id)
            .order("school_name", { ascending: true })
            .order("campus_name", { ascending: true });

          if (error) throw error;
          
          if (data) {
            loadedData = data as SchoolRow[];
            // Update cache silently
            // We cast to any because SchoolRow structure might differ slightly from what's expected in cache, 
            // but usually it matches enough for the dropdown.
            await set('offline_schools', loadedData); 
          }
        } catch (err: any) {
          console.warn("[NewObs] Network load failed, checking cache...", err);
          // If network error, we proceed to cache
        }
      }

      // B. If Network failed or yielded nothing (Offline), load from Cache
      if (loadedData.length === 0) {
        try {
          const cached = await get<SchoolRow[]>('offline_schools');
          if (cached && Array.isArray(cached)) {
            loadedData = cached;
            console.log("📱 Loaded schools from offline cache:", loadedData.length);
          }
        } catch (e) {
          console.warn("Failed to load offline schools", e);
        }
      }

      if (!cancelled) {
        setSchools(loadedData);
        setSchoolsLoading(false);
      }
    }

    loadSchools();
    return () => { cancelled = true; };
  }, [user]);

  // --- Filter Logic ---
  const teacherSuggestions = React.useMemo(() => {
    if (!teacherSearchTerm) return [];
    const lower = teacherSearchTerm.toLowerCase();
    return teachers
      .filter(t => t.name.toLowerCase().includes(lower))
      .slice(0, 5); // Limit to 5 for UI
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

  const handleSelectTeacher = (t: TeacherOption) => {
    setSelectedTeacherId(t.id);
    setTeacherName(t.name);
    setTeacherSearchTerm(t.name);
    setSchoolName(t.school_name);
    setCampus(t.campus);
    setWorksheetUrl(t.worksheet_url ?? "");
    setShowSuggestions(false);
    setAutoCreatedTeacherMsg(null);
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
    const newObsId = crypto.randomUUID(); 

    // ---------------------------------------------------------
    // 🌊 WATERFALL LOGIC: Determine finalTeacherId
    // ---------------------------------------------------------
    let finalTeacherId = selectedTeacherId;

    // LEVEL 2: Memory Fallback 
    if (!finalTeacherId) {
      const foundInState = teachers.find(
        (t) => t.name === teacherName.trim() && t.school_name === schoolName
      );
      if (foundInState) {
        console.log("🌊 Level 2: Found teacher in State Array");
        finalTeacherId = foundInState.id;
      }
    }

    // LEVEL 3: Disk Fallback (Async)
    if (!finalTeacherId) {
      try {
        const cachedTeachers = await get<TeacherOption[]>('offline_teachers');
        const foundInCache = cachedTeachers?.find(
          (t) => t.name === teacherName.trim() && t.school_name === schoolName
        );
        if (foundInCache) {
          console.log("🌊 Level 3: Found teacher in IndexedDB");
          finalTeacherId = foundInCache.id;
        }
      } catch (err) {
        console.warn("Waterfall Level 3 failed:", err);
      }
    }

    // LEVEL 4: Deterministic Generation (New Temp Teacher)
    if (!finalTeacherId) {
      if (navigator.onLine) {
        // ... (Online creation logic remains the same) ...
        try {
          const cleanUrl = worksheetUrl.trim() || null;
          const { data, error } = await supabase
            .from("teachers")
            .insert({
              trainer_id: currentUser.id,
              name: teacherName.trim(),
              school_name: schoolName,
              campus,
              worksheet_url: cleanUrl,
            })
            .select("id, worksheet_url")
            .single();

          if (error) throw error;
          finalTeacherId = data.id; 

          // Update local cache
          const newTeacherObj = {
             id: data.id,
             name: teacherName.trim(),
             email: null,
             school_name: schoolName,
             campus,
             worksheet_url: data.worksheet_url ?? null,
             grapeseed_id: null,
          };
          setTeachers((prev) => [...prev, newTeacherObj]);
        } catch (err) {
          alert("Unexpected error creating teacher online.");
          return;
        }
      } else {
        // Offline Creation
        console.log("🌊 Level 4: Generating Temp ID (Offline)");
        finalTeacherId = `temp-teacher-${Date.now()}`;
        
        const newTeacherObj = {
            id: finalTeacherId,
            name: teacherName.trim(),
            email: null,
            school_name: schoolName,
            campus,
            worksheet_url: worksheetUrl || null,
            grapeseed_id: null,
        };
        
        setTeachers((prev) => [...prev, newTeacherObj]);
        const currentCache = (await get<TeacherOption[]>('offline_teachers')) || [];
        await set('offline_teachers', [...currentCache, newTeacherObj]);
      }
    }
    // ---------------------------------------------------------

    // 🟢 CRITICAL FIX: Add teacher_id to meta so it survives the State Handover
const selectedTeacherObj = teachers.find(t => t.id === finalTeacherId);
const meta: NewObservationMeta = { 
        teacherName, 
        schoolName, 
        campus, 
        unit, 
        lesson, 
        supportType, 
        date,
        teacher_id: finalTeacherId, // 🟢 STAMP THE ID HERE
        grapeseed_id: selectedTeacherObj?.grapeseed_id
    };

if (!navigator.onLine) {
        const offlinePayload = {
            id: newObsId,
            teacher_id: finalTeacherId, 
            // 🟢 Pass the updated meta here
            meta: { ...meta, teacherWorkbookUrl: worksheetUrl || null }, 
            indicators: INITIAL_INDICATORS, 
            status: "draft",
            updatedAt: Date.now(),
            scratchpadText: "",
            lastSync: 0 
        };

        try {
            await set(`obs-v1-${newObsId}`, offlinePayload);
            // 🟢 This passes the meta (with ID) to the Workspace state
            onCreate({ observationId: newObsId, ...meta }); 
        } catch (err) {
            alert("Storage full or error.");
        }
        return;
    }

    // ONLINE SAVE LOGIC
    const { data: obs, error: obsError } = await supabase
      .from("observations")
      .insert({
        id: newObsId, 
        trainer_id: currentUser.id,
        teacher_id: finalTeacherId,
        status: "draft",
        meta, // Meta now includes teacher_id
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
      alert(`Could not save observation: ${obsError.message}`);
      return;
    }

    onCreate({ observationId: obs.id, ...meta });
  };

  // --- STYLES FOR DARK THEME ---
  const darkInputStyle = {
    background: '#2d3748', 
    color: 'white', 
    border: '1px solid #4a5568',
    width: '100%'
  };

  const darkLabelStyle = {
    color: '#cbd5e0', 
    display: 'block', 
    marginBottom: '6px', 
    fontSize: '0.9rem',
    fontWeight: 500
  };

  return (
    <div className="modal-backdrop" onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', // Darker backdrop
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
    }}>
      
      {/* 🌑 DARK + STICKY CONTAINER */}
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', width: '100%', maxWidth: '500px',
        background: '#1a202c', // Dark BG
        color: 'white', 
        borderRadius: '12px', overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>

        {/* HEADER */}
        <div className="modal-header" style={{ flexShrink: 0, borderBottom: '1px solid #2d3748', padding: '16px 20px' }}>
          <div className="modal-title" style={{ fontSize: '1.25rem', fontWeight: 600 }}>New observation</div>
          <button type="button" className="btn" onClick={onCancel} style={{ color: '#a0aec0', fontSize: '1.5rem', lineHeight: 1 }}>×</button>
        </div>

        {/* BODY */}
        <form id="create-obs-form" className="modal-body" onSubmit={handleSubmit} style={{ flexGrow: 1, overflowY: 'auto', padding: '20px' }}>
          
          {/* 🟢 TEACHER SEARCH (Combobox) */}
          <div className="form-row" style={{ position: 'relative', marginBottom: '20px' }}>
            <label style={darkLabelStyle}>Teacher Name</label>
            <input 
              type="text" 
              className="input" 
              placeholder="Search existing or type new name..." 
              value={teacherName} 
              onChange={(e) => {
                 setTeacherName(e.target.value);
                 setTeacherSearchTerm(e.target.value);
                 setShowSuggestions(true);
                 if (selectedTeacherId) setSelectedTeacherId("");
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              style={darkInputStyle}
            />
            
            {/* 🟢 DARK DROPDOWN */}
            {showSuggestions && teacherSuggestions.length > 0 && (
               <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: '#2d3748', // Dark Dropdown BG
                  border: '1px solid #4a5568', // Dark Border
                  borderRadius: '0 0 6px 6px',
                  zIndex: 50, maxHeight: '200px', overflowY: 'auto',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
               }}>
                  {teacherSuggestions.map(t => (
                     <div key={t.id} 
                        onClick={() => handleSelectTeacher(t)}
                        style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #4a5568' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4a5568'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2d3748'}
                     >
                        <strong style={{ color: 'white' }}>{t.name}</strong> 
                        <div style={{ fontSize: '0.85em', color: '#a0aec0' }}>
                           {t.school_name} ({t.campus})
                        </div>
                     </div>
                  ))}
               </div>
            )}
            
            <div className="hint" style={{ marginTop: '6px', fontSize: '0.85em', color: '#a0aec0' }}>
               {selectedTeacherId 
                 ? "✅ Teacher selected from database." 
                 : "Typing a name that doesn't exist will create a new teacher."}
            </div>
          </div>

          <div className="form-row" style={{ marginBottom: '16px' }}>
            <label style={darkLabelStyle}>Worksheet link (optional)</label>
            <input
              className="input"
              type="url"
              value={worksheetUrl}
              onChange={(e) => setWorksheetUrl(e.target.value)}
              placeholder="Paste Excel / OneDrive link..."
              style={darkInputStyle}
            />
          </div>

          <div className="form-row" style={{ marginBottom: '16px' }}>
            <label style={darkLabelStyle}>School</label>
            <select
              className="select"
              value={schoolName}
              onChange={(e) => handleSchoolChange(e.target.value)}
              style={darkInputStyle}
            >
              <option value="">{schoolsLoading ? "Loading schools…" : "Select school…"}</option>
              {schoolOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
              <option value={ADD_NEW_SCHOOL_OPTION}>+ Add new school…</option>
            </select>
          </div>

          <div className="form-row" style={{ marginBottom: '16px' }}>
            <label style={darkLabelStyle}>Campus</label>
            <select
              className="select"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              disabled={!schoolName}
              style={{ ...darkInputStyle, opacity: !schoolName ? 0.5 : 1 }}
            >
              <option value="">Select campus…</option>
              {campusOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
             <div style={{ flex: 1 }}>
                <label style={darkLabelStyle}>Unit</label>
                <input className="input" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 5" style={darkInputStyle} />
             </div>
             <div style={{ flex: 1 }}>
                <label style={darkLabelStyle}>Lesson</label>
                <input className="input" type="text" value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="e.g. 3" style={darkInputStyle} />
             </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
             <div style={{ flex: 1 }}>
                <label style={darkLabelStyle}>Type</label>
                <select className="select" value={supportType} onChange={(e) => setSupportType(e.target.value as SupportType)} style={darkInputStyle}>
                  <option value="Visit">Visit</option>
                  <option value="LVA">LVA</option>
                  <option value="Training">Training</option>
                </select>
             </div>
             <div style={{ flex: 1 }}>
                <label style={darkLabelStyle}>Date</label>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={darkInputStyle} />
             </div>
          </div>
        </form>

        {/* 3. FOOTER */}
        <div className="modal-footer" style={{ 
            flexShrink: 0, padding: '16px', borderTop: '1px solid #2d3748', background: '#1a202c',
            display: 'flex', justifyContent: 'flex-end', gap: '10px'
        }}>
          <button type="button" className="btn" onClick={onCancel} style={{ background: '#4a5568', color: 'white', border: 'none' }}>
            Cancel
          </button>
          <button type="submit" form="create-obs-form" className="btn btn-primary" style={{ background: '#3182ce', color: 'white', border: 'none' }}>
            Create & open
          </button>
        </div>

      </div>
    </div>
  );
};
export default App;