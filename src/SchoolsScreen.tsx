import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthContext";
import ImportSchoolsBtn from "./components/ImportSchoolsBtn";
import { getGraphAccessToken } from "./msal/getGraphToken";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";

import { Search, Plus, RefreshCw } from "lucide-react";
import type {
  ColumnDef,
  SortingState,
  ColumnResizeMode,
  VisibilityState,
  Table,
} from "@tanstack/react-table";

// 🟢 NEW: Server URL
const MERGE_SERVER_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export interface SchoolRow {
  id: string;
  trainer_id: string;
  school_name: string;
  campus_name: string;
  admin_name: string | null;
  admin_email: string | null;
  admin_phone: string | null;
  am_name: string | null;
  am_email: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  notes: string | null;
  admin_workbook_url: string | null;
  has_empty_class: boolean; // 🟢 NEW FIELD
  official_code: string | null; // 🟢 Added
  campus_id: string | null;     // 🟢 Added
  created_at: string;
  updated_at: string;
}

type SchoolFormState = {
  school_name: string;
  campus_name: string;
  admin_name: string;
  admin_email: string;
  admin_phone: string;
  am_name: string;
  official_code: string; // 🟢 Added
  campus_id: string;     // 🟢 Added
  am_email: string;
  address: string;
  district: string;
  city: string;
  notes: string;
  admin_workbook_url: string;
};

const emptyForm: SchoolFormState = {
  school_name: "",
  campus_name: "",
  admin_name: "",
  admin_email: "",
  admin_phone: "",
  am_name: "",
  am_email: "",
  address: "",
  district: "",
  official_code: "", // 🟢 Added
  campus_id: "",     // 🟢 Added
  city: "",
  notes: "",
  admin_workbook_url: "",
};

interface SchoolFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: SchoolFormState;
  existingSchools: SchoolRow[];
  onCancel: () => void;
  // 🟢 UPDATED: Accepts optional token
  onSubmit: (values: SchoolFormState, autoCreateToken?: string) => Promise<void>;
}

interface SchoolViewModalProps {
  open: boolean;
  row: SchoolRow | null;
  onCancel: () => void;
  onEdit: (row: SchoolRow) => void;
  onDelete: (row: SchoolRow) => Promise<void>;
}

