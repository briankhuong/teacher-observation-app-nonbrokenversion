// src/SchoolsScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthContext";

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
  am_email: string;
  address: string;
  district: string;
  city: string;
  notes: string;
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
  city: "",
  notes: "",
};

interface SchoolFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: SchoolFormState;
  onCancel: () => void;
  onSubmit: (values: SchoolFormState) => Promise<void>;
}

const SchoolFormModal: React.FC<SchoolFormModalProps> = ({
  open,
  mode,
  initial,
  onCancel,
  onSubmit,
}) => {
  const [form, setForm] = useState<SchoolFormState>(initial ?? emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyForm);
      setSubmitting(false);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleChange =
    (field: keyof SchoolFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.school_name.trim() || !form.campus_name.trim()) {
      alert("Please fill in School name and Campus.");
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <div className="modal-title">
            {mode === "create" ? "Add school / campus" : "Edit school / campus"}
          </div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
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

          <div className="form-row">
            <label>Campus name *</label>
            <input
              className="input"
              type="text"
              value={form.campus_name}
              onChange={handleChange("campus_name")}
              placeholder="e.g. Cơ sở 1, Campus A…"
            />
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

          <div className="modal-footer">
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
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
        </form>
      </div>
    </div>
  );
};

export const SchoolsScreen: React.FC = () => {
  const { user } = useAuth();

  const [rows, setRows] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<SchoolRow | null>(null);

  // NEW: active row id
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null);

  if (!user) {
    // AuthGate should prevent this, but just in case
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title">Schools</div>
        </div>
        <div className="card-body">
          <p>You must be signed in to manage schools.</p>
        </div>
      </div>
    );
  }

  const trainerId = user.id;

  // Load schools for this trainer
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
            admin_name,
            admin_email,
            admin_phone,
            am_name,
            am_email,
            address,
            district,
            city,
            notes,
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
  }, [trainerId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.school_name.toLowerCase().includes(q) ||
        r.campus_name.toLowerCase().includes(q) ||
        (r.city ?? "").toLowerCase().includes(q) ||
        (r.district ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  const openCreate = () => {
    setFormMode("create");
    setEditingRow(null);
    setShowForm(true);
    setActiveSchoolId(null);
  };

  const openEdit = (row: SchoolRow) => {
    setFormMode("edit");
    setEditingRow(row);
    setShowForm(true);
    setActiveSchoolId(row.id);
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
    if (activeSchoolId === row.id) {
      setActiveSchoolId(null);
    }
  };

  const submitForm = async (values: SchoolFormState) => {
    if (formMode === "create") {
      const { data, error } = await supabase
        .from("schools")
        .insert({
          trainer_id: user.id,
          school_name: values.school_name.trim(),
          campus_name: values.campus_name.trim(),
          admin_name: values.admin_name.trim() || null,
          admin_email: values.admin_email.trim() || null,
          admin_phone: values.admin_phone.trim() || null,
          am_name: values.am_name.trim() || null,
          am_email: values.am_email.trim() || null,
          address: values.address.trim() || null,
          district: values.district.trim() || null,
          city: values.city.trim() || null,
          notes: values.notes.trim() || null,
        })
        .select(
          `
          id,
          trainer_id,
          school_name,
          campus_name,
          admin_name,
          admin_email,
          admin_phone,
          am_name,
          am_email,
          address,
          district,
          city,
          notes,
          created_at,
          updated_at
        `
        )
        .single();

      if (error) {
        console.error("[DB] create school error", error);
        alert("Could not create school. Please try again.");
        return;
      }

      const newRow = data as SchoolRow;
      setRows((prev) => [...prev, newRow]);
      setActiveSchoolId(newRow.id);
      setShowForm(false);
      return;
    }

    if (!editingRow) return;

    const { data, error } = await supabase
      .from("schools")
      .update({
        school_name: values.school_name.trim(),
        campus_name: values.campus_name.trim(),
        admin_name: values.admin_name.trim() || null,
        admin_email: values.admin_email.trim() || null,
        admin_phone: values.admin_phone.trim() || null,
        am_name: values.am_name.trim() || null,
        am_email: values.am_email.trim() || null,
        address: values.address.trim() || null,
        district: values.district.trim() || null,
        city: values.city.trim() || null,
        notes: values.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingRow.id)
      .eq("trainer_id", trainerId)
      .select(
        `
        id,
        trainer_id,
        school_name,
        campus_name,
        admin_name,
        admin_email,
        admin_phone,
        am_name,
        am_email,
        address,
        district,
        city,
        notes,
        created_at,
        updated_at
      `
      )
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
    setActiveSchoolId(updated.id);
    setShowForm(false);
  };

  const formInitial: SchoolFormState | undefined =
    formMode === "edit" && editingRow
      ? {
          school_name: editingRow.school_name,
          campus_name: editingRow.campus_name,
          admin_name: editingRow.admin_name ?? "",
          admin_email: editingRow.admin_email ?? "",
          admin_phone: editingRow.admin_phone ?? "",
          am_name: editingRow.am_name ?? "",
          am_email: editingRow.am_email ?? "",
          address: editingRow.address ?? "",
          district: editingRow.district ?? "",
          city: editingRow.city ?? "",
          notes: editingRow.notes ?? "",
        }
      : undefined;

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Schools & campuses</div>
            <div className="card-subtitle">
              Manage school metadata (admin, AM, address) used by observations
              and reports.
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-group">
              <span>Search</span>
              <input
                className="input search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="School, campus, city…"
              />
            </div>

            <div className="toolbar-group">
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreate}
              >
                + New school / campus
              </button>
            </div>
          </div>
        </div>

        <div className="card-body">
          {loading && <div>Loading schools…</div>}
          {loadError && (
            <div className="field-error">
              Could not load schools ({loadError})
            </div>
          )}

          {!loading && filteredRows.length === 0 && !loadError && (
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

          {!loading && filteredRows.length > 0 && (
            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>School & campus</th>
                    <th>Admin</th>
                    <th>AM</th>
                    <th>City</th>
                    <th style={{ width: 140 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const isActive = row.id === activeSchoolId;
                    return (
                      <tr
                        key={row.id}
                        className={
                          "simple-table-row" +
                          (isActive ? " simple-table-row--active" : "")
                        }
                        onClick={() => setActiveSchoolId(row.id)}
                      >
                        <td>
                          <div className="entity-cell-main">
                            {row.school_name}
                          </div>
                          <div className="entity-cell-sub">
                            {row.campus_name}
                          </div>
                        </td>
                        <td>
                          <div className="entity-cell-main">
                            {row.admin_name || "—"}
                          </div>
                          <div className="entity-cell-sub">
                            {row.admin_email || ""}
                          </div>
                        </td>
                        <td>
                          <div className="entity-cell-main">
                            {row.am_name || "—"}
                          </div>
                          <div className="entity-cell-sub">
                            {row.am_email || ""}
                          </div>
                        </td>
                        <td>
                          <div className="entity-cell-main">
                            {row.city || "—"}
                          </div>
                          <div className="entity-cell-sub">
                            {row.district || ""}
                          </div>
                        </td>
                        <td>
                          <div
                            className="table-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => openEdit(row)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => handleDelete(row)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <SchoolFormModal
        open={showForm}
        mode={formMode}
        initial={formInitial}
        onCancel={() => setShowForm(false)}
        onSubmit={submitForm}
      />
    </>
  );
};