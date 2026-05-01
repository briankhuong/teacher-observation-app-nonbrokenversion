// src/TeachersScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthContext";
import ImportTeachersBtn from "./components/ImportTeachersBtn";
import { getGraphAccessToken } from "./msal/getGraphToken";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import type { ColumnDef, SortingState, ColumnResizeMode, VisibilityState, FilterFn } from "@tanstack/react-table";
import { Search, RefreshCw, Plus, Copy, ExternalLink, Check, Pencil } from "lucide-react";
import { flattenText } from "./utils/textUtils";

const MERGE_SERVER_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export interface TeacherRow {
  id: string;
  trainer_id: string;
  name: string;
  grapeseed_id: string | null; 
  latest_performance: string | null; // From CRM Sync
  teaching_issue: string[] | null;   // From CRM Sync
  email: string | null;
  school_name: string;
  status: string | null;    // 🟢 NEW FIELD
  is_active: boolean | null;// 🟢 NEW FIELD
  tags: string[] | null; // 🟢 ADDED THIS
  campus: string;
  worksheet_url: string | null;
  school_id: string | null;
  campus_id: string | null;
  teaching_model: string | null;
  year_count: number | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
  last_visit?: string | null;
}

type TeacherFormState = {
  name: string;
  email: string;
  school_name: string;
  campus: string;
  worksheet_url: string;
  school_id: string | null;
  campus_id: string | null;
  teaching_model: string;
  year_count: number | string;
};

const emptyForm: TeacherFormState = {
  name: "",
  email: "",
  school_name: "",
  campus: "",
  worksheet_url: "",
  school_id: null,
  campus_id: null,
  teaching_model: "",
  year_count: "",
};

interface TeacherFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: TeacherFormState;
  existingTeachers: TeacherRow[]; // Added for validation
  onCancel: () => void;
  // 🟢 UPDATED: Accepts optional token
  onSubmit: (values: TeacherFormState, autoCreateToken?: string) => Promise<void>;
}

interface TeacherViewModalProps {
  open: boolean;
  row: TeacherRow | null;
  onCancel: () => void;
  onEdit: (row: TeacherRow) => void;
  onDelete: (row: TeacherRow) => Promise<void>;
  onAcknowledge: (row: TeacherRow) => Promise<void>;
}

