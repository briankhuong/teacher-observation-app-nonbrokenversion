import React, { useEffect, useMemo, useState, useRef } from "react";
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
import type {
  ColumnDef,
  SortingState,
  ColumnResizeMode,
  VisibilityState,
  Table,
  FilterFn, // 🟢 Added FilterFn
} from "@tanstack/react-table";
import { Search, Plus, RefreshCw, Pencil } from "lucide-react";
import { isGrapeSeedTokenValid } from "./utils/authHelpers";
import { GrapeSeedLoginModal } from "./components/GrapeSeedLoginModal";
import { flattenText } from "./utils/textUtils";
const fuzzyVietnameseFilter: FilterFn<SchoolRow> = (row, columnId, value) => {
  const itemValue = row.getValue(columnId);
  const searchTerm = flattenText(value);
  const targetValue = flattenText(String(itemValue || ""));
  return targetValue.includes(searchTerm);
};
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
  district: string | null;   // we’ll remove from UI but keep in type for backward compatibility (or you can delete)
  city: string | null;
  notes: string | null;
  admin_workbook_url: string | null;
  has_empty_class: boolean;
  official_code: string | null;
  campus_id: string | null;
  caring: boolean;
  created_at: string;
  updated_at: string;
  disabled: boolean;
  exclusive: string | null;   // 'shared' | 'exclusive' | 'temporary'
  visit_count: number | null; // 🟢 NEW
  needs_review: boolean; // 🟢 NEW
  previous_data: any; // 🟢 NEW
}
type SchoolFormState = {
  school_name: string;
  campus_name: string;
  admin_name: string;
  admin_email: string;
  admin_phone: string;
  am_name: string;
  official_code: string;
  campus_id: string;
  am_email: string;
  address: string;
  notes: string;
  admin_workbook_url: string;
  caring: boolean;
  disabled: boolean;
  exclusive: string;   // "" means unset, but we'll enforce one of 'shared'/'exclusive'/'temporary'
  visit_count: string; // 🟢 NEW
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
  official_code: "",
  campus_id: "",
  notes: "",
  admin_workbook_url: "",
  caring: false,
  disabled: false,
  exclusive: "exclusive",   // default value as per your request
  visit_count: "",          // 🟢 NEW
};
interface SchoolFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: SchoolFormState;
  existingSchools: SchoolRow[];
  onCancel: () => void;
  onRefresh?: () => void;
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
          <div className="detail-row" style={{ background: row.caring ? 'rgba(34, 197, 94, 0.1)' : 'transparent', padding: '8px', borderRadius: '6px' }}>
            <label>Caring School Status</label>
            <span style={{ fontWeight: 600, color: row.caring ? '#22c55e' : 'var(--text)' }}>
              {row.caring ? "✅ Caring School" : "—"}
            </span>
          </div>
          <div className="detail-row">
            <label>School Name</label>
            <span>{row.school_name}</span>
          </div>
          <div className="detail-row">
            <label>Campus Name</label>
            <span>{row.campus_name}</span>
          </div>
          {/* Helper to highlight if changed */}
          {(() => {
            // 🟢 Parse previous_data if it's a JSON string
            let prev: any = row.previous_data;
            if (typeof prev === 'string') {
              try { prev = JSON.parse(prev); } catch (e) { prev = {}; }
            }
            if (!prev || typeof prev !== 'object') prev = {};
            // 🟢 UPDATED: Only highlight if needs_review is still true
            const isChanged = (field: string) =>
              row.needs_review && prev[field] !== undefined && prev[field] !== row[field as keyof SchoolRow];
            const highlightStyle = (changed: boolean) =>
              changed ? { backgroundColor: '#fef9c3', padding: '2px 6px', borderRadius: '4px', color: '#000' } : {};
            // Debug: log the comparison
            console.log(`\[ViewModal\] previous_data for ${row.school_name} - ${row.campus_name}:`, prev);
            return (
              <>
                <div className="detail-row">
                  <label>Admin Name</label>
                  {isChanged('admin_name') ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.9em' }}>{prev.admin_name || "—"}</span>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>{row.admin_name || "—"}</span>
                    </div>
                  ) : (
                    <span>{row.admin_name || "—"}</span>
                  )}
                </div>
                <div className="detail-row">
                  <label>Admin Email</label>
                  {isChanged('admin_email') ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.9em' }}>{prev.admin_email || "—"}</span>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>{row.admin_email || "—"}</span>
                    </div>
                  ) : (
                    <span>{row.admin_email || "—"}</span>
                  )}
                </div>
                <div className="detail-row">
                  <label>Admin Phone</label>
                  {isChanged('admin_phone') ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.9em' }}>{prev.admin_phone || "—"}</span>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>{row.admin_phone || "—"}</span>
                    </div>
                  ) : (
                    <span>{row.admin_phone || "—"}</span>
                  )}
                </div>
                <div className="detail-row">
                  <label>Address</label>
                  {isChanged('address') ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.9em' }}>{prev.address || "—"}</span>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>{row.address || "—"}</span>
                    </div>
                  ) : (
                    <span>{row.address || "—"}</span>
                  )}
                </div>
              </>
            );
          })()}
          <div className="detail-row">
            <label>Account Manager Name</label>
            <span>{row.am_name || "—"}</span>
          </div>
          <div className="detail-row">
            <label>Account Manager Email</label>
            <span>{row.am_email || "—"}</span>
          </div>
          {/* --- NEW: Status & Exclusive --- */}
          <div className="detail-row">
            <label>Status</label>
            <span style={{ color: row.disabled ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
              {row.disabled ? 'Inactive' : 'Active'}
            </span>
          </div>
          <div className="detail-row">
            <label>Exclusive</label>
            <span>{row.exclusive ? row.exclusive.charAt(0).toUpperCase() + row.exclusive.slice(1) : "—"}</span>
          </div>
          <div className="detail-row">
            <label>Visit Count</label>
            <span>{row.visit_count !== null && row.visit_count !== undefined ? row.visit_count : "—"}</span>
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
  existingSchools,
  onCancel,
  onRefresh,
  onSubmit,
}) => {
  const { user } = useAuth(); // needed for handleSubmit
  const [form, setForm] = useState<SchoolFormState>(initial ?? emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [autoCreate, setAutoCreate] = useState(false);
  // new state for multi‑campus lookup
  const [lookupResult, setLookupResult] = useState<{
    schoolName: string;
    campuses: Array<{
      campusId: string;
      campusName: string;
      address: string | null;
      campusPhone: string | null;
      adminName: string | null;
      adminEmail: string | null;
      adminPhone: string | null;
    }>;
  } | null>(null);
  const [selectedCampusIds, setSelectedCampusIds] = useState<Set<string>>(new Set());
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  // Clean name helper for matching logic in Phase B
  const cleanName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyForm);
      setSubmitting(false);
      setAutoCreate(false);
      setLookupResult(null);
      setSelectedCampusIds(new Set());
      setHasSearched(false);
    }
  }, [open, initial]);
  if (!open) return null;
  const handleChange =
    (field: keyof SchoolFormState) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
      };
  const handleLookupSchoolDetails = async () => {
    if (!form.official_code.trim()) {
      alert("Please enter an Official Code first.");
      return;
    }
    setIsLookingUp(true);
    setLookupResult(null);
    setSelectedCampusIds(new Set());
    setHasSearched(true);
    try {
      const resp = await fetch(`${MERGE_SERVER_BASE}/api/lookup-school-details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolCode: form.official_code.trim() }),
      });
      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.error || "Lookup failed.");
      }
      const data = await resp.json();
      if (!data.campuses || data.campuses.length === 0) {
        alert("No active campuses found for this school.");
        setLookupResult({ schoolName: data.schoolName, campuses: [] });
        return;
      }
      setLookupResult(data);
      // Pre‑fill AM fields from an existing record for this school code
      const existingSameSchool = existingSchools.find(
        (s) => s.official_code === form.official_code.trim()
      );
      setForm((prev) => ({
        ...prev,
        school_name: data.schoolName,
        am_name: existingSameSchool?.am_name || prev.am_name || "",
        am_email: existingSameSchool?.am_email || prev.am_email || "",
      }));
      // Auto‑select if only one campus and it's not already in DB
      if (data.campuses.length === 1) {
        const c = data.campuses[0];
        // DEBUG: log the admin data from API
        console.log("Single campus auto‑select admin data:", {
          adminName: c.adminName,
          adminEmail: c.adminEmail,
          adminPhone: c.adminPhone,
        });
        const alreadyExists = existingSchools.some(
          (s) => s.campus_id === c.campusId
        );
        if (!alreadyExists) {
          setSelectedCampusIds(new Set([c.campusId]));
          // AM fields already pre‑filled above, no need to repeat
          setForm((prev) => ({
            ...prev,
            campus_id: c.campusId,
            campus_name: c.campusName,
            admin_name: c.adminName || "",
            admin_email: c.adminEmail || "",
            admin_phone: c.adminPhone || "",
            address: c.address || "",
          }));
        } else {
          setSelectedCampusIds(new Set());
          alert("This campus is already in your list.");
        }
      }
    } catch (err: any) {
      console.error("Lookup Error:", err);
      alert(err.message || "Failed to fetch school details.");
    } finally {
      setIsLookingUp(false);
    }
  };
  const toggleCampusSelection = (campusId: string) => {
    setSelectedCampusIds((prev) => {
      const next = new Set(prev);
      if (next.has(campusId)) {
        next.delete(campusId);
      } else {
        next.add(campusId);
      }
      return next;
    });
  };
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // If editing, use the original parent‑handled flow (no change)
    if (mode === "edit") {
      if (!form.school_name.trim() || !form.campus_name.trim()) {
        alert("Please fill in School name and Campus.");
        return;
      }
      setSubmitting(true);
      let token: string | undefined = undefined;
      if (autoCreate) {
        try {
          token = await getGraphAccessToken();
        } catch (err: any) {
          console.error("Token error", err);
          const cont = window.confirm(
            `Could not sign in to Microsoft: ${err.message}\n\nSave school anyway (without workbook)?`
          );
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
      return;
    }
    // ---------- Creation mode (multi or single) ----------
    let campusesToCreate: Array<{
      campusId: string;
      campusName: string;
      address: string | null;
      adminName: string | null;
      adminEmail: string | null;
      adminPhone: string | null;
    }> | null = null;
    if (lookupResult && lookupResult.campuses.length > 0) {
      campusesToCreate = lookupResult.campuses.filter((c) =>
        selectedCampusIds.has(c.campusId)
      );
      if (campusesToCreate.length === 0) {
        alert("Please select at least one campus to add.");
        return;
      }
    } else {
      if (!form.school_name.trim() || !form.campus_name.trim()) {
        alert("Please fill in School name and Campus.");
        return;
      }
      campusesToCreate = [
        {
          campusId: form.campus_id || "",
          campusName: form.campus_name,
          address: form.address,
          adminName: form.admin_name,
          adminEmail: form.admin_email,
          adminPhone: form.admin_phone,
        },
      ];
    }
    setSubmitting(true);
    let token: string | undefined = undefined;
    if (autoCreate) {
      try {
        token = await getGraphAccessToken();
      } catch (err: any) {
        console.error("Token error", err);
        const cont = window.confirm(
          `Could not sign in to Microsoft: ${err.message}\n\nSave schools anyway?`
        );
        if (!cont) {
          setSubmitting(false);
          return;
        }
      }
    }
    try {
      const insertedRows: SchoolRow[] = [];
      for (const campus of campusesToCreate) {
        const payload = {
          trainer_id: user!.id,
          school_name: lookupResult
            ? lookupResult.schoolName
            : form.school_name.trim(),
          campus_name: campus.campusName,
          official_code: form.official_code.trim(),
          campus_id: campus.campusId || null,
          admin_name: campus.adminName || null,
          admin_email: campus.adminEmail || null,
          admin_phone: campus.adminPhone || null,
          am_name: form.am_name.trim() || null,
          am_email: form.am_email.trim() || null,
          address: campus.address || null,
          caring: form.caring,
          disabled: form.disabled,
          exclusive: form.exclusive || "exclusive",
          visit_count: form.visit_count ? Number(form.visit_count) : null,
          admin_workbook_url: form.admin_workbook_url.trim() || null,
          notes: form.notes.trim() || null,
        };
        const { data, error } = await supabase
          .from("schools")
          .insert(payload)
          .select()
          .single();
        if (error) {
          console.error("Insert error:", error);
          alert(`Failed to add campus "${campus.campusName}".`);
          setSubmitting(false);
          return;
        }
        if (data) insertedRows.push(data as SchoolRow);
      }
      // Auto‑create workbooks if requested
      if (autoCreate && token && insertedRows.length > 0) {
        const provisionPromises = insertedRows.map(async (row) => {
          try {
            const resp = await fetch(`${MERGE_SERVER_BASE}/api/provision-school`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                schoolName: row.school_name,
                trainerId: user!.id,
                schoolId: row.id,
              }),
            });
            const result = await resp.json();
            if (!result.ok) throw new Error(result.error || "Provisioning failed");
            // Update the workbook URL in DB
            await supabase
              .from("schools")
              .update({ admin_workbook_url: result.workbookUrl })
              .eq("id", row.id);
          } catch (err: any) {
            console.warn(`Workbook creation failed for ${row.school_name}:`, err.message);
            // Continue with other campuses even if one fails
          }
        });
        await Promise.all(provisionPromises);
      }
      onCancel();
      if (onRefresh) onRefresh();
    } finally {
      setSubmitting(false);
    }
  };
  const getCampusStatus = (apiId: string, apiName: string) => {
    const match = existingSchools.find(
      (s) =>
        s.campus_id === apiId ||
        (cleanName(s.campus_name) === cleanName(apiName) &&
          s.official_code === form.official_code)
    );
    if (!match) return "selectable";
    if (!match.campus_id) return "repairable";
    return "linked";
  };
  return (
    <div className="modal-backdrop">
      <div
        className="modal-panel"
        style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}
      >
        <div className="modal-header">
          <div className="modal-title">
            {mode === "create" ? "Add school / campus" : "Edit school / campus"}
          </div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          {/* Official Code + Search */}
          <div className="form-row">
            <label>Official Code (School ID) *</label>
            <div style={{ display: "flex", gap: "8px" }}>
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
                style={{
                  color: "#0d9488",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  background: "rgba(30, 41, 59, 0.4)",
                }}
                onClick={handleLookupSchoolDetails}
                disabled={isLookingUp}
                title="Search School & Campuses"
              >
                <Search size={18} className={isLookingUp ? "tm-spin" : ""} />
              </button>
            </div>
          </div>
          {/* School Name (filled by API) */}
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
          {/* Campus(es) – multi‑select UI */}
          <div className="form-row">
            <label>Campus(es) *</label>
            {hasSearched && lookupResult && lookupResult.campuses.length > 0 ? (
              <div
                style={{
                  maxHeight: "200px",
                  overflowY: "auto",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  padding: "8px",
                  background: "rgba(15, 23, 42, 0.6)",
                }}
              >
                {lookupResult.campuses.map((campus) => {
                  const alreadyAdded = existingSchools.some(
                    (s) => s.campus_id === campus.campusId
                  );
                  return (
                    <div
                      key={campus.campusId}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                        padding: "8px 0",
                        borderBottom: "1px solid #1e293b",
                        opacity: alreadyAdded ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        id={`campus-${campus.campusId}`}
                        checked={
                          alreadyAdded
                            ? false
                            : selectedCampusIds.has(campus.campusId)
                        }
                        onChange={() =>
                          !alreadyAdded && toggleCampusSelection(campus.campusId)
                        }
                        disabled={alreadyAdded}
                        style={{ width: "auto", margin: "4px 0 0 0" }}
                      />
                      <label
                        htmlFor={`campus-${campus.campusId}`}
                        style={{
                          flex: 1,
                          cursor: alreadyAdded ? "default" : "pointer",
                          textDecoration: alreadyAdded ? "line-through" : "none",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: "#f8fafc",
                            fontSize: "13px",
                          }}
                        >
                          {campus.campusName}
                          {alreadyAdded && (
                            <span
                              style={{
                                color: "#f87171",
                                marginLeft: "8px",
                                fontSize: "11px",
                                textDecoration: "none",
                              }}
                            >
                              (Already Added)
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#94a3b8",
                            marginTop: "2px",
                          }}
                        >
                          {campus.adminName && <span>👤 {campus.adminName}</span>}
                          {campus.adminEmail && (
                            <span> ✉️ {campus.adminEmail}</span>
                          )}
                          {campus.adminPhone && (
                            <span> 📞 {campus.adminPhone}</span>
                          )}
                          {!campus.adminName &&
                            !campus.adminEmail &&
                            !campus.adminPhone && (
                              <span
                                style={{
                                  color: "#64748b",
                                  fontStyle: "italic",
                                }}
                              >
                                No admin contact found
                              </span>
                            )}
                        </div>
                        {campus.address && (
                          <div
                            style={{
                              fontSize: "10px",
                              color: "#64748b",
                              marginTop: "1px",
                            }}
                          >
                            📍 {campus.address}
                          </div>
                        )}
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type="text"
                  value={form.campus_name}
                  onChange={handleChange("campus_name")}
                  placeholder={
                    hasSearched
                      ? "No campuses found. Type manually..."
                      : "Search code to see campuses..."
                  }
                />
                {hasSearched &&
                  lookupResult &&
                  lookupResult.campuses.length === 0 && (
                    <small
                      style={{
                        color: "#64748b",
                        fontSize: "11px",
                        marginTop: "4px",
                        display: "block",
                      }}
                    >
                      No active campuses found. Type manually if needed.
                    </small>
                  )}
              </div>
            )}
          </div>
          {/* Admin & Address fields – hidden when multiple campuses are shown */}
          {lookupResult && lookupResult.campuses.length > 1 ? (
            <div className="form-row" style={{ color: '#fcd34d', fontSize: '12px', padding: '8px', background: 'rgba(251,191,36,0.1)', borderRadius: '6px', border: '1px solid #fcd34d' }}>
              ℹ️ Each selected campus will be created with its own admin details shown in the checklist above.
              You can edit the details individually after creation.
            </div>
          ) : (
            <>
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
                <label>Address</label>
                <input
                  className="input"
                  type="text"
                  value={form.address}
                  onChange={handleChange("address")}
                  placeholder="Street, ward…"
                />
              </div>
            </>
          )}
          {/* AM fields always visible */}
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
          {/* Status, Exclusive, Visit Count, Caring, Notes, Workbook */}
          <div className="form-row">
            <label>Campus Status</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                id="chk-disabled"
                checked={form.disabled}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, disabled: e.target.checked }))
                }
                style={{ width: "auto", margin: 0 }}
              />
              <label
                htmlFor="chk-disabled"
                style={{ margin: 0, cursor: "pointer", fontWeight: 600 }}
              >
                Disabled (Inactive)
              </label>
            </div>
          </div>
          <div className="form-row">
            <label>Exclusive</label>
            <select
              className="select"
              value={form.exclusive}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, exclusive: e.target.value }))
              }
            >
              <option value="shared">Shared</option>
              <option value="exclusive">Exclusive</option>
              <option value="temporary">Temporary</option>
            </select>
          </div>
          <div className="form-row">
            <label>Visit Count</label>
            <input
              className="input"
              type="number"
              min="0"
              step="1"
              value={form.visit_count}
              onChange={handleChange("visit_count")}
              placeholder="e.g. 5"
            />
          </div>
          <div className="form-row">
            <label>Caring Status</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                id="chk-caring"
                checked={form.caring}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, caring: e.target.checked }))
                }
                style={{ width: "auto", margin: 0 }}
              />
              <label
                htmlFor="chk-caring"
                style={{ margin: 0, cursor: "pointer", fontWeight: 600 }}
              >
                Mark as Caring
              </label>
            </div>
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
            {(mode === "create" || !initial?.admin_workbook_url) && (
              <div
                style={{
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <input
                  type="checkbox"
                  id="chk-auto-school"
                  checked={autoCreate}
                  onChange={(e) => setAutoCreate(e.target.checked)}
                  style={{ width: "auto", margin: 0 }}
                />
                <label
                  htmlFor="chk-auto-school"
                  style={{
                    margin: 0,
                    fontWeight: 600,
                    color: "#2563eb",
                    cursor: "pointer",
                  }}
                >
                  {mode === "create"
                    ? "✨ Auto-create Admin Workbook?"
                    : "✨ Create missing workbook?"}
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
          {(() => {
            const allAlreadyExist = !!(
              lookupResult &&
              lookupResult.campuses.length > 0 &&
              lookupResult.campuses.every((c) =>
                existingSchools.some((s) => s.campus_id === c.campusId)
              )
            );
            return (
              <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                {allAlreadyExist && (
                  <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '8px', width: '100%' }}>
                    All found campuses are already in your list. No new campuses to add.
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={onCancel}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleSubmit()}
                    disabled={submitting || allAlreadyExist}
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
            );
          })()}
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
  // 🟢 NEW: Bulk Edit State
  const [isBulkEditMode, setIsBulkEditMode] = useState(false);
  // 🟢 NEW: Optimistic Auto-Save Handler (for Schools)
  const handleInlineUpdate = async (id: string, field: keyof SchoolRow, value: any) => {
    // 1. Optimistic UI update
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    // 2. Background DB sync
    const { error } = await supabase
      .from("schools")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("trainer_id", user?.id);
    if (error) {
      console.error(`Failed to update ${field}:`, error);
      alert(`Could not save ${field}. Please refresh and try again.`);
    }
  };
  const [search, setSearch] = useState("");
  const [preSearchTab, setPreSearchTab] = useState<typeof schoolFilter | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<SchoolRow | null>(null);
  const [viewingRow, setViewingRow] = useState<SchoolRow | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // 🟢 NEW: Status Filter State
  const [schoolFilter, setSchoolFilter] = useState<'all' | 'active' | 'inactive' | 'no_teachers' | 'temporary' | 'needs_review'>('active');
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
  const { filteredRows, filterCounts, activeBreakdown } = useMemo(() => {
    // Step 1: Search across all schools
    const isSearching = search && search.trim();
    let sourceRows = rows;
    if (isSearching) {
      const term = flattenText(search);
      sourceRows = rows.filter(r => {
        const fields = [r.school_name, r.campus_name, r.admin_name, r.admin_email, r.am_name, r.am_email, r.address].filter(Boolean);
        return fields.some(field => flattenText(String(field)).includes(term));
      });
    }
    const active: SchoolRow[] = [];
    const inactive: SchoolRow[] = [];
    const noTeachers: SchoolRow[] = [];
    const temporary: SchoolRow[] = [];
    sourceRows.forEach((r) => {
      if (r.disabled) {
        inactive.push(r);
        return;
      }
      if (r.exclusive === 'shared' || r.exclusive === 'exclusive') {
        active.push(r);
      }
      if (r.has_empty_class) {
        noTeachers.push(r);
      }
      if (r.exclusive === 'temporary') {
        temporary.push(r);
      }
    });
    let filtered: SchoolRow[] = [];
    if (isSearching) {
      // When searching, show all matching rows (ignore the tab filter)
      filtered = sourceRows;
    } else if (schoolFilter === 'all') filtered = sourceRows;
    else if (schoolFilter === 'active') filtered = active;
    else if (schoolFilter === 'inactive') filtered = inactive;
    else if (schoolFilter === 'no_teachers') filtered = noTeachers;
    else if (schoolFilter === 'temporary') filtered = temporary;
    else if (schoolFilter === 'needs_review') filtered = sourceRows.filter(r => r.needs_review);
    // 🟢 Display original data for rows under review, and hide new unreviewed schools (only when not in needs_review tab)
    if (schoolFilter !== 'needs_review' && !isSearching) {
      filtered = filtered
        .filter(r => {
          if (r.needs_review && !r.previous_data) return false;
          return true;
        })
        .map(r => {
          if (!r.needs_review || !r.previous_data) return r;
          let prev;
          try {
            prev = typeof r.previous_data === 'string' ? JSON.parse(r.previous_data) : r.previous_data;
          } catch { prev = null; }
          if (!prev || typeof prev !== 'object') return r;
          return {
            ...r,
            admin_name: prev.admin_name ?? r.admin_name,
            admin_email: prev.admin_email ?? r.admin_email,
            admin_phone: prev.admin_phone ?? r.admin_phone,
            address: prev.address ?? r.address,
            disabled: prev.disabled ?? r.disabled,
          };
        });
    }
    // Active breakdown (shared / exclusive) – based on original active array
    const sharedSchools = new Set<string>();
    const exclusiveSchools = new Set<string>();
    active.forEach((r) => {
      if (r.exclusive === 'shared') sharedSchools.add(r.school_name);
      else if (r.exclusive === 'exclusive') exclusiveSchools.add(r.school_name);
    });
    const temporarySchools = new Set<string>();
    temporary.forEach(r => temporarySchools.add(r.school_name));
    const breakdown = {
      shared: sharedSchools.size,
      exclusive: exclusiveSchools.size,
      temporary: temporarySchools.size,
    };
    return {
      filteredRows: filtered,
      filterCounts: {
        all: rows.length,
        active: active.length,
        inactive: inactive.length,
        no_teachers: noTeachers.length,
        temporary: temporary.length,
      },
      activeBreakdown: breakdown,
    };
  }, [rows, schoolFilter, search]);
  // Total unique schools across all rows (unfiltered)
  const totalUniqueSchoolCount = useMemo(() => {
    const names = rows.map((r) => r.school_name);
    return new Set(names).size;
  }, [rows]);
  // Count unique schools based on currently filtered rows (used by active/inactive/all subtitles)
  const uniqueSchoolCount = useMemo(() => {
    const names = filteredRows.map((r) => r.school_name);
    return new Set(names).size;
  }, [filteredRows]);
  // Unique school counts for Active and Inactive tabs (independent of filter)
  const activeUniqueCount = useMemo(() => {
    const names = rows
      .filter(r => !r.disabled && (r.exclusive === 'shared' || r.exclusive === 'exclusive'))
      .filter(r => !r.needs_review || (r.previous_data && Object.keys(r.previous_data).length > 0))
      .map(r => r.school_name);
    return new Set(names).size;
  }, [rows]);
  const inactiveUniqueCount = useMemo(() => {
    const names = rows
      .filter(r => r.disabled)
      .filter(r => !r.needs_review || (r.previous_data && Object.keys(r.previous_data).length > 0))
      .map(r => r.school_name);
    return new Set(names).size;
  }, [rows]);
  // Unique school counts for No Teachers and Temporary tabs
  const noTeachersUniqueCount = useMemo(() => {
    const names = rows
      .filter(r => r.has_empty_class && !r.disabled)
      .filter(r => !r.needs_review || (r.previous_data && Object.keys(r.previous_data).length > 0))
      .map(r => r.school_name);
    return new Set(names).size;
  }, [rows]);
  const temporaryUniqueCount = useMemo(() => {
    const names = rows
      .filter(r => r.exclusive === 'temporary' && !r.disabled)
      .filter(r => !r.needs_review || (r.previous_data && Object.keys(r.previous_data).length > 0))
      .map(r => r.school_name);
    return new Set(names).size;
  }, [rows]);
  const needsReviewCount = useMemo(() => rows.filter(r => r.needs_review).length, [rows]);
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
      district: false,   // remove this line if you removed district column, but safe to keep if omitted
      city: false,       // same
      notes: false,
      admin_workbook_url: false,
      created_at: false,
      updated_at: false,
      disabled: false,
      exclusive: false,
      visit_count: false,
    };
  });
  const [showGrapeLogin, setShowGrapeLogin] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const pendingSchoolSync = useRef<(() => void) | null>(null);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
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
  const handleRejectSchool = async (row: SchoolRow) => {
    // Parse previous_data (it may be a JSON string)
    let prevData: any = row.previous_data;
    if (typeof prevData === 'string') {
      try { prevData = JSON.parse(prevData); } catch (e) { prevData = null; }
    }
    // No previous data → this was a newly added school
    if (!prevData || typeof prevData !== 'object' || Object.keys(prevData).length === 0) {
      const ok = window.confirm(
        `Delete newly added school "${row.school_name} - ${row.campus_name}"?`
      );
      if (!ok) return;
      // Delete the school
      const { error } = await supabase
        .from("schools")
        .delete()
        .eq("id", row.id)
        .eq("trainer_id", user?.id);
      if (error) {
        alert("Failed to delete school.");
        return;
      }
      setRows(prev => prev.filter(r => r.id !== row.id));
      return;
    }
    // Has previous data → restore old values
    const updates: any = {
      needs_review: false,
      previous_data: null,
      updated_at: new Date(),
    };
    if (prevData.admin_name !== undefined) updates.admin_name = prevData.admin_name;
    if (prevData.admin_email !== undefined) updates.admin_email = prevData.admin_email;
    if (prevData.admin_phone !== undefined) updates.admin_phone = prevData.admin_phone;
    if (prevData.address !== undefined) updates.address = prevData.address;
    if (prevData.disabled !== undefined) updates.disabled = prevData.disabled;
    const { error } = await supabase
      .from("schools")
      .update(updates)
      .eq("id", row.id)
      .eq("trainer_id", user?.id);
    if (error) {
      alert("Failed to reject changes.");
      return;
    }
    setRows(prev =>
      prev.map(r =>
        r.id === row.id ? { ...r, ...updates, previous_data: null } : r
      )
    );
  };
  const handleRejectAllSchools = async (selectedIds?: string[]) => {
    // Use provided selection, or fallback to all review items with previous_data
    const idsToProcess = selectedIds && selectedIds.length > 0
      ? selectedIds
      : rows.filter(r => r.needs_review && r.previous_data).map(r => r.id);
    if (idsToProcess.length === 0) {
      alert("No schools selected or no schools have previous data to restore.");
      return;
    }
    const schoolsWithoutData = idsToProcess.filter(id => {
      const row = rows.find(r => r.id === id);
      return row && (!row.previous_data || Object.keys(row.previous_data).length === 0);
    });
    if (schoolsWithoutData.length > 0) {
      const ok = window.confirm(
        `${schoolsWithoutData.length} selected school(s) have no previous data. Clear their review flag anyway?`
      );
      if (!ok) return;
    }
    for (const id of idsToProcess) {
      const row = rows.find(r => r.id === id);
      if (!row) continue;
      await handleRejectSchool(row);
    }
    setSelectedReviewIds(new Set());
  };
  const handleDeleteSelected = async () => {
    if (selectedReviewIds.size === 0) return;
    const ok = window.confirm(`Delete ${selectedReviewIds.size} selected schools/campuses? This cannot be undone.`);
    if (!ok) return;
    const ids = Array.from(selectedReviewIds);
    const { error } = await supabase
      .from("schools")
      .delete()
      .in("id", ids)
      .eq("trainer_id", user?.id);
    if (error) {
      alert("Failed to delete selected schools.");
      return;
    }
    setRows(prev => prev.filter(r => !selectedReviewIds.has(r.id)));
    setSelectedReviewIds(new Set());
  };
  const handleAcknowledgeSchool = async (row: SchoolRow) => {
    const { error } = await supabase
      .from("schools")
      .update({ needs_review: false })
      .eq("id", row.id)
      .eq("trainer_id", user?.id);
    if (error) {
      alert("Failed to acknowledge school.");
      return;
    }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, needs_review: false } : r));
  };
  const handleAcknowledgeAllSchools = async (selectedIds?: string[]) => {
    const idsToAck = selectedIds && selectedIds.length > 0 ? selectedIds : rows.filter(r => r.needs_review).map(r => r.id);
    const count = idsToAck.length;
    if (count === 0) return;
    const ok = window.confirm(`Acknowledge ${count} schools?`);
    if (!ok) return;
    // Bulk update
    for (const id of idsToAck) {
      const { error } = await supabase
        .from("schools")
        .update({ needs_review: false })
        .eq("id", id)
        .eq("trainer_id", user?.id);
      if (error) {
        alert(`Failed to acknowledge school ${id}: ${error.message}`);
        return;
      }
    }
    setRows(prev => prev.map(r => idsToAck.includes(r.id) ? { ...r, needs_review: false } : r));
    setSelectedReviewIds(new Set());
    if (idsToAck.length === needsReviewCount) setSchoolFilter('active');
  };
  // Helper: safely parse previous_data into a plain object
  const getPreviousData = (row: SchoolRow) => {
    let prev: any = row.previous_data;
    if (typeof prev === 'string') {
      try { prev = JSON.parse(prev); } catch (e) { prev = null; }
    }
    if (!prev || typeof prev !== 'object') return {};
    return prev;
  };
  // Define Columns
  const columns = useMemo<ColumnDef<SchoolRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }: { table: any }) => {
          const allRows = table.getRowModel().rows;
          const allSelected = allRows.length > 0 && allRows.every((row: any) => selectedReviewIds.has(row.original.id));
          return (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                if (allSelected) {
                  setSelectedReviewIds(new Set());
                } else {
                  const allIds = allRows.map((row: any) => row.original.id);
                  setSelectedReviewIds(new Set(allIds));
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'auto', margin: 0 }}
            />
          );
        },
        cell: ({ row }: { row: any }) => (
          <input
            type="checkbox"
            checked={selectedReviewIds.has(row.original.id)}
            onChange={(e) => {
              e.stopPropagation();
              const id = row.original.id;
              setSelectedReviewIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'auto', margin: 0 }}
          />
        ),
        size: 40,
        minSize: 40,
        enableSorting: false,
        enableResizing: false,
      },
      // ---------- existing school_name column ----------
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
              {/* 🟢 NEW: Inactive Tag */}
              {info.row.original.disabled && (
                <span
                  className="tag-pill"
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    borderColor: '#ef4444',
                    border: '1px solid',
                    color: '#ef4444',
                    fontWeight: 600,
                    fontSize: '10px',
                    display: 'inline-block',
                    padding: '1px 8px',
                    borderRadius: '12px',
                  }}
                >
                  Inactive
                </span>
              )}
              {/* 🟢 NEW: Exclusive tag (only show if shared or temporary) */}
              {info.row.original.exclusive && info.row.original.exclusive !== 'exclusive' && (
                <span
                  className="tag-pill"
                  style={{
                    background:
                      info.row.original.exclusive === 'temporary' ? 'rgba(234,179,8,0.15)' :
                        'rgba(59,130,246,0.15)',
                    borderColor:
                      info.row.original.exclusive === 'temporary' ? '#eab308' :
                        '#3b82f6',
                    border: '1px solid',
                    color:
                      info.row.original.exclusive === 'temporary' ? '#eab308' :
                        '#3b82f6',
                    fontWeight: 600,
                    fontSize: '10px',
                    display: 'inline-block',
                    padding: '1px 8px',
                    borderRadius: '12px',
                  }}
                >
                  {info.row.original.exclusive === 'shared' ? 'Shared' : 'Temporary'}
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
        cell: (info) => {
          const row = info.row.original;
          const prev = getPreviousData(row);
          const nameChanged = row.needs_review && prev.admin_name !== undefined && prev.admin_name !== row.admin_name;
          const phoneChanged = row.needs_review && prev.admin_phone !== undefined && prev.admin_phone !== row.admin_phone;
          return (
            <>
              <div className="entity-cell-main">
                {nameChanged ? (
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                    <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.85em' }}>{String(prev.admin_name || "—")}</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{String(row.admin_name || "—")}</span>
                  </div>
                ) : (
                  <span>{String(row.admin_name || "—")}</span>
                )}
              </div>
              <div className="entity-cell-sub">
                {phoneChanged ? (
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4', marginTop: '2px' }}>
                    <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.85em' }}>{String(prev.admin_phone || "—")}</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{String(row.admin_phone || "—")}</span>
                  </div>
                ) : (
                  <span>{row.admin_phone || ""}</span>
                )}
              </div>
            </>
          );
        },
        id: "admin_name",
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "admin_email",
        header: "Admin Email",
        cell: (info) => {
          const row = info.row.original;
          const prev = getPreviousData(row);
          const changed = row.needs_review && prev.admin_email !== undefined && prev.admin_email !== row.admin_email;
          if (changed) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.85em' }}>{String(prev.admin_email || "—")}</span>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{String(row.admin_email || "—")}</span>
              </div>
            );
          }
          return <span>{String(info.getValue() || "—")}</span>;
        },
        minSize: 150,
        size: 200,
      },
      {
        accessorKey: "admin_phone",
        header: "Admin Phone",
        cell: (info) => {
          const row = info.row.original;
          const prev = getPreviousData(row);
          const changed = row.needs_review && prev.admin_phone !== undefined && prev.admin_phone !== row.admin_phone;
          if (changed) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.85em' }}>{String(prev.admin_phone || "—")}</span>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{String(row.admin_phone || "—")}</span>
              </div>
            );
          }
          return <span>{String(info.getValue() || "—")}</span>;
        },
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
        cell: (info) => {
          const row = info.row.original;
          const prev = getPreviousData(row);
          const changed = row.needs_review && prev.address !== undefined && prev.address !== row.address;
          if (changed) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                <span style={{ textDecoration: 'line-through', color: '#ef4444', fontSize: '0.85em' }}>
                  {String(prev.address || "—")}
                </span>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>
                  {String(row.address || "—")}
                </span>
              </div>
            );
          }
          return <span>{String(info.getValue() || "—")}</span>;
        },
        minSize: 200,
        size: 250,
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
              <div style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
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
      // 🟢 NEW: Disabled Status (Hidden by default)
      {
        accessorKey: "disabled",
        header: "Status",
        cell: (info) => {
          if (!isBulkEditMode) {
            return (
              <span style={{
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 700,
                border: '1px solid',
                background: info.getValue() ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                borderColor: info.getValue() ? '#ef4444' : '#22c55e',
                color: info.getValue() ? '#ef4444' : '#22c55e',
              }}>
                {info.getValue() ? 'Inactive' : 'Active'}
              </span>
            );
          }
          // Bulk edit mode: render checkbox
          return (
            <input
              type="checkbox"
              checked={!!info.getValue()}
              onChange={(e) => handleInlineUpdate(info.row.original.id, "disabled", e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'auto', margin: 0 }}
            />
          );
        },
        minSize: 90,
        size: 100,
      },
      // 🟢 NEW: Exclusive (Hidden by default)
      {
        accessorKey: "exclusive",
        header: "Exclusive",
        cell: (info) => {
          const val = info.getValue() as string | null;
          if (!isBulkEditMode) {
            if (!val) return <span>—</span>;
            const colors: Record<string, { bg: string; text: string }> = {
              shared: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6' },
              exclusive: { bg: 'rgba(139,92,246,0.1)', text: '#8b5cf6' },
              temporary: { bg: 'rgba(234,179,8,0.1)', text: '#eab308' },
            };
            const c = colors[val] || { bg: 'transparent', text: 'var(--text)' };
            return (
              <span style={{
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 600,
                background: c.bg,
                color: c.text,
                border: `1px solid ${c.text}`,
              }}>
                {val.charAt(0).toUpperCase() + val.slice(1)}
              </span>
            );
          }
          // Bulk edit mode: render dropdown
          return (
            <select
              className="select"
              style={{ padding: '2px 6px', fontSize: '11px', width: '110px', height: '28px' }}
              value={val || ""}
              onChange={(e) => handleInlineUpdate(info.row.original.id, "exclusive", e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">--</option>
              <option value="shared">Shared</option>
              <option value="exclusive">Exclusive</option>
              <option value="temporary">Temporary</option>
            </select>
          );
        },
        minSize: 90,
        size: 100,
      },
      // 🟢 NEW: Caring column (editable in bulk edit)
      {
        accessorKey: "caring",
        header: "Caring",
        cell: (info) => {
          if (!isBulkEditMode) {
            return info.getValue() ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ Caring</span> : <span>—</span>;
          }
          return (
            <input
              type="checkbox"
              checked={!!info.getValue()}
              onChange={(e) => handleInlineUpdate(info.row.original.id, "caring", e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'auto', margin: 0 }}
            />
          );
        },
        minSize: 90,
        size: 100,
      },
      // 🟢 NEW: Visit Count (Hidden by default, editable in bulk edit)
      {
        accessorKey: "visit_count",
        header: "Visits",
        cell: (info) => {
          if (!isBulkEditMode) {
            const val = info.getValue() as number | null;
            return <span>{val !== null ? val : "—"}</span>;
          }
          // Bulk edit: inline number input
          return (
            <input
              type="number"
              min="0"
              step="1"
              className="input"
              style={{ padding: '2px 6px', fontSize: '12px', width: '70px', height: '28px' }}
              value={info.getValue() !== null ? String(info.getValue()) : ""}
              onChange={(e) => {
                const newVal = e.target.value === "" ? null : Number(e.target.value);
                handleInlineUpdate(info.row.original.id, "visit_count", newVal);
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="0"
            />
          );
        },
        minSize: 80,
        size: 90,
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
            {schoolFilter === 'needs_review' && info.row.original.needs_review && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ color: '#eab308', fontSize: '14px', padding: '0 4px', marginRight: '4px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAcknowledgeSchool(info.row.original);
                  }}
                  title="Acknowledge"
                >
                  ✨
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ color: '#ef4444', fontSize: '14px', padding: '0 4px', marginRight: '4px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRejectSchool(info.row.original);
                  }}
                  title="Reject changes (restore previous)"
                >
                  ↩️
                </button>
              </>
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
    [setShowColumnMenu, provisioningIds, isBulkEditMode, handleInlineUpdate, schoolFilter, selectedReviewIds, filteredRows]
  );
  const table = useReactTable({
    data: filteredRows,
    columns,
    state: {
      sorting,
      globalFilter: '', // search is handled manually in useMemo across all schools
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    // globalFilterFn no longer needed
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  useEffect(() => {
    setSelectedReviewIds(new Set());
  }, [schoolFilter]);
  // 🆕 When search becomes non-empty, switch to 'all' tab; restore when cleared
  useEffect(() => {
    if (search && search.trim()) {
      setPreSearchTab(prev => prev ?? schoolFilter);
      setSchoolFilter('all');
    } else {
      if (preSearchTab) {
        setSchoolFilter(preSearchTab);
        setPreSearchTab(null);
      }
    }
  }, [search]);
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
            caring,
            admin_name,
            admin_email,
            admin_phone,
            am_name,
            am_email,
            address,
            notes,
            admin_workbook_url,
            has_empty_class,
            created_at,
            updated_at,
            disabled,
            exclusive,
            visit_count,
            needs_review,
            previous_data
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
          official_code: values.official_code.trim() || null,
          campus_id: values.campus_id.trim() || null,
          admin_name: values.admin_name.trim() || null,
          admin_email: values.admin_email.trim() || null,
          admin_phone: values.admin_phone.trim() || null,
          am_name: values.am_name.trim() || null,
          am_email: values.am_email.trim() || null,
          address: values.address.trim() || null,
          notes: values.notes.trim() || null,
          caring: values.caring,
          disabled: values.disabled,
          exclusive: values.exclusive || 'exclusive',   // fallback to default
          visit_count: values.visit_count ? Number(values.visit_count) : null, // 🟢 NEW
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
        official_code: values.official_code.trim() || null,
        campus_id: values.campus_id.trim() || null,
        admin_name: values.admin_name.trim() || null,
        admin_email: values.admin_email.trim() || null,
        admin_phone: values.admin_phone.trim() || null,
        am_name: values.am_name.trim() || null,
        am_email: values.am_email.trim() || null,
        address: values.address.trim() || null,
        notes: values.notes.trim() || null,
        admin_workbook_url: values.admin_workbook_url.trim() || null,
        caring: values.caring,
        disabled: values.disabled,
        exclusive: values.exclusive || 'exclusive',
        visit_count: values.visit_count ? Number(values.visit_count) : null,
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
        official_code: editingRow.official_code ?? "",
        campus_id: editingRow.campus_id ?? "",
        admin_name: editingRow.admin_name ?? "",
        admin_email: editingRow.admin_email ?? "",
        admin_phone: editingRow.admin_phone ?? "",
        am_name: editingRow.am_name ?? "",
        am_email: editingRow.am_email ?? "",
        address: editingRow.address ?? "",
        notes: editingRow.notes ?? "",
        admin_workbook_url: editingRow.admin_workbook_url ?? "",
        caring: editingRow.caring ?? false,
        disabled: editingRow.disabled ?? false,
        exclusive: editingRow.exclusive ?? "exclusive",
        visit_count: editingRow.visit_count !== null && editingRow.visit_count !== undefined ? String(editingRow.visit_count) : "",
      }
      : undefined;
  const performSync = async (token: string) => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const syncResp = await fetch(`${MERGE_SERVER_BASE}/api/sync-school-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, userId: user.id }),
      });
      if (syncResp.ok) {
        const result = await syncResp.json();
        if (result.logs && Array.isArray(result.logs)) {
          console.groupCollapsed("📋 School Sync Logs");
          result.logs.forEach((log: string) => console.log(log));
          console.groupEnd();
        }
        setRefreshKey(prev => prev + 1);
      } else {
        const err = await syncResp.text();
        alert(`School sync failed: ${err}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`School sync error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  const handleSchoolSync = async () => {
    if (!user?.id) return;
    // Check if we already have a valid user GrapeSEED token
    if (isGrapeSeedTokenValid()) {
      const token = localStorage.getItem("grapeseed_token")!;
      await performSync(token);
    } else {
      // Need to prompt login – store the callback and show modal
      pendingSchoolSync.current = () => handleSchoolSync();
      setShowGrapeLogin(true);
    }
  };
  const handleGrapeLoginSuccess = () => {
    setShowGrapeLogin(false);
    // If a sync was pending, re‑run it now that we have a fresh token
    if (pendingSchoolSync.current) {
      pendingSchoolSync.current();
      pendingSchoolSync.current = null;
    }
  };
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
  // 🟢 NEW: Toggle Bulk Edit and adjust columns automatically
  const toggleBulkEdit = () => {
    setIsBulkEditMode(prev => {
      const nextMode = !prev;
      if (nextMode) {
        setColumnVisibility({
          // Show editable columns; hide some others to keep table clean
          campus_name: false,
          admin_phone: false,
          am_email: false,
          address: false,
          notes: false,
          admin_workbook_url: false,
          created_at: false,
          updated_at: false,
          disabled: true,   // Show status column
          exclusive: true,  // Show exclusive column
          visit_count: true, // 🟢 Show visit count
          // ───── we'll also show caring column (which was already visible by default) ─────
        });
      } else {
        // Revert to default visibility (as defined initially)
        setColumnVisibility({
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
          disabled: false,
          exclusive: false,
          visit_count: false,
        });
      }
      return nextMode;
    });
  };
  return (
    <>
      <div className="card">
        <div className="card-header tm-header-layout">
          {/* Tier 1: Title & Info */}
          <div className="tm-title-section">
            <div className="card-title">Schools & campuses</div>
            <div className="card-subtitle">
              {schoolFilter === 'active' && (
                <span>
                  <strong style={{ color: 'var(--text-main)' }}>{uniqueSchoolCount}</strong> unique schools across <strong style={{ color: 'var(--text-main)' }}>{filterCounts.active}</strong> active campuses
                  <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    (Shared: {activeBreakdown.shared} · Exclusive: {activeBreakdown.exclusive})
                  </span>
                </span>
              )}
              {schoolFilter === 'inactive' && (
                <span>
                  <strong style={{ color: 'var(--text-main)' }}>{inactiveUniqueCount}</strong> unique inactive schools across <strong style={{ color: 'var(--text-main)' }}>{filterCounts.inactive}</strong> campuses
                </span>
              )}
              {schoolFilter === 'no_teachers' && (
                <span>
                  <strong style={{ color: 'var(--text-main)' }}>{noTeachersUniqueCount}</strong> unique schools with no assigned teachers across <strong style={{ color: 'var(--text-main)' }}>{filterCounts.no_teachers}</strong> campuses
                </span>
              )}
              {schoolFilter === 'temporary' && (
                <span>
                  <strong style={{ color: 'var(--text-main)' }}>{temporaryUniqueCount}</strong> unique temporary schools across <strong style={{ color: 'var(--text-main)' }}>{filterCounts.temporary}</strong> campuses
                </span>
              )}
              {schoolFilter === 'all' && (
                <span>
                  <strong style={{ color: 'var(--text-main)' }}>{uniqueSchoolCount}</strong> unique schools across <strong style={{ color: 'var(--text-main)' }}>{filterCounts.all}</strong> campuses
                </span>
              )}
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
              {/* Bulk Edit Toggle */}
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
              {/* Sync Schools with GrapeSEED */}
              <button
                type="button"
                className="tm-pure-icon"
                onClick={handleSchoolSync}
                title="Sync Schools with GrapeSEED"
                style={{ marginLeft: '8px' }}
              >
                <RefreshCw size={18} strokeWidth={2} />
              </button>
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
          {/* 🟢 NEW: Status Filter Tabs */}
          <div className="filter-tabs-row" style={{ marginTop: '16px' }}>
            <button
              className={`filter-tab ${schoolFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSchoolFilter('all')}
            >
              All Schools <span className="count-badge">{totalUniqueSchoolCount}</span>
            </button>
            <button
              className={`filter-tab ${schoolFilter === 'active' ? 'active-green' : ''}`}
              onClick={() => setSchoolFilter('active')}
            >
              Active <span className="count-badge-color">{activeUniqueCount}</span>
            </button>
            <button
              className={`filter-tab ${schoolFilter === 'inactive' ? 'active-red' : ''}`}
              onClick={() => setSchoolFilter('inactive')}
            >
              Inactive <span className="count-badge-color">{inactiveUniqueCount}</span>
            </button>
            <button
              className={`filter-tab ${schoolFilter === 'no_teachers' ? 'active-yellow' : ''}`}
              onClick={() => setSchoolFilter('no_teachers')}
            >
              No Teachers <span className="count-badge-color">{noTeachersUniqueCount}</span>
            </button>
            <button
              className={`filter-tab ${schoolFilter === 'temporary' ? 'active-blue' : ''}`}
              onClick={() => setSchoolFilter('temporary')}
            >
              Temporary <span className="count-badge-color">{temporaryUniqueCount}</span>
            </button>
            <button
              className={`filter-tab ${schoolFilter === 'needs_review' ? 'active-yellow' : ''}`}
              onClick={() => setSchoolFilter('needs_review')}
            >
              Needs Review <span className="count-badge-color">{needsReviewCount}</span>
            </button>
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
              {/* Action bar: bulk acknowledge/reject (Review tab) + delete selected (other tabs) */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px', gap: '8px' }}>
                {schoolFilter === 'needs_review' && needsReviewCount > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: '#eab308', color: '#000', border: 'none', fontWeight: 600 }}
                      onClick={() => handleAcknowledgeAllSchools(Array.from(selectedReviewIds))}
                      disabled={selectedReviewIds.size === 0}
                    >
                      ✨ Acknowledge Selected ({selectedReviewIds.size})
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: '#ef4444', color: '#fff', border: 'none', fontWeight: 600 }}
                      onClick={() => handleRejectAllSchools(Array.from(selectedReviewIds))}
                      disabled={selectedReviewIds.size === 0}
                    >
                      ↩️ Reject Selected ({selectedReviewIds.size})
                    </button>
                  </>
                )}
                {selectedReviewIds.size > 0 && schoolFilter !== 'needs_review' && (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: '#dc2626', color: '#fff', border: 'none', fontWeight: 600 }}
                    onClick={handleDeleteSelected}
                  >
                    ❌ Delete Selected ({selectedReviewIds.size})
                  </button>
                )}
              </div>
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
        onRefresh={() => setRefreshKey(prev => prev + 1)}
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
      <GrapeSeedLoginModal
        isOpen={showGrapeLogin}
        onClose={() => {
          setShowGrapeLogin(false);
          pendingSchoolSync.current = null;
        }}
        onSuccess={handleGrapeLoginSuccess}
      />
    </>
  );
};