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
import type { ColumnDef, SortingState, ColumnResizeMode, VisibilityState } from "@tanstack/react-table";

// 🟢 NEW: Server URL
const MERGE_SERVER_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export interface TeacherRow {
  id: string;
  trainer_id: string;
  name: string;
  email: string | null;
  school_name: string;
  status: string | null;    // 🟢 NEW FIELD
  is_active: boolean | null;// 🟢 NEW FIELD
  tags: string[] | null; // 🟢 ADDED THIS
  campus: string;
  worksheet_url: string | null;
  school_id: string | null;  // 🟢 ADD THIS (UUID)
  campus_id: string | null;  // 🟢 ADD THIS (Text ID)
  created_at: string;
  updated_at: string;
}

type TeacherFormState = {
  name: string;
  email: string;
  school_name: string;
  campus: string;
  worksheet_url: string;
  school_id: string | null;  // 🟢 ADD THIS
  campus_id: string | null;  // 🟢 ADD THIS
};

const emptyForm: TeacherFormState = {
  name: "",
  email: "",
  school_name: "",
  campus: "",
  worksheet_url: "",
  school_id: null,
  campus_id: null,
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
}

const TeacherViewModal: React.FC<TeacherViewModalProps> = ({
  open,
  row,
  onCancel,
  onEdit,
  onDelete,
}) => {
  if (!open || !row) return null;

  const handleOpenWorksheet = (r: TeacherRow) => {
    if (!r.worksheet_url) return;
    window.open(r.worksheet_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">Teacher Details</div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          <div className="detail-row">
            <label>Name</label>
            <span>{row.name}</span>
          </div>
          <div className="detail-row">
            <label>Email</label>
            <span>{row.email || "—"}</span>
          </div>
          <div className="detail-row">
            <label>School</label>
            <span>{row.school_name}</span>
          </div>
          <div className="detail-row">
            <label>Campus</label>
            <span>{row.campus}</span>
          </div>

          <div className="detail-row">
            <label>Worksheet Link</label>
            {row.worksheet_url ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleOpenWorksheet(row)}
                >
                  Open Worksheet
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Copy workbook link"
                  onClick={() => {
                    const url = row.worksheet_url;
                    if (!url) return;
                    navigator.clipboard.writeText(url).catch((err) => console.error("Copy failed", err));
                  }}
                >
                  📋
                </button>
              </div>
            ) : (
              <span>—</span>
            )}
          </div>
          <div className="detail-row">
            <label>Created At</label>
            <span>{new Date(row.created_at).toLocaleString()}</span>
          </div>
          <div className="detail-row">
            <label>Last Updated</label>
            <span>{new Date(row.updated_at).toLocaleString()}</span>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(row)}>
            Edit Details
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-danger"
            onClick={() => onDelete(row)}
          >
            Delete
          </button>
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

  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyForm);
      setSubmitting(false);
      setAutoCreate(false);
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
                <input
                  className="input"
                  type="url"
                  value={form.worksheet_url}
                  onChange={handleChange("worksheet_url")}
                  placeholder="Paste OneDrive workbook URL…"
                />
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
      // Inside columns definition in TeachersScreen.tsx