const TeacherViewModal: React.FC<TeacherViewModalProps> = ({
  open,
  row,
  onCancel,
  onEdit,
  onDelete,
  onAcknowledge,
}) => {
  const [supportHistory, setSupportHistory] = useState<any[]>([]);
  const [viewingObservation, setViewingObservation] = useState<any | null>(null);
  const [loadingObs, setLoadingObs] = useState(false);

useEffect(() => {
  if (open && row?.grapeseed_id) {
    const fetchHistory = async () => {
      setViewingObservation(null); 
      const { data, error } = await supabase
        .from('observations')
        .select(`
          id, 
          observation_date, 
          teacher_name, 
          school_name, 
          campus, 
          support_type, 
          performance_rating, 
          status, 
          meta,
          trainer_id
        `) // 🟢 Removed the join attempt and illegal comments
        .eq('grapeseed_id', row.grapeseed_id)
        .order('observation_date', { ascending: false });

      if (!error && data) setSupportHistory(data);
      if (error) console.error("Fetch Error:", error.message);
    };
    fetchHistory();
  } else {
    setSupportHistory([]);
  }
}, [open, row?.grapeseed_id]);

const { goodNotes, growthNotes } = useMemo(() => {
  const obsIndicators = viewingObservation?.indicators;

  if (!Array.isArray(obsIndicators)) return { goodNotes: "", growthNotes: "" };

  return {
    // 🟢 Filter for: good === true AND commentText has actual text
    goodNotes: obsIndicators
      .filter((i: any) => i.good === true && i.commentText && i.commentText.trim().length > 0)
      .map((i: any) => `• ${i.title}: ${i.commentText}`)
      .join('\n\n'),

    // 🔴 Filter for: growth === true AND commentText has actual text
    growthNotes: obsIndicators
      .filter((i: any) => i.growth === true && i.commentText && i.commentText.trim().length > 0)
      .map((i: any) => `• ${i.title}: ${i.commentText}`)
      .join('\n\n')
  };
}, [viewingObservation]);

  if (!open || !row) return null;
  
const handleOpenDeepDive = async (obsId: string) => {
    setLoadingObs(true);
    // 🟢 Fetch JUST the observation. This is 100% safe.
    const { data, error } = await supabase
      .from('observations')
      .select('*') 
      .eq('id', obsId)
      .single();
    
    if (error) {
      console.error("Deep Dive Error:", error.message);
    } else {
      setViewingObservation(data);
    }
    setLoadingObs(false);
};

  const handleOpenWorksheet = (r: TeacherRow) => {
    if (!r.worksheet_url) return;
    window.open(r.worksheet_url, "_blank", "noopener,noreferrer");
  };

  // Filter the indicators array for items with comments
// 🟢 Corrected with optional chaining to prevent crashes


  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">Teacher Profile</div>
          <button type="button" className="btn" onClick={onCancel}>×</button>
        </div>

        <div className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          
          {/* --- SECTION 1: CRM QUICK LOOK --- */}
          <div style={{ 
            padding: '12px', 
            background: 'rgba(239, 68, 68, 0.05)', 
            border: '1px solid rgba(239, 68, 68, 0.15)', 
            borderRadius: '10px',
            marginBottom: '16px' 
          }}>
            <label style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase' }}>
              Quick Look: Teaching Issues
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {row.teaching_issue && row.teaching_issue.length > 0 ? (
                row.teaching_issue.map((issue, idx) => (
                  <span key={idx} className="tag-pill" style={{ background: '#ef4444', color: 'white', border: 'none' }}>
                    {issue}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No recent issues flagged.</span>
              )}
            </div>
          </div>

{/* --- SECTION 2: BASIC INFO --- */}
          <div className="detail-row">
            <label>Full Name</label>
            <span style={{ fontWeight: 600 }}>{row.name}</span>
          </div>
          <div className="detail-row">
            <label>School Context</label>
            <span>{row.school_name} — {row.campus}</span>
          </div>
          <div className="detail-row">
            <label>Email</label>
            <span>{row.email || "—"}</span>
          </div>
          <div className="detail-row">
            <label>Teaching Profile</label>
            <span>
              {row.teaching_model || "No model set"} • {row.year_count !== null ? `${row.year_count} years exp.` : "Exp. unknown"}
            </span>
          </div>

          {/* --- SECTION 3: WORKBOOK LINK --- */}
          <div className="detail-row">
            <label>Worksheet Link</label>
            {row.worksheet_url ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" className="link-button" onClick={() => handleOpenWorksheet(row)}>
                  Open Worksheet
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Copy workbook link"
                  onClick={() => {
                    if (row.worksheet_url) navigator.clipboard.writeText(row.worksheet_url);
                  }}
                >
                  📋
                </button>
              </div>
            ) : (
              <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not set</span>
            )}
          </div>

          {/* --- SECTION 4: SUPPORT TIMELINE --- */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #334155', paddingTop: '16px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Support History (Cross-Trainer)
            </label>
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
{supportHistory.length > 0 ? supportHistory.map((obs) => (
  <div 
    key={obs.id}
    onClick={() => handleOpenDeepDive(obs.id)}
    style={{ 
      padding: '10px', 
      background: viewingObservation?.id === obs.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(30, 41, 59, 0.5)', 
      borderLeft: `3px solid ${
        obs.performance_rating === 'Thriving' ? '#22c55e' : 
        obs.performance_rating === 'Functioning' ? '#3b82f6' : 
        obs.performance_rating === 'Developing' ? '#ef4444' : '#475569'
      }`,
      borderRadius: '0 6px 6px 0',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      border: viewingObservation?.id === obs.id ? '1px solid #3b82f6' : '1px solid transparent'
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
      {/* 🟢 Corrected: Use flat column name from schema */}
      <strong style={{ color: '#f8fafc' }}>{obs.support_type || 'Visit'}</strong>
      <span style={{ color: 'var(--text-muted)' }}>
        {/* 🟢 Corrected: Matches observation_date in schema */}
        {obs.observation_date ? new Date(obs.observation_date).toLocaleDateString() : 'No date'}
      </span>
    </div>
    
    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
      By {obs.profiles?.display_name || 'Unknown Trainer'} @ {obs.school_name}
    </div>
    {/* 🟢 Corrected: Matches status column in schema */}
    {obs.status === 'draft' && (
      <div style={{ fontSize: '9px', color: '#fca5a5', marginTop: '4px', textTransform: 'uppercase', fontWeight: 700 }}>Draft</div>
    )}
  </div>
)) : (
  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No history found.</div>
)}
            </div>
          </div>

          {/* 🟢 ADD THIS SECTION below the Timeline map */}
{viewingObservation && (
  <div style={{ 
    marginTop: '16px', 
    padding: '16px', 
    background: '#0f172a', 
    borderRadius: '12px', 
    border: '1px solid #334155',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)'
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', color: '#3b82f6' }}>Visit Deep Dive</h4>
      <button className="btn-ghost" onClick={() => setViewingObservation(null)} style={{ padding: '0 4px' }}>×</button>
    </div>



{/* Good Points */}
<div style={{ marginBottom: '12px' }}>
  <label style={{ fontSize: '10px', color: '#22c55e', textTransform: 'uppercase', fontWeight: 700 }}>Good Points</label>
  <div style={{ fontSize: '12px', color: '#f8fafc', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
    {/* 🟢 Corrected: Show filtered notes instead of a missing property */}
    {goodNotes || "No specific notes recorded."}
  </div>
</div>

{/* Growth Areas */}
<div>
  <label style={{ fontSize: '10px', color: '#ef4444', textTransform: 'uppercase', fontWeight: 700 }}>Growth Areas</label>
  <div style={{ fontSize: '12px', color: '#f8fafc', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
    {/* 🟢 Corrected: Show filtered notes instead of a missing property */}
    {growthNotes || "No specific notes recorded."}
  </div>
</div>

<div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-muted)', borderTop: '1px solid #1e293b', paddingTop: '8px' }}>
  Notes by {viewingObservation?.profiles?.display_name || "Unknown Trainer"}
</div>

  </div>
)}

{loadingObs && <div className="entity-cell-sub" style={{ textAlign: 'center', marginTop: '10px' }}>Loading notes...</div>}

          {/* --- SECTION 5: SYSTEM INFO --- */}
          <div style={{ marginTop: '24px', opacity: 0.5, fontSize: '11px' }}>
            <div className="detail-row" style={{ border: 'none', padding: '2px 0' }}>
              <label>Created</label>
              <span>{new Date(row.created_at).toLocaleDateString()}</span>
            </div>
            <div className="detail-row" style={{ border: 'none', padding: '2px 0' }}>
              <label>Updated</label>
              <span>{new Date(row.updated_at).toLocaleDateString()}</span>
            </div>
          </div>

        </div>

<div className="modal-footer">
          {row.needs_review && (
            <button 
              type="button" 
              className="btn" 
              style={{ background: '#eab308', color: '#000', border: 'none', marginRight: 'auto', fontWeight: 600 }}
              onClick={() => onAcknowledge(row)}
            >
              ✨ Acknowledge
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(row)}>Edit</button>
          <button type="button" className="btn btn-ghost btn-danger" onClick={() => onDelete(row)}>Delete</button>
        </div>
      </div>
    </div>
  );
};

const TeacherFormModal: React.FC<TeacherFormModalProps> = ({
  open,
  mode,
  initial,
  existingTeachers,
  onCancel,
  onSubmit,
}) => {
  const { user } = useAuth();
  const [form, setForm] = useState<TeacherFormState>(initial ?? emptyForm);
  const [submitting, setSubmitting] = useState(false);
  
  // 🟢 NEW: Auto-create state
  const [autoCreate, setAutoCreate] = useState(false);

  // 🟢 NEW: Schools Data for Dropdowns
  const [schools, setSchools] = useState<{ id: string; school_name: string; campus_name: string; campus_id: string; }[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [lookupResults, setLookupResults] = useState<{ school_name: string; campus: string; worksheet_url: string }[]>([]);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "searching" | "no_match" | "found">("idle");


  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyForm);
      setSubmitting(false);
      setAutoCreate(false);
      setLookupResults([]);
      setLookupStatus("idle");
      loadSchools(); // 🟢 Load schools when modal opens

    }
  }, [open, initial]);

  // 🟢 Helper to fetch schools
  async function loadSchools() {
    if (!user) return;
    setLoadingSchools(true);
    const { data } = await supabase
      .from("schools")
      .select("id, school_name, campus_name, campus_id")
      .eq("trainer_id", user.id)
      .order("school_name", { ascending: true });
    
    if (data) setSchools(data);
    setLoadingSchools(false);
  }

  // 🟢 Memoized Lists for Dropdowns
  const uniqueSchoolNames = useMemo(() => {
    const names = schools.map(s => s.school_name).filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [schools]);

  const availableCampuses = useMemo(() => {
    if (!form.school_name) return [];
    const campuses = schools
      .filter(s => s.school_name === form.school_name)
      .map(s => s.campus_name)
      .filter(Boolean);
    return Array.from(new Set(campuses)).sort();
  }, [schools, form.school_name]);

  if (!open) return null;

  const handleChange =
    (field: keyof TeacherFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

// 🟢 NEW: Global Workbook Lookup Logic
const handleWorkbookLookup = async () => {
  if (!form.email.trim() || !user) return;

  setLookupStatus("searching");
  setLookupResults([]);

  const { data, error } = await supabase
    .from("teachers")
    .select("school_name, campus, worksheet_url")
    .eq("trainer_id", user.id)
    .eq("email", form.email.trim().toLowerCase())
    .not("worksheet_url", "is", null);

  if (error) {
    console.error("Lookup failed", error);
    setLookupStatus("idle");
    return;
  }

  if (!data || data.length === 0) {
    setLookupStatus("no_match");
  } else {
    // De-duplicate results by URL
    const uniqueResults = data.filter((v, i, a) => a.findIndex(t => t.worksheet_url === v.worksheet_url) === i);
    setLookupResults(uniqueResults);
    setLookupStatus("found");
  }
};

 const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!form.name.trim() || !form.school_name.trim() || !form.campus.trim()) {
      alert("Please fill in Teacher, School and Campus.");
      return;
    }

    if (mode === "create") {
        const isDuplicate = existingTeachers.some(t => 
          t.school_name.toLowerCase() === form.school_name.trim().toLowerCase() && 
          t.name.toLowerCase() === form.name.trim().toLowerCase()
        );
  
        if (isDuplicate) {
          alert(`⚠️ Name Conflict!\n\nA teacher named "${form.name}" already exists at "${form.school_name}".\n\nPlease use a distinct display name (e.g., "${form.name} B") to ensure they get their own workbook.`);
          return;
        }
    }

    setSubmitting(true);

    // 🟢 NEW: Resolve IDs from the Schools state array before proceeding
    const matchedSchool = schools.find(
      (s) => s.school_name === form.school_name && s.campus_name === form.campus
    );

    const finalFormState = {
      ...form,
      school_id: matchedSchool?.id || null,      // Internal UUID
      campus_id: matchedSchool?.campus_id || null // GS Text ID
    };

    let token: string | undefined = undefined;

    // 🟢 UPDATED: Get Token Logic
    // Allow getting token if autoCreate is checked, regardless of mode
    if (autoCreate) {
      try {
        token = await getGraphAccessToken();
      } catch (err: any) {
        console.error("Token error", err);
        const cont = window.confirm(`Could not sign in to Microsoft: ${err.message}\n\nSave teacher anyway (without workbook)?`);
        if (!cont) {
          setSubmitting(false);
          return;
        }
      }
    }

    try {
      // 🟢 Pass finalFormState (containing the resolved IDs) instead of just 'form'
      await onSubmit(finalFormState, token);
    } finally {
      setSubmitting(false);
    }
  };
  // Inside TeacherFormModal...
  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">
            {mode === "create" ? "Add teacher" : "Edit teacher"}
          </div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        {/* 🔴 FIX 1: Removed onSubmit={handleSubmit} because this is a DIV, not a form */}
        <div className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          <div className="form-row">
            <label>Teacher name *</label>
            <input
              className="input"
              type="text"
              value={form.name}
              onChange={handleChange("name")}
              placeholder="e.g. Hannah"
            />
          </div>

        <div className="form-row">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={handleChange("email")}
              placeholder="teacher@example.com"
            />
          </div>

          <div className="form-row">
            <label>Teaching Model</label>
            <select
              className="select"
              value={form.teaching_model}
              onChange={(e) => setForm(prev => ({ ...prev, teaching_model: e.target.value }))}
            >
              <option value="">-- Select Model --</option>
              <option value="Classic">Classic</option>
              <option value="Nexus">Nexus</option>
              <option value="Connect">Connect</option>
              <option value="LittleSEED">LittleSEED</option>
              <option value="Classic + Nexus">Classic + Nexus</option>
              <option value="Classic + Connect">Classic + Connect</option>
              <option value="Classic + LS">Classic + LS</option>
            </select>
          </div>

          <div className="form-row">
            <label>Years of Experience</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.5"
              value={form.year_count}
              onChange={(e) => setForm(prev => ({ ...prev, year_count: e.target.value }))}
              placeholder="e.g. 2.5"
            />
          </div>

          <div className="form-row">
            <label>School *</label>
            <select 
                className="select" 
                value={form.school_name} 
                onChange={(e) => {
                    setForm(prev => ({ ...prev, school_name: e.target.value, campus: "" }));
                }} 
                disabled={loadingSchools}
            >
              <option value="">{loadingSchools ? "Loading..." : "Select School..."}</option>
              {uniqueSchoolNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Campus *</label>
            {availableCampuses.length > 0 ? (
                <select 
                    className="select" 
                    value={form.campus} 
                    onChange={handleChange("campus")} 
                    disabled={!form.school_name}
                >
                    <option value="">Select Campus...</option>
                    {availableCampuses.map(c => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
            ) : (
                <input
                    className="input"
                    type="text"
                    value={form.campus}
                    onChange={handleChange("campus")}
                    placeholder={form.school_name ? "Enter campus name" : "Select a school first"}
                    disabled={!form.school_name}
                />
            )}
          </div>

          <div className="form-row">
  <label>Worksheet link</label>
  {(mode === 'create' || !initial?.worksheet_url) && (
     <div style={{marginBottom: '8px', display:'flex', alignItems:'center', gap:'8px'}}>
       <input 
         type="checkbox" 
         id="chk-auto" 
         checked={autoCreate} 
         onChange={(e) => setAutoCreate(e.target.checked)} 
         style={{width:'auto', margin:0}} 
       />
       <label htmlFor="chk-auto" style={{margin:0, fontWeight:600, color:'#2563eb', cursor:'pointer'}}>
         {mode === 'create' ? '✨ Auto-create Excel Workbook?' : '✨ Create missing workbook?'}
       </label>
     </div>
  )}

  {!autoCreate && (
      <div style={{ position: 'relative' }}>
        {/* 🟢 FIXED: Joined Magnifier Layout */}
        <div className="input-group">
          <input
            className="input"
            type="url"
            value={form.worksheet_url}
            onChange={handleChange("worksheet_url")}
            placeholder="Paste URL or search by email..."
          />
          <button
            type="button"
            className="btn-append"
            title="Search for existing workbook by email"
            disabled={!form.email.trim() || lookupStatus === "searching"}
            onClick={handleWorkbookLookup}
          >
            {lookupStatus === "searching" ? "..." : "🔍"}
          </button>
        </div>

        {/* 🟢 FIXED: Dark Themed No Match Message */}
        {lookupStatus === "no_match" && (
          <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span>No workbook found for this email.</span>
            <span style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }} onClick={() => setLookupStatus("idle")}>×</span>
          </div>
        )}

        {/* 🟢 FIXED: Dark Themed Result Picker */}
        {lookupStatus === "found" && (
          <div className="lookup-picker">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', padding: '0 4px' }}>
              <strong style={{ fontSize: '10px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
                Matches Found
              </strong>
              <span style={{ cursor: 'pointer', color: '#64748b' }} onClick={() => setLookupStatus("idle")}>×</span>
            </div>
            {lookupResults.map((res, i) => (
              <div 
                key={i} 
                className="lookup-item"
                onClick={() => {
                  setForm(prev => ({ ...prev, worksheet_url: res.worksheet_url }));
                  setLookupStatus("idle");
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{res.school_name}</div>
                <div style={{ fontSize: '11px', opacity: 0.6 }}>{res.campus}</div>
              </div>
            ))}
          </div>
        )}
      </div>
  )}
</div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            
            {/* 🔴 FIX 2: Changed type="button" and added onClick handler */}
            <button
              type="button" 
              className="btn btn-primary"
              onClick={() => handleSubmit()} 
              disabled={submitting}
            >
              {submitting
                ? mode === "create"
                  ? "Creating…"
                  : "Saving…"
                : mode === "create"
                ? "Create"
                : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// 🟢 NEW: Small helper component for copy feedback
const CopyButton = ({ text, size = 14 }: { text: string; size?: number }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).catch(err => console.error("Copy failed", err));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); // Revert after 2s
  };

  return (
    <button
      type="button"
      className="icon-button"
      title={copied ? "Copied!" : "Copy to clipboard"}
      onClick={handleCopy}
      style={{
        cursor: "pointer",
        background: "transparent",
        border: "none",
        padding: "4px",
        display: "flex",
        alignItems: "center",
        color: copied ? "#22c55e" : "var(--text-muted)", // Green when copied
        opacity: copied ? 1 : 0.7,
        transition: "all 0.2s ease"
      }}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
};
const fuzzyVietnameseFilter: FilterFn<TeacherRow> = (row, columnId, value) => {
  const itemValue = row.getValue(columnId);
  const searchTerm = flattenText(value);
  const targetValue = flattenText(String(itemValue || ""));

  return targetValue.includes(searchTerm);
};

// 🟢 NEW: Helper component for inline number editing to prevent DB spam
const InlineNumberInput = ({ 
  initialValue, 
  onSave 
}: { 
  initialValue: number | null, 
  onSave: (val: number | null) => void 
}) => {
  const [value, setValue] = useState(initialValue === null ? "" : initialValue.toString());

  // Sync state if initialValue changes externally
  useEffect(() => {
    setValue(initialValue === null ? "" : initialValue.toString());
  }, [initialValue]);

  const handleBlur = () => {
    const num = value === "" ? null : Number(value);
    if (num !== initialValue) onSave(num);
  };

  // 🟢 FIX: Added <HTMLInputElement> so TS knows .blur() exists
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="number"
      min="0"
      step="0.5"
      className="input"
      style={{ padding: '2px 6px', fontSize: '12px', width: '70px', height: '28px' }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()} // Prevent row click
      placeholder="Yrs"
    />
  );
};

export const TeachersScreen: React.FC = () => {
  const { user } = useAuth();

  const [rows, setRows] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  // 🟢 NEW: Background Task Tracking
  const [provisioningIds, setProvisioningIds] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<TeacherRow | null>(null);

  // NEW: View Modal state
  const [viewingRow, setViewingRow] = useState<TeacherRow | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);  
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'active' | 'mutual' | 'inactive'>('active');
  // 🟢 NEW: Secondary Filters (Performance & Month)
  const [filterPerformance, setFilterPerformance] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<string>(''); // Format: "YYYY-MM"

// 🟢 UPDATED: Multi-step Filter & Stats Engine
  const { filteredRows, counts, stats } = useMemo(() => {
    let activeCount = 0;
    let mutualCount = 0;
    let inactiveCount = 0;
    let newCount = 0;

    // Stats Counters
    const uniqueActiveTeacherNames = new Set<string>();
    let thriving = 0;
    let functioning = 0;
    let developing = 0;
    
    // 🟢 NEW Counters
    const modelCounts: Record<string, number> = {};
    let expBeginner = 0;
    let expIntermediate = 0;
    let expVeteran = 0;

    // STEP 1: Calculate Base Status & Counts (Global)
    const rowsWithStatus = rows.map((r) => {
      const tags = Array.isArray(r.tags) ? r.tags : [];
      const isInactive = tags.some(t => t.toLowerCase() === "inactive");
      const isMutual = tags.some(t => t !== "No tag" && t.toLowerCase() !== "inactive");
      
      let derivedStatus = 'active';
      if (r.needs_review) {
        newCount++;
        derivedStatus = 'new';
      } else if (isInactive) {
        inactiveCount++;
        derivedStatus = 'inactive';
      } else if (isMutual) {
        mutualCount++;
        derivedStatus = 'mutual';
      } else {
        activeCount++;
      }

      // STEP 1B: Aggregate Stats (Only for Active & Mutual teachers)
      if (!isInactive && !r.needs_review) {
        // Clean name for unique deduplication
        uniqueActiveTeacherNames.add(r.name.trim().toLowerCase());
        
        if (r.latest_performance === 'Thriving') thriving++;
        if (r.latest_performance === 'Functioning') functioning++;
        if (r.latest_performance === 'Developing') developing++;

        // 🟢 Track Teaching Models
        if (r.teaching_model) {
          modelCounts[r.teaching_model] = (modelCounts[r.teaching_model] || 0) + 1;
        }

        // 🟢 Track Experience
        if (r.year_count !== null) {
          if (r.year_count < 1) expBeginner++;
          else if (r.year_count < 3) expIntermediate++;
          else expVeteran++;
        }
      }

      return { ...r, _derivedStatus: derivedStatus };
    });

    // STEP 2: Filter by Status Tab
    let result = filterStatus === 'all'
      ? rowsWithStatus
      : rowsWithStatus.filter(r => r._derivedStatus === filterStatus);

    // STEP 3: Filter by Performance
    if (filterPerformance !== 'all') {
      result = result.filter(r => r.latest_performance === filterPerformance);
    }

    // STEP 4: Filter by Month (Last Visit)
    if (filterMonth) {
      result = result.filter(r => {
        if (!r.last_visit) return false; 
        const visitMonth = r.last_visit.substring(0, 7); 
        return visitMonth === filterMonth;
      });
    }

    // Calculate percentages based on total Active + Mutual
    const totalActiveForStats = activeCount + mutualCount;
    const getPct = (val: number) => totalActiveForStats > 0 ? Math.round((val / totalActiveForStats) * 100) : 0;

    // 🟢 Sort models by count descending
    const sortedModels = Object.entries(modelCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: getPct(count) }));

    return {
      filteredRows: result,
      counts: { 
        all: rows.length, 
        new: newCount,
        active: activeCount, 
        mutual: mutualCount, 
        inactive: inactiveCount 
      },
      stats: {
        uniqueActive: uniqueActiveTeacherNames.size,
        totalActiveForStats,
        thriving: { count: thriving, pct: getPct(thriving) },
        functioning: { count: functioning, pct: getPct(functioning) },
        developing: { count: developing, pct: getPct(developing) },
        models: sortedModels,
        experience: {
          beginner: { count: expBeginner, pct: getPct(expBeginner) },
          intermediate: { count: expIntermediate, pct: getPct(expIntermediate) },
          veteran: { count: expVeteran, pct: getPct(expVeteran) }
        }
      }
    };
  }, [rows, filterStatus, filterPerformance, filterMonth]);

  // TanStack Table State
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      const saved = localStorage.getItem("teachersColumnVisibility");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load teacher column visibility from local storage", e);
    }
    // Default hidden columns
    return {
      email: false,
      worksheet_url: false,
    };
  });
const [showColumnMenu, setShowColumnMenu] = useState(false); // For column visibility modal

const [sorting, setSorting] = useState<SortingState>([
    { id: "school_campus", desc: false }, // Custom ID for combined column
    { id: "name", desc: false },
  ]);

  // 🟢 NEW: Bulk Edit State
  const [isBulkEditMode, setIsBulkEditMode] = useState(false);

  // 🟢 NEW: Optimistic Auto-Save Handler
  const handleInlineUpdate = async (id: string, field: keyof TeacherRow, value: any) => {
    // 1. Optimistic UI update (Instant feedback)
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

    // 2. Background DB sync
    const { error } = await supabase
      .from("teachers")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("trainer_id", user?.id);

    if (error) {
      console.error(`Failed to update ${field}:`, error);
      alert(`Could not save ${field}. Please refresh and try again.`);
    }
  };

  // 🟢 NEW: Toggle Bulk Edit and adjust columns automatically
  const toggleBulkEdit = () => {
    setIsBulkEditMode(prev => {
      const nextMode = !prev;
      if (nextMode) {
        setColumnVisibility({
          email: true,
          teaching_issue: false,
          recent_support: false,
          worksheet_url: false,
          actions: false,
          teaching_model: true,
          year_count: true,
        });
      } else {
        setColumnVisibility({
          email: false,
          worksheet_url: false,
          teaching_model: false,
          year_count: false,
        });
      }
      return nextMode;
    });
  };

  // 🟢 MOVED: Acknowledge functions moved UP so columns can use them
  const handleAcknowledge = async (row: TeacherRow) => {
    const { error } = await supabase
      .from("teachers")
      .update({ needs_review: false })
      .eq("id", row.id)
      .eq("trainer_id", user?.id); // Safe fallback to user?.id

    if (error) {
      alert("Failed to acknowledge teacher.");
      return;
    }
    
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, needs_review: false } : r));
    
    if (viewingRow?.id === row.id) {
      setViewingRow({ ...row, needs_review: false });
    }
  };

  const handleAcknowledgeAll = async () => {
    const ok = window.confirm(`Are you sure you want to acknowledge all ${counts.new} new teachers? This will clear your inbox.`);
    if (!ok) return;

    const { error } = await supabase
      .from("teachers")
      .update({ needs_review: false })
      .eq("trainer_id", user?.id) // Safe fallback to user?.id
      .eq("needs_review", true);

    if (error) {
      alert("Failed to acknowledge teachers.");
      return;
    }

    setRows(prev => prev.map(r => ({ ...r, needs_review: false })));
    setFilterStatus('active');
  };

  // 🟢 NEW: Background Provisioning Logic
  const runBackgroundProvisioning = async (teacher: TeacherRow, token: string) => {
    try {
      setProvisioningIds(prev => new Set(prev).add(teacher.id));

      const resp = await fetch(`${MERGE_SERVER_BASE}/api/provision-teacher`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ teacherName: teacher.name, schoolName: teacher.school_name, trainerId: user?.id,teacherId: teacher.id })
      });
      const result = await resp.json();

      if (!result.ok) throw new Error(result.error || "Provisioning failed");

      const { error } = await supabase.from("teachers").update({ worksheet_url: result.workbookUrl }).eq("id", teacher.id);
      if (error) throw error;

      setRows(prev => prev.map(r => r.id === teacher.id ? { ...r, worksheet_url: result.workbookUrl } : r));

    } catch (err: any) {
      console.error("Background task failed", err);
      alert(`⚠️ Background task failed for ${teacher.name}: ${err.message}`);
    } finally {
      setProvisioningIds(prev => {
        const next = new Set(prev);
        next.delete(teacher.id);
        return next;
      });
    }
  };

  // Define Columns
  const columns = useMemo<ColumnDef<TeacherRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Teacher",
        cell: (info) => {
          const { tags } = info.row.original;
          const safeTags = Array.isArray(tags) ? tags : [];

          // 1. Detect Status
          const isInactive = safeTags.some(t => t.toLowerCase() === "inactive");
          const isNoTag = safeTags.includes("No tag");

          // 2. Detect Other Trainers (Mutual)
          // Filter out "Inactive" and "No tag" -> Whatever remains are Trainer Names
          const otherTrainers = safeTags.filter(
            t => t !== "No tag" && t.toLowerCase() !== "inactive"
          );
          const isMutual = otherTrainers.length > 0;

          return (
            <>
              <div className="entity-cell-main" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: '#ffffffff' }}>
                  {info.getValue() as string}
                </span>

                {/* BADGE: INACTIVE */}
                {isInactive && (
                  <span className="tag-pill tag-pill-inactive">Inactive</span>
                )}

                {/* BADGE: MUTUAL (Shows Names!) */}
                {isMutual && (
                  <span className="tag-pill tag-pill-mutual" title={`Also tagged by: ${otherTrainers.join(", ")}`}>
                    {otherTrainers.join(" & ")}
                  </span>
                )}

                {/* BADGE: NO TAG (Only show if active, otherwise redundant) */}
                {isNoTag && !isInactive && (
                  <span className="tag-pill tag-pill-notag" title="No trainer tags found in GrapeSEED">
                    No tag
                  </span>
                )}
              </div>
              <div className="entity-cell-sub">{info.row.original.email || "—"}</div>
            </>
          );
        },
        id: "name",
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: (info) => {
          const email = info.getValue() as string | null;
          if (!email) return <div className="entity-cell-main">—</div>;

          return (
            <div className="entity-cell-main" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{email}</span>
              {/* 🟢 UPDATED: Use Helper Component */}
              <CopyButton text={email} />
            </div>
          );
        },
        id: "email",
        minSize: 150,
        size: 200,
      },

      {
        id: "school_campus",
        header: "School & Campus",
        accessorFn: (row) => `${row.school_name} ${row.campus}`,
        cell: (info) => (
          <>
            <div className="entity-cell-main">{info.row.original.school_name}</div>
            <div className="entity-cell-sub">{info.row.original.campus}</div>
          </>
        ),
        minSize: 200,
        size: 300,
      },

