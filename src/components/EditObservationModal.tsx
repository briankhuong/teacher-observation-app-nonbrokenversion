import React, { useState, useEffect, useMemo } from 'react';
import type { DashboardObservationRow } from '../DashboardShell';
import { supabase } from '../supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { SCHOOL_MASTER_LIST } from '../schoolMaster';
import { getGraphAccessToken } from '../msal/getGraphToken';
import { OneDrivePicker } from './OneDrivePicker';
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
interface EditObservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  observation: DashboardObservationRow | null;
  onSave: (id: string, updatedMeta: Partial<DashboardObservationRow['meta']>) => void;
}
export const EditObservationModal: React.FC<EditObservationModalProps> = ({
  isOpen,
  onClose,
  observation,
  onSave,
}) => {
  const { user } = useAuth();
  const [teacherName, setTeacherName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [campus, setCampus] = useState('');
  const [unit, setUnit] = useState('');
  const [lesson, setLesson] = useState('');
  const [supportType, setSupportType] = useState<DashboardObservationRow['supportType']>('Visit');
  const [date, setDate] = useState(''); // ISO date string YYYY-MM-DD
  const [worksheetUrl, setWorksheetUrl] = useState('');
  const [lookupStatus, setLookupStatus] = useState<"idle" | "searching" | "no_match" | "found">("idle");
  const [lookupResults, setLookupResults] = useState<{ school_name: string; campus: string; worksheet_url: string }[]>([]);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);
  // --- Admin URL state ---
  const [adminWorkbookUrl, setAdminWorkbookUrl] = useState('');
  const [adminViewOnlyUrl, setAdminViewOnlyUrl] = useState('');
  const [adminLookupStatus, setAdminLookupStatus] = useState<"idle" | "searching" | "no_match" | "found">("idle");
  const [adminLookupResults, setAdminLookupResults] = useState<{ school_name: string; campus_name: string; admin_workbook_url: string; admin_workbook_view_url: string | null }[]>([]);
  // --- OneDrive integration for BOTH teacher and admin ---
  const [showTeacherOneDrivePicker, setShowTeacherOneDrivePicker] = useState(false);
  const [showAdminOneDrivePicker, setShowAdminOneDrivePicker] = useState(false);
  const [oneDriveTeacherFolder, setOneDriveTeacherFolder] = useState<{ driveId: string; folderId: string; folderName: string } | null>(null);
  const [oneDriveAdminFolder, setOneDriveAdminFolder] = useState<{ driveId: string; folderId: string; folderName: string } | null>(null);
  useEffect(() => {
    if (isOpen && observation) {
      setTeacherName(observation.teacherName || '');
      setSchoolName(observation.schoolName || '');
      setCampus(observation.campus || '');
      setUnit(observation.unit || '');
      setLesson(observation.lesson || '');
      setSupportType(observation.supportType || 'Visit');
      setDate(observation.isoDate || '');
      setWorksheetUrl(observation.meta?.teacherWorkbookUrl || '');
      setAdminWorkbookUrl(observation.adminWorkbookUrl || observation.meta?.adminWorkbookUrl || '');
      setAdminViewOnlyUrl(observation.adminViewOnlyUrl || observation.meta?.adminWorkbookViewUrl || '');
      setLookupStatus("idle");
      setLookupResults([]);
      setAdminLookupStatus("idle");
      setAdminLookupResults([]);
    }
  }, [isOpen, observation]);
  // Load OneDrive folder settings for BOTH teacher and admin
  useEffect(() => {
    if (!isOpen || !user) return;
    (async () => {
      const { data } = await supabase
        .from("trainer_settings")
        .select("teacher_folder_drive_id, teacher_folder_item_id, admin_folder_drive_id, admin_folder_item_id")
        .eq("trainer_id", user.id)
        .single();
      if (data) {
        // Teacher folder
        if (data.teacher_folder_drive_id && data.teacher_folder_item_id) {
          setOneDriveTeacherFolder({
            driveId: data.teacher_folder_drive_id,
            folderId: data.teacher_folder_item_id,
            folderName: "Teacher Workbooks",
          });
        }
        // Admin folder — use dedicated admin folder if available, fallback to teacher folder
        if (data.admin_folder_drive_id && data.admin_folder_item_id) {
          setOneDriveAdminFolder({
            driveId: data.admin_folder_drive_id,
            folderId: data.admin_folder_item_id,
            folderName: "Admin Workbooks",
          });
        } else if (data.teacher_folder_drive_id && data.teacher_folder_item_id) {
          // Fallback: start from teacher folder's parent so user can navigate
          setOneDriveAdminFolder({
            driveId: data.teacher_folder_drive_id,
            folderId: data.teacher_folder_item_id,
            folderName: "Teacher Workbooks",
          });
        }
      }
    })();
  }, [isOpen, user]);
  // Called when a file is selected in OneDrive picker for TEACHER worksheet
  const handleTeacherOneDriveFileSelected = async (item: { name: string; driveId: string; itemId: string }) => {
    setShowTeacherOneDrivePicker(false);
    try {
      const token = await getGraphAccessToken();
      const resp = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${item.driveId}/items/${item.itemId}/createLink`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "edit", scope: "anonymous" }),
        }
      );
      if (!resp.ok) throw new Error("Failed to create sharing link");
      const data = await resp.json();
      setWorksheetUrl(data.link.webUrl);
      setLookupStatus("idle");
    } catch (err: any) {
      alert("Could not create sharing link: " + err.message);
    }
  };
  // Called when a file is selected in OneDrive picker for ADMIN workbook
  const handleAdminOneDriveFileSelected = async (item: { name: string; driveId: string; itemId: string }) => {
    setShowAdminOneDrivePicker(false);
    try {
      const token = await getGraphAccessToken();
      const resp = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${item.driveId}/items/${item.itemId}/createLink`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "edit", scope: "anonymous" }),
        }
      );
      if (!resp.ok) throw new Error("Failed to create sharing link");
      const data = await resp.json();
      setAdminWorkbookUrl(data.link.webUrl);
      setAdminViewOnlyUrl(data.link.webUrl);
      setAdminLookupStatus("idle");
    } catch (err: any) {
      alert("Could not create sharing link: " + err.message);
    }
  };
  // Admin workbook DB lookup (search schools table)
  const handleAdminWorkbookLookup = async () => {
    if (!schoolName.trim()) return;
    setAdminLookupStatus("searching");
    setAdminLookupResults([]);
    const { data, error } = await supabase
      .from("schools")
      .select("school_name, campus_name, admin_workbook_url, admin_workbook_view_url")
      .eq("trainer_id", user?.id)
      .ilike("school_name", `%${schoolName.trim()}%`)
      .not("admin_workbook_url", "is", null);
    if (error) {
      console.error("Admin lookup failed", error);
      setAdminLookupStatus("idle");
      return;
    }
    if (!data || data.length === 0) {
      setAdminLookupStatus("no_match");
    } else {
      const uniqueResults = data.filter((v, i, a) => a.findIndex(t => t.admin_workbook_url === v.admin_workbook_url) === i);
      setAdminLookupResults(uniqueResults);
      setAdminLookupStatus("found");
    }
  };
  const handleWorkbookLookup = async () => {
    if (!teacherName.trim()) return;
    setLookupStatus("searching");
    setLookupResults([]);
    const { data, error } = await supabase
      .from("teachers")
      .select("school_name, campus, worksheet_url")
      .eq("trainer_id", user?.id)
      .ilike("name", `%${teacherName.trim()}%`) // Search by name instead of email
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
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadSchools() {
      try {
        setSchoolsLoading(true);
        setSchoolsError(null);
        const { data, error } = await supabase
          .from("schools")
          .select("school_name, campus_name")
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
  const schoolOptions = useMemo(() => {
    const names = (schools.length
      ? schools.map((s) => s.school_name)
      : SCHOOL_MASTER_LIST.map((s) => s.schoolName)
    ).filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [schools]);
  const campusOptions = useMemo(() => {
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
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (observation) {
      onSave(observation.id, {
        teacherName,
        schoolName,
        campus,
        unit,
        lesson,
        supportType,
        date,
        teacherWorkbookUrl: worksheetUrl,
        adminWorkbookUrl: adminWorkbookUrl,
        adminWorkbookViewUrl: adminViewOnlyUrl || adminWorkbookUrl,
      });
      onClose();
    }
  };
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">Edit Observation Metadata</div>
          <div className="modal-subtitle">
            {observation?.teacherName} – {observation?.schoolName}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          <div className="form-row">
            <label>Teacher Name:</label>
            <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} className="input" required />
          </div>
          <div className="form-row">
            <label>Teacher Worksheet link:</label>
            <div style={{ position: 'relative' }}>
              <div className="input-group" style={{ display: 'flex' }}>
                <input
                  className="input"
                  type="url"
                  value={worksheetUrl}
                  onChange={(e) => setWorksheetUrl(e.target.value)}
                  placeholder="Paste URL, search by teacher name, or browse OneDrive..."
                  style={{ flexGrow: 1 }}
                />
                <button
                  type="button"
                  className="btn-append"
                  title="Search for existing workbook by teacher name"
                  disabled={!teacherName.trim() || lookupStatus === "searching"}
                  onClick={handleWorkbookLookup}
                  style={{ padding: '0 12px', background: '#334155', color: 'white', border: '1px solid #475569', borderLeft: 'none', cursor: 'pointer' }}
                >
                  {lookupStatus === "searching" ? "..." : "🔍"}
                </button>
                <button
                  type="button"
                  className="btn-append"
                  title="Browse OneDrive for teacher workbook"
                  onClick={() => setShowTeacherOneDrivePicker(true)}
                  style={{ padding: '0 12px', background: '#2563eb', color: 'white', border: '1px solid #1d4ed8', borderLeft: 'none', borderRadius: '0 6px 6px 0', cursor: 'pointer' }}
                >
                  ☁️
                </button>
              </div>
              {lookupStatus === "no_match" && (
                <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <span>No workbook found for this teacher in database.</span>
                  <span style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }} onClick={() => setLookupStatus("idle")}>×</span>
                </div>
              )}
              {lookupStatus === "found" && (
                <div className="lookup-picker" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', marginTop: '4px', padding: '8px', zIndex: 10, boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', padding: '0 4px' }}>
                    <strong style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Matches Found (click to use)</strong>
                    <span style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => setLookupStatus("idle")}>×</span>
                  </div>
                  {lookupResults.map((res, i) => (
                    <div
                      key={i}
                      className="lookup-item"
                      style={{ padding: '6px', cursor: 'pointer', borderBottom: i < lookupResults.length - 1 ? '1px solid #334155' : 'none' }}
                      onClick={() => {
                        setWorksheetUrl(res.worksheet_url);
                        setLookupStatus("idle");
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc' }}>{res.school_name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{res.campus}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="form-row">
            <label>Admin Workbook link:</label>
            <div style={{ position: 'relative' }}>
              <div className="input-group" style={{ display: 'flex' }}>
                <input
                  className="input"
                  type="url"
                  value={adminWorkbookUrl}
                  onChange={(e) => setAdminWorkbookUrl(e.target.value)}
                  placeholder="Paste URL, search by school name, or browse OneDrive..."
                  style={{ flexGrow: 1 }}
                />
                <button
                  type="button"
                  className="btn-append"
                  title="Search for existing admin workbook by school name"
                  disabled={!schoolName.trim() || adminLookupStatus === "searching"}
                  onClick={handleAdminWorkbookLookup}
                  style={{ padding: '0 12px', background: '#334155', color: 'white', border: '1px solid #475569', borderLeft: 'none', cursor: 'pointer' }}
                >
                  {adminLookupStatus === "searching" ? "..." : "🔍"}
                </button>
                <button
                  type="button"
                  className="btn-append"
                  title="Browse OneDrive for admin workbook"
                  onClick={() => setShowAdminOneDrivePicker(true)}
                  style={{ padding: '0 12px', background: '#2563eb', color: 'white', border: '1px solid #1d4ed8', borderLeft: 'none', borderRadius: '0 6px 6px 0', cursor: 'pointer' }}
                >
                  ☁️
                </button>
              </div>
              {adminLookupStatus === "no_match" && (
                <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <span>No admin workbook found for this school in database.</span>
                  <span style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }} onClick={() => setAdminLookupStatus("idle")}>×</span>
                </div>
              )}
              {adminLookupStatus === "found" && (
                <div className="lookup-picker" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', marginTop: '4px', padding: '8px', zIndex: 10, boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', padding: '0 4px' }}>
                    <strong style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Matches Found (click to use)</strong>
                    <span style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => setAdminLookupStatus("idle")}>×</span>
                  </div>
                  {adminLookupResults.map((res, i) => (
                    <div
                      key={i}
                      className="lookup-item"
                      style={{ padding: '6px', cursor: 'pointer', borderBottom: i < adminLookupResults.length - 1 ? '1px solid #334155' : 'none' }}
                      onClick={() => {
                        setAdminWorkbookUrl(res.admin_workbook_url);
                        setAdminViewOnlyUrl(res.admin_workbook_view_url || res.admin_workbook_url);
                        setAdminLookupStatus("idle");
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc' }}>{res.school_name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{res.campus_name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="form-row">
            <label>School Name:</label>
            <select
              className="select"
              value={schoolName}
              onChange={(e) => { setSchoolName(e.target.value); setCampus(''); }}
              required
            >
              <option value="">Select school…</option>
              {schoolOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {schoolsError && <div className="field-error">Could not load schools ({schoolsError}).</div>}
          </div>
          <div className="form-row">
            <label>Campus:</label>
            <select
              className="select"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              disabled={!schoolName || campusOptions.length === 0}
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
            <label>Unit:</label>
            <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="input" />
          </div>
          <div className="form-row">
            <label>Lesson:</label>
            <input type="text" value={lesson} onChange={(e) => setLesson(e.target.value)} className="input" />
          </div>
          <div className="form-row">
            <label>Support Type:</label>
            <select value={supportType} onChange={(e) => setSupportType(e.target.value as DashboardObservationRow['supportType'])} className="select">
              <option value="Training">Training</option>
              <option value="LVA">LVA</option>
              <option value="Visit">Visit</option>
            </select>
          </div>
          <div className="form-row">
            <label>Date (YYYY-MM-DD):</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
          {/* Teacher OneDrive Picker */}
          {/* Teacher OneDrive Picker */}
          {showTeacherOneDrivePicker && (
            <OneDrivePicker
              mode="file"
              title="Select Teacher Worksheet"
              initialDriveId={oneDriveTeacherFolder?.driveId}
              initialFolderId={oneDriveTeacherFolder?.folderId}
              initialFolderName={oneDriveTeacherFolder?.folderName}
              onSelect={handleTeacherOneDriveFileSelected}
              onCancel={() => setShowTeacherOneDrivePicker(false)}
            />
          )}
          {/* Admin OneDrive Picker */}
          {showAdminOneDrivePicker && (
            <OneDrivePicker
              mode="file"
              title="Select Admin Workbook"
              initialDriveId={oneDriveAdminFolder?.driveId}
              initialFolderId={oneDriveAdminFolder?.folderId}
              initialFolderName={oneDriveAdminFolder?.folderName}
              onSelect={handleAdminOneDriveFileSelected}
              onCancel={() => setShowAdminOneDrivePicker(false)}
            />
          )}
        </form>
      </div>
    </div>
  );
};