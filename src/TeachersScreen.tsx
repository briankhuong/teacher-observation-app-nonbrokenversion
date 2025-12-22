// src/TeachersScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthContext";
import ImportTeachersBtn from "./components/ImportTeachersBtn";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import type { ColumnDef, SortingState, ColumnResizeMode, VisibilityState } from "@tanstack/react-table";

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
      <div className="modal-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">
            {mode === "create" ? "Add teacher" : "Edit teacher"}
          </div>
          <button type="button" className="btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit} style={{ flexGrow: 1, overflowY: "auto" }}>
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
  // const [columnResizeMode] = useState<ColumnResizeMode>("onEnd"); // REMOVED
  // const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({}); // REMOVED

  // Define Columns
  const columns = useMemo<ColumnDef<TeacherRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Teacher",
        cell: (info) => (
          <>
            <div className="entity-cell-main">{info.getValue() as string}</div>
            <div className="entity-cell-sub">{info.row.original.email || "—"}</div>
          </>
        ),
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
    [setShowColumnMenu]
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
          // Initial sorting is now handled by TanStack Table state
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
  }, [trainerId, refreshKey]);

  // Search/filtering is now handled by TanStack Table (getFilteredRowModel)
  // const filteredRows = useMemo(() => {
  //   const q = search.trim().toLowerCase();
  //   if (!q) return rows;
  //   return rows.filter((r) => {
  //     return (
  //       r.name.toLowerCase().includes(q) ||
  //       r.school_name.toLowerCase().includes(q) ||
  //       r.campus.toLowerCase().includes(q) ||
  //       (r.email ?? "").toLowerCase().includes(q)
  //     );
  //   });
  // }, [rows, search]);

  // UI helpers
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
      openView(newRow); // Open View Modal on creation
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
        }
      : undefined;

  // Open worksheet link is now handled in the View Modal
  // const handleOpenWorksheet = (row: TeacherRow) => {
  //   if (!row.worksheet_url) return;
  //   window.open(row.worksheet_url, "_blank", "noopener,noreferrer");
  // };

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
               <ImportTeachersBtn onUploadComplete={() => setRefreshKey(prev => prev + 1)} />
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
    </>
  );
};