// 🟢 NEW: Editable Teaching Model Column
      {
        accessorKey: "teaching_model",
        header: "Teaching Model",
        cell: (info) => {
          if (!isBulkEditMode) return <span className="entity-cell-sub">{info.getValue() as string || "—"}</span>;
          
          return (
            <select
              className="select"
              style={{ padding: '2px 6px', fontSize: '11px', width: '130px', height: '28px' }}
              value={(info.getValue() as string) || ""}
              onChange={(e) => handleInlineUpdate(info.row.original.id, "teaching_model", e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">-- Select --</option>
              <option value="Classic">Classic</option>
              <option value="Nexus">Nexus</option>
              <option value="Connect">Connect</option>
              <option value="LittleSEED">LittleSEED</option>
              <option value="Classic + Nexus">Classic + Nexus</option>
              <option value="Classic + Connect">Classic + Connect</option>
              <option value="Classic + LS">Classic + LS</option>
            </select>
          );
        },
        id: "teaching_model",
        minSize: 140,
        size: 150,
      },

      // 🟢 NEW: Editable Experience Column
      {
        accessorKey: "year_count",
        header: "Exp (Yrs)",
        cell: (info) => {
          if (!isBulkEditMode) return <span className="entity-cell-sub">{info.getValue() !== null ? info.getValue() as number : "—"}</span>;
          
          return (
            <InlineNumberInput 
              initialValue={info.getValue() as number | null} 
              onSave={(val) => handleInlineUpdate(info.row.original.id, "year_count", val)} 
            />
          );
        },
        id: "year_count",
        minSize: 80,
        size: 90,
      },

      // 🟢 UPDATED: Latest Performance Column (Now Editable)
      {
        accessorKey: "latest_performance",
        header: "Performance",
        cell: (info) => {
          const val = info.getValue() as string;
          
          // Bulk Edit Mode: Render a Dropdown
          if (isBulkEditMode) {
            return (
              <select
                className="select"
                style={{ padding: '2px 6px', fontSize: '11px', width: '110px', height: '28px' }}
                value={val || ""}
                onChange={(e) => handleInlineUpdate(info.row.original.id, "latest_performance", e.target.value)}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">-- Set Rating --</option>
                <option value="Thriving">Thriving</option>
                <option value="Functioning">Functioning</option>
                <option value="Developing">Developing</option>
              </select>
            );
          }

          // Normal Mode: Render the Badge
          if (!val) return <span className="entity-cell-sub">—</span>;
          const color = val === 'Thriving' ? '#22c55e' : val === 'Functioning' ? '#3b82f6' : '#ef4444';
          
          return (
            <span style={{ 
              padding: '2px 8px', 
              borderRadius: '12px', 
              fontSize: '11px', 
              fontWeight: 700, 
              border: `1px solid ${color}`, 
              color: color,
              background: `${color}10` // 10% opacity
            }}>
              {val}
            </span>
          );
        },
        id: "latest_performance",
        minSize: 110,
        size: 130,
      },

      // 🟢 ADD: Focus Area Chips Column (Quick Look)
      {
        accessorKey: "teaching_issue",
        header: "Issues",
        cell: (info) => {
          const issues = info.getValue() as string[] | null;
          if (!issues || issues.length === 0) return <span className="entity-cell-sub">No issues</span>;
          
          return (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {issues.slice(0, 2).map((issue, idx) => (
                <span key={idx} className="tag-pill" style={{ background: '#ef4444', color: 'white', border: 'none', fontSize: '10px' }}>
                  {issue}
                </span>
              ))}
              {issues.length > 2 && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{issues.length - 2}</span>}
            </div>
          );
        },
        id: "teaching_issue",
        minSize: 150,
        size: 200,
      },
      {
        id: "recent_support",
        header: "Latest Support",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div style={{ lineHeight: 1.2 }}>
              <div className="entity-cell-main" style={{ fontSize: '12px' }}>
                {/* 🟢 UPDATED: Use last_visit */}
                {row.last_visit ? new Date(row.last_visit).toLocaleDateString() : "No visits"}
              </div>
              <div className="entity-cell-sub" style={{ fontSize: '10px' }}>
                 {/* Optional: Show relative time or status */}
                 {row.last_visit ? "Recorded" : "—"}
              </div>
            </div>
          );
        },
        minSize: 120,
      },
      