const SchoolViewModal: React.FC<SchoolViewModalProps> = ({
  open,
  row,
  onCancel,
  onEdit,
  onDelete,
}) => {
  if (!open || !row) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">School / Campus Details</div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          <div className="detail-row">
            <label>School Name</label>
            <span>{row.school_name}</span>
          </div>
          <div className="detail-row">
            <label>Campus Name</label>
            <span>{row.campus_name}</span>
          </div>

          <div className="detail-row">
            <label>Admin Name</label>
            <span>{row.admin_name || "—"}</span>
          </div>
          <div className="detail-row">
            <label>Admin Email</label>
            <span>{row.admin_email || "—"}</span>
          </div>
          <div className="detail-row">
            <label>Admin Phone</label>
            <span>{row.admin_phone || "—"}</span>
          </div>
          <div className="detail-row">
            <label>Account Manager Name</label>
            <span>{row.am_name || "—"}</span>
          </div>
          <div className="detail-row">
            <label>Account Manager Email</label>
            <span>{row.am_email || "—"}</span>
          </div>

          <div className="detail-row">
            <label>Address</label>
            <span>{row.address || "—"}</span>
          </div>
          <div className="detail-row">
            <label>District</label>
            <span>{row.district || "—"}</span>
          </div>
          <div className="detail-row">
            <label>City</label>
            <span>{row.city || "—"}</span>
          </div>
          
          <div className="detail-row">
            <label>Admin Workbook URL</label>
            {row.admin_workbook_url ? (
              <a href={row.admin_workbook_url} target="_blank" rel="noopener noreferrer" className="link-button">
                Open Workbook
              </a>
            ) : (
              <span>—</span>
            )}
          </div>

          {row.notes && (
            <div className="detail-row detail-row--notes">
              <label>Notes</label>
              <pre>{row.notes}</pre>
            </div>
          )}
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

const SchoolFormModal: React.FC<SchoolFormModalProps> = ({
  open,
  mode,
  initial,
  existingSchools, // 🟢 ADD THIS LINE
  onCancel,
  onSubmit,
}) => {
  const [form, setForm] = useState<SchoolFormState>(initial ?? emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [autoCreate, setAutoCreate] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [apiCampuses, setApiCampuses] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Clean name helper for matching logic in Phase B
  const cleanName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyForm);
      setSubmitting(false);
      setAutoCreate(false);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleChange =
    (field: keyof SchoolFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

const handleLookupCampuses = async () => {
  if (!form.official_code.trim()) {
    alert("Please enter an Official Code (School ID) first.");
    return;
  }

  setIsSearching(true);
  try {
    // 🟢 NO MORE getGraphAccessToken() call here!
    
    const resp = await fetch(`${MERGE_SERVER_BASE}/api/lookup-campuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolCode: form.official_code.trim(),
        // 🟢 token is no longer sent
      }),
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error || "Could not find school. Check the code.");
    }
    
    const data = await resp.json();
    const campusList = Array.isArray(data) ? data : [];
    
    if (campusList.length === 0) {
      alert("No campuses found for this code.");
    }

    setApiCampuses(campusList);
    setHasSearched(true);
  } catch (err: any) {
    console.error("Lookup Error:", err);
    alert(err.message || "Failed to fetch campuses.");
  } finally {
    setIsSearching(false);
  }
};

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.school_name.trim() || !form.campus_name.trim()) {
      alert("Please fill in School name and Campus.");
      return;
    }

    setSubmitting(true);
    let token: string | undefined = undefined;

    // 🟢 UPDATED: Get Token Logic
    // If autoCreate is checked (regardless of mode), try to get the token
    if (autoCreate) {
      try {
        token = await getGraphAccessToken();
      } catch (err: any) {
        console.error("Token error", err);
        const cont = window.confirm(`Could not sign in to Microsoft: ${err.message}\n\nSave school anyway (without workbook)?`);
        if (!cont) {
          setSubmitting(false);
          return;
        }
      }
    }

    try {
      await onSubmit(form, token);
    } finally {
      setSubmitting(false);
    }
};

const getCampusStatus = (apiId: string, apiName: string) => {
  const match = existingSchools.find(s => 
    s.campus_id === apiId || 
    (cleanName(s.campus_name) === cleanName(apiName) && s.official_code === form.official_code)
  );

  if (!match) return "selectable"; // New campus
  if (!match.campus_id) return "repairable"; // Name match but ID is missing
  return "linked"; // ID match (already healthy)
};

return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">
            {mode === "create" ? "Add school / campus" : "Edit school / campus"}
          </div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        {/* 🟢 FIX 1: Changed <form> to <div> and removed onSubmit */}
        <div className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
         
          {/* Row 1: Official Code + Search */}
          <div className="form-row">
            <label>Official Code (School ID) *</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="input"
                type="text"
                value={form.official_code}
                onChange={handleChange("official_code")}
                placeholder="e.g., 49c384f1-..."
                style={{ flexGrow: 1 }}
              />
              <button
                type="button"
                className="tm-pure-icon"
                style={{ color: '#0d9488', border: '1px solid #334155', borderRadius: '8px', background: 'rgba(30, 41, 59, 0.4)' }}
                onClick={handleLookupCampuses}
                disabled={isSearching}
                title="Search Campuses"
              >
                <Search size={18} className={isSearching ? "tm-spin" : ""} />
              </button>
            </div>
          </div>
          {/* Row 2: School Name */}
          <div className="form-row">
            <label>School name *</label>
            <input
              className="input"
              type="text"
              value={form.school_name}
              onChange={handleChange("school_name")}
              placeholder="e.g. VSK Sunshine"
            />
          </div>
          {/* Row: Campus Name (Smart Dropdown) */}
<div className="form-row">
  <label>Campus name *</label>
  {hasSearched && apiCampuses.length > 0 ? (
    <select
      className="input"
      value={form.campus_id}
      style={{ border: '1px solid #0d9488', backgroundColor: 'rgba(13, 148, 136, 0.05)' }}
      onChange={(e) => {
        const selected = apiCampuses.find(c => c.id === e.target.value);
        if (selected) {
          setForm(prev => ({ 
            ...prev, 
            campus_id: selected.id, 
            campus_name: selected.name,
            // 🟢 Set school name if empty
            school_name: prev.school_name || selected.schoolName || "" 
          }));
        }
      }}
    >
      <option value="">-- Choose a Campus from GrapeSEED --</option>
      {apiCampuses.map((c) => {
  const status = getCampusStatus(c.id, c.name);
  
  // Logic: Disable ONLY if it's already linked with an ID
  const isDisabled = status === "linked";
  
  let labelSuffix = "";
  if (status === "linked") labelSuffix = " (✓ Already Linked)";
  if (status === "repairable") labelSuffix = " (⚠️ Campus Missing ID)";

  return (
    <option 
      key={c.id} 
      value={c.id} 
      disabled={isDisabled}
      style={{ 
        color: isDisabled ? '#64748b' : (status === 'repairable' ? '#2563eb' : 'inherit'),
        fontWeight: status === 'repairable' ? 600 : 400
      }}
    >
      {c.name}{labelSuffix}
    </option>
  );
})}
    </select>
  ) : (
    <div style={{ position: 'relative' }}>
       <input
        className="input"
        type="text"
        value={form.campus_name}
        onChange={handleChange("campus_name")}
        placeholder={hasSearched ? "No campuses found. Type manually..." : "Search code to see campuses..."}
      />
      {hasSearched && apiCampuses.length === 0 && (
         <small style={{ color: '#64748b', fontSize: '11px', marginTop: '4px', display: 'block' }}>
           No API matches found. You can still type manually if needed.
         </small>
      )}
    </div>
  )}
</div>

          <div className="form-row">
            <label>Admin name</label>
            <input
              className="input"
              type="text"
              value={form.admin_name}
              onChange={handleChange("admin_name")}
            />
          </div>

          <div className="form-row">
            <label>Admin email</label>
            <input
              className="input"
              type="email"
              value={form.admin_email}
              onChange={handleChange("admin_email")}
              placeholder="admin@example.com"
            />
          </div>

          <div className="form-row">
            <label>Admin phone</label>
            <input
              className="input"
              type="tel"
              value={form.admin_phone}
              onChange={handleChange("admin_phone")}
              placeholder="+84…"
            />
          </div>

          <div className="form-row">
            <label>Account Manager name</label>
            <input
              className="input"
              type="text"
              value={form.am_name}
              onChange={handleChange("am_name")}
            />
          </div>

          <div className="form-row">
            <label>Account Manager email</label>
            <input
              className="input"
              type="email"
              value={form.am_email}
              onChange={handleChange("am_email")}
            />
          </div>

          <div className="form-row">
            <label>Address</label>
            <input
              className="input"
              type="text"
              value={form.address}
              onChange={handleChange("address")}
              placeholder="Street, ward…"
            />
          </div>

          <div className="form-row">
            <label>District</label>
            <input
              className="input"
              type="text"
              value={form.district}
              onChange={handleChange("district")}
            />
          </div>

          <div className="form-row">
            <label>City</label>
            <input
              className="input"
              type="text"
              value={form.city}
              onChange={handleChange("city")}
            />
          </div>

          <div className="form-row">
            <label>Notes</label>
            <textarea
              className="input"
              value={form.notes}
              onChange={handleChange("notes")}
              rows={3}
              placeholder="Any special notes about this campus…"
            />
          </div>

          <div className="form-row">
            <label>Admin Workbook URL</label>
            
            {/* Auto-Create Checkbox Logic */}
            {(mode === 'create' || !initial?.admin_workbook_url) && (
               <div style={{marginBottom: '8px', display:'flex', alignItems:'center', gap:'8px'}}>
                 <input 
                   type="checkbox" 
                   id="chk-auto-school" 
                   checked={autoCreate} 
                   onChange={(e) => setAutoCreate(e.target.checked)} 
                   style={{width:'auto', margin:0}} 
                 />
                 <label htmlFor="chk-auto-school" style={{margin:0, fontWeight:600, color:'#2563eb', cursor:'pointer'}}>
                   {mode === 'create' ? '✨ Auto-create Admin Workbook?' : '✨ Create missing workbook?'}
                 </label>
               </div>
            )}

            {!autoCreate && (
              <input
                className="input"
                type="url"
                value={form.admin_workbook_url}
                onChange={handleChange("admin_workbook_url")}
                placeholder="Paste Admin workbook URL (e.g., OneDrive/SharePoint link)…"
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

            {/* 🟢 FIX 2 & 3: Changed type to "button" and added onClick handler */}
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

export const SchoolsScreen: React.FC = () => {
  const { user } = useAuth();

  const [rows, setRows] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  // 🟢 NEW: Background Task Tracking
  const [provisioningIds, setProvisioningIds] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<SchoolRow | null>(null);

  const [viewingRow, setViewingRow] = useState<SchoolRow | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0); 
  const [sorting, setSorting] = useState<SortingState>([
    { id: "school_name", desc: false },
    { id: "campus_name", desc: false },
  ]);

  // 2. Add inside SchoolsScreen component
const [isPulsing, setIsPulsing] = useState(false);
const [pulseResults, setPulseResults] = useState<{
  newCampuses: any[];
  disabledCampuses: any[];
  classlessClasses: any[];
  nameMismatches: any[];
}>({
  newCampuses: [],
  disabledCampuses: [],
  classlessClasses: [],
  nameMismatches: []
});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      const saved = localStorage.getItem("schoolsColumnVisibility");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load column visibility from local storage", e);
    }
    return {
      campus_name: false,
      admin_phone: false,
      am_email: false,
      address: false,
      district: false,
      city: false,
      notes: false,
      admin_workbook_url: false,
      created_at: false,
      updated_at: false,
    };
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false); 

  // 🟢 NEW: Background Provisioning Logic
  const runBackgroundProvisioning = async (school: SchoolRow, token: string) => {
    try {
      setProvisioningIds(prev => new Set(prev).add(school.id));

      const resp = await fetch(`${MERGE_SERVER_BASE}/api/provision-school`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ 
          schoolName: school.school_name,
          trainerId: user?.id,
          schoolId: school.id // 🟢 ADDED: Send ID for unique naming
        })
      });
      const result = await resp.json();

      if (!result.ok) throw new Error(result.error || "Provisioning failed");

      // Update DB
      const { error } = await supabase
        .from("schools")
        .update({ admin_workbook_url: result.workbookUrl })
        .eq("id", school.id);
      
      if (error) throw error;

      // Update UI
      setRows(prev => prev.map(r => r.id === school.id ? { ...r, admin_workbook_url: result.workbookUrl } : r));

    } catch (err: any) {
      console.error("Background task failed", err);
      alert(`⚠️ Failed to create workbook for ${school.school_name}: ${err.message}`);
    } finally {
      setProvisioningIds(prev => {
        const next = new Set(prev);
        next.delete(school.id);
        return next;
      });
    }
  };

  // Define Columns
  const columns = useMemo<ColumnDef<SchoolRow>[]>(
    () => [
{
  accessorKey: "school_name",
  header: "School & Campus",
  cell: (info) => (
    <>
      <div className="entity-cell-main" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {info.row.original.school_name}
        
        {/* ⚡ NEW: No ID Tag (Calculated logic) */}
        {!info.row.original.campus_id && (
          <span className="tag-pill tag-pill-warning" title="This campus has no API ID link">
            No Campus ID
          </span>
        )}

        {/* Existing No Teacher Tag */}
        {info.row.original.has_empty_class && (
          <span className="tag-pill tag-pill-notag" title="This school has classes with no teacher assigned">
            No Teacher
          </span>
        )}
      </div>
      <div className="entity-cell-sub">{info.row.original.campus_name}</div>
    </>
  ),
  id: "school_name",
  minSize: 150,
  size: 250,
},
      {
        accessorKey: "campus_name",
        header: "Campus Name",
        minSize: 100,
        size: 150,
      },
      {
        accessorKey: "admin_name",
        header: "Admin Name",
        cell: (info) => (
          <>
            <div className="entity-cell-main">{String(info.getValue() || "—")}</div>
            <div className="entity-cell-sub">{info.row.original.admin_phone || ""}</div>
          </>
        ),
        id: "admin_name",
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "admin_email",
        header: "Admin Email",
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "admin_phone",
        header: "Admin Phone",
        minSize: 100,
        size: 150,
      },
      {
        accessorKey: "am_name",
        header: "AM Name",
        cell: (info) => (
          <>
            <div className="entity-cell-main">{String(info.getValue() || "—")}</div>
            <div className="entity-cell-sub">{info.row.original.am_email || ""}</div>
          </>
        ),
        id: "am_name",
        minSize: 150,
        size: 150,
      },
      {
        accessorKey: "am_email",
        header: "AM Email",
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "address",
        header: "Address",
        minSize: 200,
        size: 250,
      },
      {
        accessorKey: "district",
        header: "District",
        minSize: 100,
        size: 150,
      },
      {
        accessorKey: "city",
        header: "City",
        id: "city",
        minSize: 100,
        size: 150,
      },
      {
        accessorKey: "notes",
        header: "Notes",
        enableSorting: false,
        minSize: 100,
        size: 200,
      },
      {
        accessorKey: "admin_workbook_url",
        header: "Admin Workbook",
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

          return info.getValue() ? (
            <a
              href={info.getValue() as string}
              target="_blank"
              rel="noopener noreferrer"
              className="link-button"
              onClick={(e) => e.stopPropagation()}
            >
              Open Link
            </a>
          ) : (
            <span>—</span>
          );
        },
        minSize: 120,
        size: 180,
      },
      {
        accessorKey: "created_at",
        header: "Created At",
        cell: (info) => new Date(info.getValue() as string).toLocaleDateString(),
        minSize: 100,
        size: 150,
      },
      {
        accessorKey: "updated_at",
        header: "Updated At",
        cell: (info) => new Date(info.getValue() as string).toLocaleDateString(),
        minSize: 100,
        size: 150,
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
    [setShowColumnMenu, provisioningIds] // 🟢 NEW: dependency on provisioningIds
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

  useEffect(() => {
    try {
      localStorage.setItem("schoolsColumnVisibility", JSON.stringify(columnVisibility));
    } catch (e) {
      console.error("Failed to save column visibility to local storage", e);
    }
  }, [columnVisibility]);

  if (!user) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title">Schools</div>
        </div>
        <div className="card-body" style={{ position: "relative" }}>
          <p>You must be signed in to manage schools.</p>
        </div>
      </div>
    );
  }

  const trainerId = user.id;

  useEffect(() => {
    let cancelled = false;

    async function loadSchools() {
      try {
        setLoading(true);
        setLoadError(null);

        const { data, error } = await supabase
          .from("schools")
          .select(
            `
            id,
            trainer_id,
            school_name,
            campus_name,
            official_code, 
            campus_id,
            admin_name,
            admin_email,
            admin_phone,
            am_name,
            am_email,
            address,
            district,
            city,
            notes,
            admin_workbook_url,
            has_empty_class,
            created_at,
            updated_at
          `
          )
          .eq("trainer_id", trainerId)
          .order("school_name", { ascending: true })
          .order("campus_name", { ascending: true });

        if (error) {
          console.error("[DB] load schools error", error);
          if (!cancelled) setLoadError(error.message);
          return;
        }

        if (!cancelled && data) {
          setRows(data as SchoolRow[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSchools();
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

  const openView = (row: SchoolRow) => {
    setViewingRow(row);
    setShowViewModal(true);
    setShowForm(false);
  }

  const openEdit = (row: SchoolRow) => {
    setFormMode("edit");
    setEditingRow(row);
    setShowForm(true);
    setViewingRow(null);
    setShowViewModal(false);
  };

  const openEditFromView = (row: SchoolRow) => {
    setFormMode("edit");
    setEditingRow(row);
    setShowForm(true);
    setViewingRow(null);
    setShowViewModal(false);
  };

  const handleDelete = async (row: SchoolRow) => {
    const ok = window.confirm(
      `Delete campus "${row.school_name} – ${row.campus_name}"?\nThis cannot be undone.`
    );
    if (!ok) return;

    const { error } = await supabase
      .from("schools")
      .delete()
      .eq("id", row.id)
      .eq("trainer_id", trainerId);

    if (error) {
      console.error("[DB] delete school error", error);
      alert("Could not delete school. Please try again.");
      return;
    }

    setRows((prev) => prev.filter((s) => s.id !== row.id));
    if (viewingRow?.id === row.id) {
      setViewingRow(null);
      setShowViewModal(false);
    }
  };

  const submitForm = async (values: SchoolFormState, autoCreateToken?: string) => {
    if (formMode === "create") {
      const { data, error } = await supabase
        .from("schools")
        .insert({
          trainer_id: user.id,
          school_name: values.school_name.trim(),
          campus_name: values.campus_name.trim(),
          official_code: values.official_code.trim() || null, // 🟢 Added
          campus_id: values.campus_id.trim() || null,         // 🟢 Added
          admin_name: values.admin_name.trim() || null,
          admin_email: values.admin_email.trim() || null,
          admin_phone: values.admin_phone.trim() || null,
          am_name: values.am_name.trim() || null,
          am_email: values.am_email.trim() || null,
          address: values.address.trim() || null,
          district: values.district.trim() || null,
          city: values.city.trim() || null,
          notes: values.notes.trim() || null,
          admin_workbook_url: values.admin_workbook_url.trim() || null,
        })
        .select()
        .single();

      if (error) {
        console.error("[DB] create school error", error);
        alert("Could not create school. Please try again.");
        return;
      }

      const newRow = data as SchoolRow;
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
      .from("schools")
      .update({
        school_name: values.school_name.trim(),
        campus_name: values.campus_name.trim(),
        official_code: values.official_code.trim() || null, // 🟢 Added
        campus_id: values.campus_id.trim() || null,         // 🟢 Added
        admin_name: values.admin_name.trim() || null,
        admin_email: values.admin_email.trim() || null,
        admin_phone: values.admin_phone.trim() || null,
        am_name: values.am_name.trim() || null,
        am_email: values.am_email.trim() || null,
        address: values.address.trim() || null,
        district: values.district.trim() || null,
        city: values.city.trim() || null,
        notes: values.notes.trim() || null,
        admin_workbook_url: values.admin_workbook_url.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingRow.id)
      .eq("trainer_id", trainerId)
      .select()
      .single();

    if (error) {
      console.error("[DB] update school error", error);
      alert("Could not save changes. Please try again.");
      return;
    }

    const updated = data as SchoolRow;
    setRows((prev) =>
      prev.map((r) => (r.id === editingRow.id ? updated : r))
    );
    
    // 🟢 UPDATED: Trigger Auto-create in Edit Mode
    if (autoCreateToken) {
       runBackgroundProvisioning(updated, autoCreateToken);
    }

    openView(updated);
    setShowForm(false);
  };

  const formInitial: SchoolFormState | undefined =
    formMode === "edit" && editingRow
      ? {
          school_name: editingRow.school_name,
          campus_name: editingRow.campus_name,
          official_code: editingRow.official_code ?? "", // 🟢 Added
          campus_id: editingRow.campus_id ?? "",         // 🟢 Added
          admin_name: editingRow.admin_name ?? "",
          admin_email: editingRow.admin_email ?? "",
          admin_phone: editingRow.admin_phone ?? "",
          am_name: editingRow.am_name ?? "",
          am_email: editingRow.am_email ?? "",
          address: editingRow.address ?? "",
          district: editingRow.district ?? "",
          city: editingRow.city ?? "",
          notes: editingRow.notes ?? "",
          admin_workbook_url: editingRow.admin_workbook_url ?? "",
        }
      : undefined;

const runPulseAudit = async () => {
  if (isPulsing) return;

  setIsPulsing(true);
  console.log("🚀 Pulse Engine: Starting deep audit...");

  try {
    // 1. Call your new "Shadow Logic" backend route
    const resp = await fetch(`${MERGE_SERVER_BASE}/api/pulse-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user?.id }),
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error || "Pulse discovery failed.");
    }

    const results = await resp.json();

    // 2. Store findings in our state (to be used by Item 3: Action Dashboard)
    setPulseResults({
      newCampuses: results.newCampuses || [],
      disabledCampuses: results.disabledCampuses || [],
      classlessClasses: results.classlessClasses || [],
      nameMismatches: results.nameMismatches || []
    });

    // 3. Simple Feedback (We will improve this in Item 3)
    const totalIssues = 
      (results.newCampuses?.length || 0) + 
      (results.disabledCampuses?.length || 0) + 
      (results.classlessClasses?.length || 0) +
      (results.nameMismatches?.length || 0);

    if (totalIssues > 0) {
      alert(`✅ Pulse Complete: ${totalIssues} sync issues found. Check the Action Dashboard.`);
    } else {
      alert("✅ Pulse Complete: Everything is perfectly in sync!");
    }

  } catch (err: any) {
    console.error("Pulse Audit Error:", err);
    alert(`❌ Pulse Error: ${err.message}`);
  } finally {
    setIsPulsing(false);
  }
};

  return (
    <>
      <div className="card">
        <div className="card-header tm-header-layout">
        {/* Tier 1: Title & Info */}
        <div className="tm-title-section">
          <div className="card-title">Schools & campuses</div>
          <div className="card-subtitle">
            Manage school metadata (admin, AM, address) used by observations and reports.
          </div>
        </div>

        {/* Tier 2: The Level Toolbar */}
        <div className="tm-toolbar-row">
          {/* Left: Pill Search */}
          <div className="tm-search-wrapper">
            <Search size={14} strokeWidth={2} className="tm-search-icon-svg" />
            <input
              className="tm-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schools..."
            />
          </div>

          {/* Right: Icon Group + Primary Action */}
          <div className="tm-actions-group">
            {/* 🟢 NEW: Pulse Sync Button */}
            <button
              type="button"
              className="tm-pure-icon"
              style={{ 
                marginRight: '8px', 
                color: isPulsing ? '#2563eb' : '#64748b',
                cursor: isPulsing ? 'default' : 'pointer'
              }}
              onClick={runPulseAudit}
              disabled={isPulsing}
              title="Run Pulse Audit (Sync Discovery)"
            >
              <RefreshCw 
                size={18} 
                strokeWidth={2} 
                className={isPulsing ? "tm-spin" : ""} 
              />
            </button>
            {/* Note: Ensure ImportSchoolsBtn is updated to use the same .tm-pure-icon 
                style with Lucide Download/Upload icons as we did for Teachers. 
            */}
            <ImportSchoolsBtn onUploadComplete={() => setRefreshKey(prev => prev + 1)} />

            <button
              type="button"
              className="tm-btn-primary"
              onClick={openCreate}
            >
              <Plus size={18} strokeWidth={2} style={{ marginRight: '6px' }} />
              New school / campus
            </button>
          </div>
        </div>
      </div>

        <div className="card-body" style={{ position: "relative" }}>
          {loading && <div>Loading schools…</div>}
          {loadError && (
            <div className="field-error">
              Could not load schools ({loadError})
            </div>
          )}

          {!loading && table.getRowModel().rows.length === 0 && !loadError && (
            <div className="empty-state">
              <p>No schools yet.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreate}
              >
                Add your first school
              </button>
            </div>
          )}

          {!loading && table.getRowModel().rows.length > 0 && (
            <>
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

      <SchoolFormModal
        open={showForm}
        mode={formMode}
        initial={formInitial}
        existingSchools={rows}
        onCancel={() => setShowForm(false)}
        onSubmit={submitForm}
      />
      
      <SchoolViewModal
        open={showViewModal}
        row={viewingRow}
        onCancel={() => setShowViewModal(false)}
        onEdit={openEditFromView}
        onDelete={handleDelete}
      />

      {/* 🟢 NEW: Spinner Style */}
      <style>{`
        .spinner-small {
          width: 12px; height: 12px; border: 2px solid #ccc; border-top-color: #2563eb; border-radius: 50%; animation: spin 1s linear infinite; display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
};