// Inside your columns definition in TeachersScreen.tsx
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
      {
        accessorKey: "email",
        header: "Email",
        cell: (info) => (
          <div className="entity-cell-main">{String(info.getValue() || "—")}</div>
        ),
        id: "email",
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "worksheet_url",
        header: "Worksheet",
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          
          // 🟢 NEW: Spinner logic
          if (provisioningIds.has(row.id)) {
            return (
              <div style={{color: '#2563eb', display:'flex', alignItems:'center', gap:'6px', fontWeight:500}}>
                <span className="spinner-small"></span> Creating...
              </div>
            );
          }

          const url = info.getValue() as string | null;
          if (!url) {
            return <span className="entity-cell-sub">Not set</span>;
          }
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="link-button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                Open
              </button>
              <button
                type="button"
                className="icon-button"
                title="Copy workbook link"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(url).catch((err) => console.error("Copy failed", err));
                }}
              >
                📋
              </button>
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
    [setShowColumnMenu, provisioningIds]
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      globalFilter: search,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
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

    const { data, error } = await supabase
      .from("teachers")
      .select(`
        id,
        trainer_id,
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
      `) // Ensure no comments, emojis, or "ADD THIS" text remains here
      .eq("trainer_id", trainerId)
      .order("school_name", { ascending: true })
      .order("campus", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("[DB] load teachers error", error);
      if (!cancelled) setLoadError(error.message);
      return;
    }

    if (!cancelled && data) {
      // This cast will now work because the 'data' structure matches TeacherRow
      setRows(data as TeacherRow[]); 
    }
  } finally {
    if (!cancelled) setLoading(false);
  }
}

    loadTeachers();
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
          school_id: values.school_id, // 🟢 ADD THIS
    campus_id: values.campus_id, // 🟢 ADD THIS
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
          updated_at
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
      openView(newRow); // Open View Modal on creation
      setShowForm(false);

      // 🟢 Trigger Background Task if requested
      if (autoCreateToken) {
        runBackgroundProvisioning(newRow, autoCreateToken);
      }
      return;
    }

    if (!editingRow) return;

    const { data, error } = await supabase
      .from("teachers")
      .update({
        name: values.name.trim(),
        email: values.email.trim() || null,
        school_name: values.school_name.trim(),
        campus: values.campus.trim(),
        school_id: values.school_id, // 🟢 ADD THIS
        campus_id: values.campus_id, // 🟢 ADD THIS
        worksheet_url: values.worksheet_url.trim() || null,
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
        updated_at
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

    openView(updated); // Open View Modal after update
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

    /* 3️⃣ Log Output (New Feature) */
    // The new backend sends back a 'logs' array. We print it to console for clarity.
    /* 3️⃣ Log Output (New Feature) */
    if (result.logs && Array.isArray(result.logs)) {
      console.groupCollapsed("📋 Sync Operation Logs");
      // FIX: Add ': string' to the parameter
      result.logs.forEach((log: string) => console.log(log));
      console.groupEnd();
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
        <div className="card-header">
          <div>
            <div className="card-title">Teachers</div>
            <div className="card-subtitle">
              Manage your teacher list and worksheet links.
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-group">
              <span>Search</span>
              <input
                className="input search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Teacher, school, campus…"
              />
              <div className="toolbar-group">
      {/* 2. THE BUTTON */}
              <button 
                type="button" 
                className="btn" 
                onClick={handleSync}
                style={{ marginRight: '8px', backgroundColor: '#e0e7ff', color: '#3730a3' }}
              >
                🔄 Sync GS
              </button>

              <ImportTeachersBtn onUploadComplete={() => setRefreshKey(prev => prev + 1)} />
          </div>
            </div>

            <div className="toolbar-group">
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreate}
              >
                + New teacher
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

          {!loading && table.getRowModel().rows.length === 0 && !loadError && (
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

          {!loading && table.getRowModel().rows.length > 0 && (
            <>
              {/* Column Visibility Menu */}
              <div
                style={{
                  position: "absolute",
                  top: "1px", // Adjust to align with table header row
                  right: "8px",
                  zIndex: 10, // Ensure it's above table
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
                        column.id !== "actions" && ( // Exclude the actions column from the toggle list
                          <div key={column.id} className="form-row" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                            <label style={{ fontSize: "13px", color: "var(--text)" }}>
                              {/* Use the column header text or a capitalized ID if header is a component */}
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
      />

      {/* 🟢 NEW: Spinner Style */}
      <style>{`
        .spinner-small { width: 12px; height: 12px; border: 2px solid #ccc; border-top-color: #2563eb; border-radius: 50%; animation: spin 1s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
};