{
        accessorKey: "worksheet_url",
        header: "Worksheet",
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          
          if (provisioningIds.has(row.id)) {
            return (
              <div style={{color: '#2563eb', display:'flex', alignItems:'center', gap:'6px', fontWeight:500}}>
                <span className="spinner-small"></span> Creating...
              </div>
            );
          }

          const url = info.getValue() as string | null;
          if (!url) return <span className="entity-cell-sub">Not set</span>;

          return (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                className="link-button"
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                <span>Open</span>
                <ExternalLink size={12} />
              </button>

              {/* 🟢 UPDATED: Use Helper Component */}
              <CopyButton text={url} />
            </div>
          );
        },
        id: "worksheet_url",
        minSize: 100,
        size: 140,
      },

      {
        id: "actions",
        header: () => (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span>Actions</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0 4px', fontSize: '18px', fontWeight: 'bold', lineHeight: 1 }}
              onClick={(e) => {
                e.stopPropagation(); // Prevent row click/view modal from opening
                setShowColumnMenu(prev => !prev);
              }}
              title={`Toggle Columns`}
            >
              +
            </button>
          </div>
        ),
        size: 100,
        minSize: 100,
        enableSorting: false,
enableResizing: false,
        cell: (info) => (
          <div
            className="table-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 🟢 NEW: Quick Inline Acknowledge Button */}
            {info.row.original.needs_review && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: '#eab308', fontSize: '14px', padding: '0 4px', marginRight: '4px' }}
                onClick={() => handleAcknowledge(info.row.original)}
                title="Acknowledge Teacher"
              >
                ✨
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => openEdit(info.row.original)}
            >
              Edit
            </button>
          </div>
        ),
      },
    ],
