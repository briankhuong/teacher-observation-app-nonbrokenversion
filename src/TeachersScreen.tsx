// src/TeachersScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthContext";

export interface TeacherRow {
  id: string;
  trainer_id: string;
  name: string;
  email: string | null;
  school_name: string;
  campus: string;
  worksheet_url: string | null;
  created_at: string;
  updated_at: string;
}

type TeacherFormState = {
  name: string;
  email: string;
  school_name: string;
  campus: string;
  worksheet_url: string;
};

const emptyForm: TeacherFormState = {
  name: "",
  email: "",
  school_name: "",
  campus: "",
  worksheet_url: "",
};

interface TeacherFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: TeacherFormState;
  onCancel: () => void;
  onSubmit: (values: TeacherFormState) => Promise<void>;
}

const TeacherFormModal: React.FC<TeacherFormModalProps> = ({
  open,
  mode,
  initial,
  onCancel,
  onSubmit,
}) => {
  const [form, setForm] = useState<TeacherFormState>(initial ?? emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyForm);
      setSubmitting(false);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleChange =
    (field: keyof TeacherFormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.school_name.trim() || !form.campus.trim()) {
      alert("Please fill in Teacher, School and Campus.");
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
            {mode === "create" ? "Add teacher" : "Edit teacher"}
          </div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
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
            <input
              className="input"
              type="text"
              value={form.school_name}
              onChange={handleChange("school_name")}
              placeholder="e.g. VSK Sunshine"
            />
          </div>

          <div className="form-row">
            <label>Campus *</label>
            <input
              className="input"
              type="text"
              value={form.campus}
              onChange={handleChange("campus")}
              placeholder="e.g. Cổ Nhuế"
            />
          </div>

          <div className="form-row">
            <label>Worksheet link</label>
            <input
              className="input"
              type="url"
              value={form.worksheet_url}
              onChange={handleChange("worksheet_url")}
              placeholder="Paste OneDrive workbook URL…"
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

export const TeachersScreen: React.FC = () => {
  const { user } = useAuth();

  const [rows, setRows] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<TeacherRow | null>(null);

  // NEW: active row highlight
  const [activeTeacherId, setActiveTeacherId] = useState<string | null>(null);

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
            updated_at
          `
          )
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
  }, [trainerId]);

  // Search
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) ||
        r.school_name.toLowerCase().includes(q) ||
        r.campus.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  // UI helpers
  const openCreate = () => {
    setFormMode("create");
    setEditingRow(null);
    setShowForm(true);
    setActiveTeacherId(null);
  };

  const openEdit = (row: TeacherRow) => {
    setFormMode("edit");
    setEditingRow(row);
    setShowForm(true);
    setActiveTeacherId(row.id);
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
    if (activeTeacherId === row.id) {
      setActiveTeacherId(null);
    }
  };

  const submitForm = async (values: TeacherFormState) => {
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
      setActiveTeacherId(newRow.id);
      setShowForm(false);
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
    setActiveTeacherId(updated.id);
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
        }
      : undefined;

  // Open worksheet link
  const handleOpenWorksheet = (row: TeacherRow) => {
    if (!row.worksheet_url) return;
    window.open(row.worksheet_url, "_blank", "noopener,noreferrer");
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

        <div className="card-body">
          {loading && <div>Loading teachers…</div>}
          {loadError && (
            <div className="field-error">
              Could not load teachers ({loadError})
            </div>
          )}

          {!loading && filteredRows.length === 0 && !loadError && (
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

          {!loading && filteredRows.length > 0 && (
            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>School & campus</th>
                    <th>Email</th>
                    <th>Worksheet</th>
                    <th style={{ width: 140 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const isActive = row.id === activeTeacherId;
                    return (
                      <tr
                        key={row.id}
                        className={
                          "simple-table-row" +
                          (isActive ? " simple-table-row--active" : "")
                        }
                        onClick={() => setActiveTeacherId(row.id)}
                      >
                        <td>
                          <div className="entity-cell-main">{row.name}</div>
                          <div className="entity-cell-sub">
                            {row.email || "—"}
                          </div>
                        </td>
                        <td>
                          <div className="entity-cell-main">
                            {row.school_name}
                          </div>
                          <div className="entity-cell-sub">{row.campus}</div>
                        </td>
                        <td>
                          <div className="entity-cell-main">
                            {row.email || "—"}
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            disabled={!row.worksheet_url}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenWorksheet(row);
                            }}
                          >
                            {row.worksheet_url ? "Open" : "Not set"}
                          </button>
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

      <TeacherFormModal
        open={showForm}
        mode={formMode}
        initial={formInitial}
        onCancel={() => setShowForm(false)}
        onSubmit={submitForm}
      />
    </>
  );
};