// 🟢 ADDED: handleAcknowledge to the dependency array
    [setShowColumnMenu, provisioningIds, handleAcknowledge, isBulkEditMode]
  );

const table = useReactTable({
    data: filteredRows,
    columns,
    state: {
      sorting,
      globalFilter: search, 
    },
    onSortingChange: setSorting,
    // 🟢 Register the custom filter here
    globalFilterFn: fuzzyVietnameseFilter, 
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });


  // Effect to persist column visibility
  useEffect(() => {
    try {
      localStorage.setItem("teachersColumnVisibility", JSON.stringify(columnVisibility));
    } catch (e) {
      console.error("Failed to save teacher column visibility to local storage", e);
    }
  }, [columnVisibility]);

  if (!user) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title">Teachers</div>
        </div>
        <div className="card-body">
          <p>You must be signed in to manage teachers.</p>
        </div>
      </div>
    );
  }

  const trainerId = user.id;

// Load teachers for this trainer
  useEffect(() => {
    let cancelled = false;

    async function loadTeachers() {
      try {
        setLoading(true);
        setLoadError(null);

        // 1. Fetch Teachers
        const { data: teachersData, error: teacherError } = await supabase
          .from("teachers")
          .select(`
            id,
            trainer_id,
            grapeseed_id,
            teaching_model,
            year_count,
            needs_review,
            latest_performance,
            teaching_issue,
            name,
            email,
            school_name,
            campus,
            school_id, 
            campus_id,
            worksheet_url,
            status,
            is_active,
            tags,
            created_at,
            updated_at
          `)
          .eq("trainer_id", trainerId) // Ensure we only get our teachers
          .order("school_name", { ascending: true })
          .order("campus", { ascending: true })
          .order("name", { ascending: true });

        if (teacherError) throw teacherError;

        if (!cancelled && teachersData) {
          // 2. Extract IDs for bulk fetch
          const grapeseedIds = teachersData
            .map(t => t.grapeseed_id)
            .filter(id => id); // Remove nulls

          // 3. Fetch Observation Dates (Slim Query)
          // Note: We fetch ALL dates for these teachers and calculate max in JS 
          // because joining/grouping in Supabase client is complex without a View.
          const { data: obsData } = await supabase
            .from("observations")
            .select("grapeseed_id, observation_date")
            .in("grapeseed_id", grapeseedIds)
            .order("observation_date", { ascending: false });

          // 4. Create Map: ID -> Latest Date
          const lastVisitMap = new Map<string, string>();
          if (obsData) {
            obsData.forEach(obs => {
              // Since we ordered by desc, the first one we see is the latest
              if (obs.grapeseed_id && !lastVisitMap.has(obs.grapeseed_id)) {
                lastVisitMap.set(obs.grapeseed_id, obs.observation_date);
              }
            });
          }

          // 5. Merge into Teacher Rows
          const mergedRows: TeacherRow[] = teachersData.map(t => ({
            ...t,
            last_visit: t.grapeseed_id ? lastVisitMap.get(t.grapeseed_id) || null : null
          }));

          setRows(mergedRows);
        }
      } catch (err: any) {
        console.error("[DB] load teachers error", err);
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (trainerId) loadTeachers();
    return () => {
      cancelled = true;
    };
  }, [trainerId, refreshKey]);

  const openCreate = () => {
    setFormMode("create");
    setEditingRow(null);
    setShowForm(true);
    setViewingRow(null);
    setShowViewModal(false);
  };

  const openView = (row: TeacherRow) => {
    setViewingRow(row);
    setShowViewModal(true);
    // Ensure form is closed
    setShowForm(false);
  }

  const openEdit = (row: TeacherRow) => {
    setFormMode("edit");
    setEditingRow(row);
    setShowForm(true);
    setViewingRow(null);
    setShowViewModal(false);
  };

  // Re-define openEdit for view modal usage (allows seamless transition)
const openEditFromView = (row: TeacherRow) => {
    setFormMode("edit");
    setEditingRow(row);
    setShowForm(true);
    // Close view modal
    setViewingRow(null);
    setShowViewModal(false);
  };


const handleDelete = async (row: TeacherRow) => {
    const ok = window.confirm(
      `Delete teacher "${row.name}"?\nThis cannot be undone.`
    );
    if (!ok) return;

    const { error } = await supabase
      .from("teachers")
      .delete()
      .eq("id", row.id)
      .eq("trainer_id", trainerId);

    if (error) {
      console.error("[DB] delete teacher error", error);
      alert("Could not delete teacher. Please try again.");
      return;
    }

    setRows((prev) => prev.filter((t) => t.id !== row.id));
    if (viewingRow?.id === row.id) {
      setViewingRow(null);
      setShowViewModal(false);
    }
};

const submitForm = async (values: TeacherFormState, autoCreateToken?: string) => {
    // --- CREATE CASE ---
    if (formMode === "create") {
      const { data, error } = await supabase
        .from("teachers")
        .insert({
          trainer_id: trainerId,
          name: values.name.trim(),
          email: values.email.trim() || null,
          school_name: values.school_name.trim(),
          campus: values.campus.trim(),
          worksheet_url: values.worksheet_url.trim() || null,
          school_id: values.school_id, 
          campus_id: values.campus_id, 
          teaching_model: values.teaching_model.trim() || null,
          year_count: values.year_count ? Number(values.year_count) : null,
          needs_review: true,
        })
        .select(
          `
          id,
          trainer_id,
          name,
          email,
          school_name,
          campus,
          worksheet_url,
          created_at,
          school_id,
          campus_id,
          updated_at,
          grapeseed_id,
          latest_performance,
          teaching_issue,
          tags,
          status,
          is_active
        `
        )
        .single();

      if (error) {
        console.error("[DB] create teacher error", error);
        alert("Could not create teacher. Please try again.");
        return;
      }

      const newRow = data as TeacherRow;
      setRows((prev) => [...prev, newRow]);
      openView(newRow); 
      setShowForm(false);

      if (autoCreateToken) {
        runBackgroundProvisioning(newRow, autoCreateToken);
      }
      return;
    }

    // --- UPDATE CASE ---
    if (!editingRow) return;

    const { data, error } = await supabase
      .from("teachers")
      .update({
        name: values.name.trim(),
        email: values.email.trim() || null,
        school_name: values.school_name.trim(),
        campus: values.campus.trim(),
        school_id: values.school_id, 
        campus_id: values.campus_id, 
        worksheet_url: values.worksheet_url.trim() || null,
        teaching_model: values.teaching_model.trim() || null,
        year_count: values.year_count ? Number(values.year_count) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingRow.id)
      .eq("trainer_id", trainerId)
      .select(
        `
        id,
        trainer_id,
        name,
        email,
        school_name,
        campus,
        worksheet_url,
        created_at,
        school_id,
        campus_id,
        updated_at,
        grapeseed_id,
        latest_performance,
        teaching_issue,
        tags,
        status,
        is_active
      `
      )
      .single();

    if (error) {
      console.error("[DB] update teacher error", error);
      alert("Could not save changes. Please try again.");
      return;
    }

    const updated = data as TeacherRow;
    setRows((prev) =>
      prev.map((r) => (r.id === editingRow.id ? updated : r))
    );

    if (autoCreateToken) {
        runBackgroundProvisioning(updated, autoCreateToken);
    }

    openView(updated); 
    setShowForm(false);
  };

  const formInitial: TeacherFormState | undefined =
    formMode === "edit" && editingRow
      ? {
          name: editingRow.name,
          email: editingRow.email ?? "",
          school_name: editingRow.school_name,
          campus: editingRow.campus,
          worksheet_url: editingRow.worksheet_url ?? "",
          school_id: editingRow.school_id ?? null,
          campus_id: editingRow.campus_id ?? null,
          teaching_model: editingRow.teaching_model ?? "",
          year_count: editingRow.year_count ?? "",
        }
      : undefined;

  const handleTestApi = async () => {
    try {
      // 1. Get Token
      console.log("🚀 Step 1: Getting Token...");
      const tokenResponse = await fetch(`${MERGE_SERVER_BASE}/api/get-grapeseed-token`, { method: "POST" });
      const { access_token } = await tokenResponse.json();

      // 2. Get Class List to find a Teacher ID
      console.log("🚀 Step 2: Fetching Class List...");
      const classResponse = await fetch(`${MERGE_SERVER_BASE}/api/get-grapeseed-classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: access_token }),
      });
      const classData = await classResponse.json();
      
      // Find a valid Teacher ID
      const sampleClass = classData.find((c: any) => c.teacherId);
      if (!sampleClass) throw new Error("No classes with teachers found.");

      const targetId = sampleClass.teacherId;
      console.log(`🎯 Found Teacher ID: ${targetId}`);

      // 3. 🕵️ THE PROBE: Try to fetch User Details
      // We are guessing the URL pattern here. This is common in API discovery.
      const probeUrl = `https://services.grapeseed.com/admin/v1/users/${targetId}`;
      
      console.log(`🚀 Step 3: Probing User Profile at ${probeUrl}...`);
      
      // We use the exact same headers as before
      const userResponse = await fetch(probeUrl, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${access_token}`,
            "x-gl-origin": "https://schools.grapeseed.com/", // Critical Header
            "Content-Type": "application/json"
        }
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        console.log("--- ✨ SUCCESS! FOUND USER DATA ✨ ---");
        console.log("Name:", userData.firstName, userData.lastName, userData.fullName);
        console.log("Email:", userData.email || userData.username || "❌ No Email Field");
        console.log("-------------------------------------");
        console.log("Full Object:", userData);
        alert(`Success! Found email: ${userData.email}`);
      } else {
        console.error(`❌ Probe Failed: ${userResponse.status}`);
        const errText = await userResponse.text();
        console.error("Error Details:", errText);
        alert("Probe failed. We need to find the correct API endpoint manually.");
      }

    } catch (error: any) {
      console.error("Test Failed:", error);
      alert(`Error: ${error.message}`);
    }
  };
const handleSync = async () => {
  if (!user?.id) {
    alert("User session not found. Please log in again.");
    return;
  }

  try {
    setLoading(true);

    /* 1️⃣ Get Grapeseed access token */
    const tokenResp = await fetch(
      `${MERGE_SERVER_BASE}/api/get-grapeseed-token`,
      { method: "POST" }
    );

    if (!tokenResp.ok) {
      throw new Error("Failed to communicate with Token Server");
    }

    const { access_token } = await tokenResp.json();
    if (!access_token) {
      throw new Error("No access token received from GrapeSEED");
    }

    /* 2️⃣ Run FULL sync (Server-Side) */
    console.log("🚀 Starting Teacher Sync...");

    const syncResp = await fetch(
      `${MERGE_SERVER_BASE}/api/sync-teachers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: access_token, 
          userId: user.id,     // Matches 'userId' extracted in syncRoute.js
        }),
      }
    );

    // Safety: Check if server returned HTML (common in Vercel/Server timeouts)
    const contentType = syncResp.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const textErr = await syncResp.text();
      console.error("Server Crash/Timeout Response:", textErr);
      throw new Error("Server returned a non-JSON response. Check backend logs.");
    }

    const result = await syncResp.json();

    if (!result.success) {
      throw new Error(result.error || "Unknown sync error");
    }

  /* 3️⃣ 🆕 RUN Year of Experience Sync */
    console.log("📅 Starting Year of Experience Sync...");
    const yearsResp = await fetch(`${MERGE_SERVER_BASE}/api/sync-years`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: access_token, userId: user.id }),
    });

    if (yearsResp.ok) {
      const yearsResult = await yearsResp.json();
      if (yearsResult.logs && Array.isArray(yearsResult.logs)) {
        console.groupCollapsed("📋 Year Sync Logs");
        yearsResult.logs.forEach((log: string) => console.log(log));
        console.groupEnd();
      }
    } else {
      console.warn("Year sync failed (non-blocking)");
    }

    /* 4️⃣ UI Refresh */
    // Trigger re-fetch of lists
    setRefreshKey((prev) => prev + 1);

    alert("✅ Teacher sync completed successfully!");

  } catch (error: any) {
    console.error("Sync Process Failed:", error);
    alert(`❌ Sync Failed: ${error.message || error}`);
  } finally {
    setLoading(false);
  }
};

  return (
    <>
      <div className="card">
      <div className="card-header tm-header-layout">
        <div className="tm-title-section">
          <div className="card-title">Teachers</div>
          <div className="card-subtitle">Manage your roster and workbooks.</div>
        </div>

        <div className="tm-toolbar-row">
          <div className="tm-search-wrapper">
            <Search size={14} strokeWidth={2} className="tm-search-icon-svg" />
            <input
              className="tm-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
            />
          </div>

      <div className="tm-actions-group">
{/* 🟢 NEW: Bulk Edit Toggle Button */}
            <button
              type="button"
              className={`btn ${isBulkEditMode ? 'btn-primary' : 'btn-ghost'}`}
              style={{ 
                fontWeight: 600, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px',
                border: isBulkEditMode ? undefined : '1px solid #475569', 
                borderRadius: '9999px', 
                padding: '4px 16px' 
              }}
              onClick={toggleBulkEdit}
            >
              {isBulkEditMode ? "Done Editing" : <><Pencil size={14} /> Bulk Edit</>}
            </button>
          <button 
              type="button" 
              className="tm-pure-icon" 
              onClick={handleSync}
              title="Sync with GrapeSEED"
            >
              <RefreshCw size={18} strokeWidth={2} />
            </button>



            <ImportTeachersBtn onUploadComplete={() => setRefreshKey(prev => prev + 1)} />

            <button
              type="button"
              className="tm-btn-primary"
              onClick={openCreate}
            >
              <Plus size={18} strokeWidth={2.5} style={{ marginRight: '6px' }} />
              New teacher
            </button>
          </div>
        </div>
      </div>

        <div className="card-body" style={{ position: "relative" }}>
          {loading && <div>Loading teachers…</div>}
          {loadError && (
            <div className="field-error">
              Could not load teachers ({loadError})
            </div>
          )}

          {/* STATE 1: Truly Empty DB (No data at all) */}
          {!loading && rows.length === 0 && !loadError && (
            <div className="empty-state">
              <p>No teachers yet.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreate}
              >
                Add your first teacher
              </button>
            </div>
          )}

{/* STATE 2: Data Exists (Show Filters regardless of search results) */}
          {!loading && rows.length > 0 && (
            <>
{/* 🟢 NEW: Teacher Stats Dashboard */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                <div className="stat-card" style={{ background: 'rgba(30, 41, 59, 0.4)', padding: '12px 16px', borderRadius: '8px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Active Headcount</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-main)' }}>{stats.totalActiveForStats}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({stats.uniqueActive} unique)</span>
                  </div>
                </div>
                
                <div className="stat-card" style={{ background: 'rgba(30, 41, 59, 0.4)', padding: '12px 16px', borderRadius: '8px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Performance</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '12px' }}><span style={{ color: '#22c55e', fontWeight: 700, display: 'inline-block', width: '24px' }}>{stats.thriving.count}</span> <span style={{ color: 'var(--text-muted)' }}>({stats.thriving.pct}%) Thriving</span></div>
                    <div style={{ fontSize: '12px' }}><span style={{ color: '#3b82f6', fontWeight: 700, display: 'inline-block', width: '24px' }}>{stats.functioning.count}</span> <span style={{ color: 'var(--text-muted)' }}>({stats.functioning.pct}%) Functioning</span></div>
                    <div style={{ fontSize: '12px' }}><span style={{ color: '#ef4444', fontWeight: 700, display: 'inline-block', width: '24px' }}>{stats.developing.count}</span> <span style={{ color: 'var(--text-muted)' }}>({stats.developing.pct}%) Developing</span></div>
                  </div>
                </div>

                <div className="stat-card" style={{ background: 'rgba(30, 41, 59, 0.4)', padding: '12px 16px', borderRadius: '8px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Top Models</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '56px', overflowY: 'auto' }}>
                    {stats.models.length > 0 ? stats.models.slice(0, 3).map(m => (
                      <div key={m.name} style={{ fontSize: '12px' }}>
                        <span style={{ fontWeight: 700, color: '#f8fafc', display: 'inline-block', width: '24px' }}>{m.count}</span> 
                        <span style={{ color: 'var(--text-muted)' }}>({m.pct}%) {m.name}</span>
                      </div>
                    )) : <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No models set</div>}
                  </div>
                </div>

                <div className="stat-card" style={{ background: 'rgba(30, 41, 59, 0.4)', padding: '12px 16px', borderRadius: '8px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Experience</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '12px' }}><span style={{ fontWeight: 700, color: '#f8fafc', display: 'inline-block', width: '24px' }}>{stats.experience.beginner.count}</span> <span style={{ color: 'var(--text-muted)' }}>({stats.experience.beginner.pct}%) &lt; 1 yr</span></div>
                    <div style={{ fontSize: '12px' }}><span style={{ fontWeight: 700, color: '#f8fafc', display: 'inline-block', width: '24px' }}>{stats.experience.intermediate.count}</span> <span style={{ color: 'var(--text-muted)' }}>({stats.experience.intermediate.pct}%) 1 - 3 yrs</span></div>
                    <div style={{ fontSize: '12px' }}><span style={{ fontWeight: 700, color: '#f8fafc', display: 'inline-block', width: '24px' }}>{stats.experience.veteran.count}</span> <span style={{ color: 'var(--text-muted)' }}>({stats.experience.veteran.pct}%) 3+ yrs</span></div>
                  </div>
                </div>
              </div>

              {/* 🟢 FIXED: Filters are now outside the table-row-length check */}
              
              {/* 1. Status Tabs */}
              <div className="filter-tabs-row">
                <button 
                  className={`filter-tab ${filterStatus === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterStatus('all')}
                >
                  All Teachers <span className="count-badge">{counts.all}</span>
                </button>
                
                <button 
                  className={`filter-tab ${filterStatus === 'new' ? 'active-yellow' : ''}`}
                  onClick={() => setFilterStatus('new')}
                >
                  Newly Added Teachers <span className="count-badge" style={{ background: counts.new > 0 ? '#eab308' : '#334155', color: counts.new > 0 ? '#000' : '#fff' }}>{counts.new}</span>
                </button>
                
                <button 
                  className={`filter-tab ${filterStatus === 'active' ? 'active-green' : ''}`}
                  onClick={() => setFilterStatus('active')}
                >
                  Active <span className="count-badge-color">{counts.active}</span>
                </button>

                <button 
                  className={`filter-tab ${filterStatus === 'mutual' ? 'active-blue' : ''}`}
                  onClick={() => setFilterStatus('mutual')}
                >
                  Mutual <span className="count-badge-color">{counts.mutual}</span>
                </button>

                <button 
                  className={`filter-tab ${filterStatus === 'inactive' ? 'active-red' : ''}`}
                  onClick={() => setFilterStatus('inactive')}
                >
                  Inactive <span className="count-badge-color">{counts.inactive}</span>
                </button>
              </div>

              {/* 2. Secondary Toolbar */}
              <div className="filter-secondary-row">
                <div className="filter-group">
                  <label>Performance:</label>
                  <select 
                    className="filter-select"
                    value={filterPerformance} 
                    onChange={(e) => setFilterPerformance(e.target.value)}
                  >
                    <option value="all">All Ratings</option>
                    <option value="Thriving">Thriving</option>
                    <option value="Functioning">Functioning</option>
                    <option value="Developing">Developing</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label>Last Visit:</label>
                  <input 
                    type="month" 
                    className="filter-input"
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                  />
                </div>

                {(filterPerformance !== 'all' || filterMonth !== '' || filterStatus !== 'active' || search !== '') && (
                <button 
                  className="btn-text-danger"
                  onClick={() => {
                    setFilterPerformance('all');
                    setFilterMonth('');
                    setFilterStatus('active');
                    setSearch(''); // 🟢 This ensures the table search is also cleared
                  }}
                  style={{ fontSize: '12px', marginLeft: 'auto' }}
                >
                  Clear Filters ×
                </button>
                )}
</div>

              {/* 🟢 NEW: Bulk Acknowledge Button (Only shows when in New Inbox) */}
              {filterStatus === 'new' && counts.new > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ background: '#eab308', color: '#000', border: 'none', fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                    onClick={handleAcknowledgeAll}
                  >
                    ✨ Acknowledge All ({counts.new})
                  </button>
                </div>
              )}

              {/* 3. Column Visibility Menu (Positioned Absolute) */}
              <div
                style={{
                  position: "absolute",
                  top: "1px",
                  right: "8px",
                  zIndex: 10,
                }}
              >
                {showColumnMenu && (
                  <div
                    className="modal-panel"
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      zIndex: 20,
                      marginTop: "8px",
                      padding: "10px",
                      width: "250px",
                      maxWidth: "none",
                    }}
                    onMouseLeave={() => setShowColumnMenu(false)}
                  >
                    <div className="modal-body" style={{ marginTop: 0, gap: "6px" }}>
                      {table.getAllLeafColumns().map((column) => (
                        column.id !== "actions" && (
                          <div key={column.id} className="form-row" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                            <label style={{ fontSize: "13px", color: "var(--text)" }}>
                              {typeof column.columnDef.header === 'string'
                                ? column.columnDef.header
                                : column.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                              }
                            </label>
                            <input
                              {...{
                                type: 'checkbox',
                                checked: column.getIsVisible(),
                                onChange: column.getToggleVisibilityHandler(),
                                style: { margin: 0, width: 'auto' }
                              }}
                            />
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 4. The Table OR No Matches Message */}
              {table.getRowModel().rows.length > 0 ? (
                <div className="table-wrapper">
                  <table className="simple-table">
                    <thead>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <th
                              key={header.id}
                              colSpan={header.colSpan}
                              style={{ width: header.getSize() }}
                              className={header.column.getCanSort() ? "sortable-header" : ""}
                            >
                              {header.isPlaceholder ? null : (
                                <div
                                  {...{
                                    className: header.column.getCanSort()
                                      ? "cursor-pointer select-none"
                                      : "",
                                    onClick: header.column.getToggleSortingHandler(),
                                  }}
                                >
                                  {flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
                                  )}
                                  {{
                                    asc: " ↑",
                                    desc: " ↓",
                                  }[header.column.getIsSorted() as string] ?? null}
                                </div>
                              )}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {table.getRowModel().rows.map((row) => {
                        const isActive = row.original.id === viewingRow?.id;
                        return (
                          <tr
                            key={row.id}
                            className={
                              "simple-table-row" +
                              (isActive ? " simple-table-row--active" : "")
                            }
                            onClick={() => openView(row.original)}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td
                                key={cell.id}
                                style={{ width: cell.column.getSize() }}
                              >
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* 🟢 NEW: No Matches State (Keeps filters visible) */
                <div style={{ 
                  textAlign: 'center', 
                  padding: '40px', 
                  color: 'var(--text-muted)',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '8px',
                  border: '1px dashed var(--border)'
                }}>
                   <p style={{ marginBottom: '12px' }}>No teachers found matching these filters.</p>
                   <button 
                     className="btn btn-ghost"
                     onClick={() => {
                        setFilterStatus('active');
                        setFilterPerformance('all');
                        setFilterMonth('');
                        setSearch('');
                     }}
                   >
                     Reset Search
                   </button>
                </div>
              )}
            </>
          )}
        </div>

        
      </div>

      <TeacherFormModal
        open={showForm}
        mode={formMode}
        initial={formInitial}
        existingTeachers={rows}
        onCancel={() => setShowForm(false)}
        onSubmit={submitForm}
      />
      
    <TeacherViewModal
        open={showViewModal}
        row={viewingRow}
        onCancel={() => setShowViewModal(false)}
        onEdit={openEditFromView}
        onDelete={handleDelete}
        onAcknowledge={handleAcknowledge}
      />

      {/* 🟢 NEW: Spinner Style */}
      <style>{`
        .spinner-small { width: 12px; height: 12px; border: 2px solid #ccc; border-top-color: #2563eb; border-radius: 50%; animation: spin 1s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
};