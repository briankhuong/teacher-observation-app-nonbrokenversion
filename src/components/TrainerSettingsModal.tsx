// src/components/TrainerSettingsModal.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";
import { OneDrivePicker } from "./OneDrivePicker";
import ExcelJS from "exceljs";
import { getGraphAccessToken } from "../msal/getGraphToken";
interface SettingsState {
  teacher_template_name?: string;
  teacher_template_drive_id?: string;
  teacher_template_item_id?: string;
  // We support BOTH old "admin" and new "school" keys to fix the sync issue
  admin_template_name?: string;
  admin_template_drive_id?: string;
  admin_template_item_id?: string;
  school_template_name?: string;     // 🟢 NEW
  school_template_drive_id?: string; // 🟢 NEW
  school_template_item_id?: string;  // 🟢 NEW
  teacher_folder_name?: string;
  teacher_folder_drive_id?: string;
  teacher_folder_item_id?: string;
  school_folder_name?: string;
  school_folder_drive_id?: string;
  school_folder_item_id?: string;
  booking_url?: string;
  phone_number?: string;
}
export const TrainerSettingsModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsState>({});
  const [showPicker, setShowPicker] = useState(false);
  const [forceUpdateTeachers, setForceUpdateTeachers] = useState(false);
  const [forceUpdateAdmins, setForceUpdateAdmins] = useState(false);
  const [distributeStatus, setDistributeStatus] = useState<{
    active: boolean;
    target: 'teachers' | 'admins';
    forceUpdate: boolean;
    progress: string;
    logs: string[];
  } | null>(null);
  const [pickerMode, setPickerMode] = useState<"file" | "folder">("file");
  const [pickerTarget, setPickerTarget] = useState<string | null>(null);
  useEffect(() => {
    if (open && user) {
      loadSettings();
    }
  }, [open, user]);
  const loadSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("trainer_settings")
      .select("*")
      .eq("trainer_id", user?.id)
      .single();
    if (!error && data) {
      // 🟢 SMART LOAD: If 'school_*' is missing but 'admin_*' exists, fill it in (and vice versa)
      const merged = { ...data };
      // Sync Admin Template -> School Template
      if (merged.admin_template_item_id && !merged.school_template_item_id) {
        merged.school_template_item_id = merged.admin_template_item_id;
        merged.school_template_drive_id = merged.admin_template_drive_id;
        merged.school_template_name = merged.admin_template_name;
      }
      // Sync School Template -> Admin Template
      if (merged.school_template_item_id && !merged.admin_template_item_id) {
        merged.admin_template_item_id = merged.school_template_item_id;
        merged.admin_template_drive_id = merged.school_template_drive_id;
        merged.admin_template_name = merged.school_template_name;
      }
      setSettings(merged);
    }
    setLoading(false);
  };
  const getSavedSettings = async (): Promise<SettingsState | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("trainer_settings")
      .select("*")
      .eq("trainer_id", user.id)
      .single();
    if (error || !data) return null;
    return data as SettingsState;
  };
  /** Deep‑copy a worksheet preserving ALL formatting (columns, rows, cells, merges, CF, page setup). */
  function copySheetFormat(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet) {
    // 1. Copy column definitions (width, style, hidden, key)
    if (source.columns) {
      target.columns = source.columns.map(col => ({
        key: col.key,
        width: col.width,
        style: col.style,
        hidden: col.hidden,
      }));
    }
    // 2. Copy rows: height, hidden, cell values, cell styles, data validations
    source.eachRow({ includeEmpty: true }, (sourceRow, rowNum) => {
      const targetRow = target.getRow(rowNum);
      targetRow.height = sourceRow.height;
      targetRow.hidden = sourceRow.hidden;
      sourceRow.eachCell({ includeEmpty: true }, (sourceCell, colNum) => {
        const targetCell = targetRow.getCell(colNum);
        targetCell.value = sourceCell.value;
        targetCell.style = sourceCell.style;
        if (sourceCell.dataValidation) targetCell.dataValidation = sourceCell.dataValidation;
      });
      targetRow.commit();
    });
    // 3. Copy merged cells
    // @ts-ignore
    const merges = source.model?.merges || [];
    merges.forEach((range: string) => target.mergeCells(range));
    // 4. Copy conditional formatting
    // @ts-ignore
    const cfs = source.conditionalFormattings;
    if (cfs && cfs.length) {
      cfs.forEach((cf: any) => {
        target.addConditionalFormatting({ ref: cf.ref, rules: cf.rules });
      });
    }
    // 5. Copy page setup
    if (source.pageSetup) target.pageSetup = Object.assign({}, source.pageSetup);
  }
  const handleDistributeTemplates = async (target: 'teachers' | 'admins', forceUpdate: boolean) => {
    const token = await getGraphAccessToken();
    if (!token) {
      alert("Could not get Microsoft Graph token. Please sign in again.");
      return;
    }
    // Always fetch the latest SAVED settings from the database
    const savedSettings = await getSavedSettings();
    if (!savedSettings) {
      alert("Could not load your saved settings. Please configure and save them first.");
      return;
    }
    const folderDriveIdKey = target === 'teachers' ? 'teacher_folder_drive_id' : 'school_folder_drive_id';
    const folderItemIdKey = target === 'teachers' ? 'teacher_folder_item_id' : 'school_folder_item_id';
    const templateDriveIdKey = target === 'teachers' ? 'teacher_template_drive_id' : 'school_template_drive_id';
    const templateItemIdKey = target === 'teachers' ? 'teacher_template_item_id' : 'school_template_item_id';
    const templateSheetName = target === 'teachers' ? '_TEMPLATE' : '_ADMIN_TEMPLATE';
    const folderDriveId = (savedSettings as any)[folderDriveIdKey];
    const folderItemId = (savedSettings as any)[folderItemIdKey];
    const templateDriveId = (savedSettings as any)[templateDriveIdKey];
    const templateItemId = (savedSettings as any)[templateItemIdKey];
    // Warn if the UI has unsaved changes that differ from the database
    const currentFolderId = (settings as any)[folderItemIdKey];
    const currentTemplateId = (settings as any)[templateItemIdKey];
    const hasUnsavedChanges = currentFolderId !== folderItemId || currentTemplateId !== templateItemId;
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes in the Settings modal. The distribution will use the PREVIOUSLY SAVED folder/template. Click OK to continue with the saved ones, or Cancel to go back and save your new selections first."
      );
      if (!confirmed) return;
    }
    console.log(`📁 ${target} distribution using SAVED folder: ${folderDriveId}/${folderItemId}, template: ${templateDriveId}/${templateItemId}`);
    if (!folderDriveId || !folderItemId || !templateDriveId || !templateItemId) {
      alert(`Please configure the ${target} template file and folder first.`);
      return;
    }
    const baseUrl = 'https://graph.microsoft.com/v1.0';
    setDistributeStatus({
      active: true,
      target,
      forceUpdate,
      progress: 'Fetching folder contents...',
      logs: [],
    });
    try {
      const childrenUrl = `${baseUrl}/drives/${folderDriveId}/items/${folderItemId}/children`;
      const childrenResp = await fetch(childrenUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!childrenResp.ok) {
        if (childrenResp.status === 404) {
          throw new Error(`Folder not found. Please re-select the folder in Settings.`);
        }
        throw new Error(`Failed to list files: ${childrenResp.status}`);
      }
      const childrenData = await childrenResp.json();
      const files: { name: string; id: string }[] = (childrenData.value || []).filter(
        (item: any) => item.name?.toLowerCase().endsWith('.xlsx')
      );
      if (files.length === 0) {
        setDistributeStatus(prev => prev ? {
          ...prev,
          progress: 'No .xlsx files found in the selected folder.',
          logs: [],
        } : prev);
        return;
      }
      const templateDownloadUrl = `${baseUrl}/drives/${templateDriveId}/items/${templateItemId}/content`;
      const templateResp = await fetch(templateDownloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!templateResp.ok) throw new Error(`Failed to download template: ${templateResp.status}`);
      const templateBuffer = await templateResp.arrayBuffer();
      const logs: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setDistributeStatus(prev => prev ? { ...prev, progress: `Processing ${i + 1} of ${files.length}: ${file.name}` } : prev);
        try {
          const fileUrl = `${baseUrl}/drives/${folderDriveId}/items/${file.id}/content`;
          const fileResp = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!fileResp.ok) {
            logs.push(`❌ ${file.name}: download failed (${fileResp.status})`);
            continue;
          }
          const fileBuffer = await fileResp.arrayBuffer();
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(fileBuffer);
          const oppositeSheetName = target === 'teachers' ? '_ADMIN_TEMPLATE' : '_TEMPLATE';
          if (wb.getWorksheet(oppositeSheetName)) {
            logs.push(`⏭️ ${file.name}: ${target === 'teachers' ? 'admin' : 'teacher'} workbook – skipped`);
            continue;
          }
          const existingSheet = wb.getWorksheet(templateSheetName);
          if (existingSheet) {
            if (!forceUpdate) {
              logs.push(`⏭️ ${file.name}: template already present (skipped)`);
              continue;
            } else {
              wb.removeWorksheet(existingSheet.id);
              logs.push(`🔄 ${file.name}: removing old template and updating...`);
            }
          } else {
            logs.push(`✅ ${file.name}: adding template...`);
          }
          const templateWorkbook = new ExcelJS.Workbook();
          await templateWorkbook.xlsx.load(templateBuffer);
          const templateSheet = templateWorkbook.getWorksheet(templateSheetName);
          if (!templateSheet) {
            logs.push(`❌ ${file.name}: template sheet "${templateSheetName}" not found in master file`);
            continue;
          }
          const newSheet = wb.addWorksheet(templateSheetName, { state: 'veryHidden' });
          copySheetFormat(templateSheet, newSheet);
          const outBuffer = await wb.xlsx.writeBuffer();
          const uploadUrl = `${baseUrl}/drives/${folderDriveId}/items/${file.id}/content`;
          const uploadResp = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
            },
            body: outBuffer,
          });
          if (!uploadResp.ok) {
            logs.push(`❌ ${file.name}: upload failed (${uploadResp.status})`);
          }
        } catch (err: any) {
          logs.push(`❌ ${file.name}: error - ${err.message}`);
        }
      }
      setDistributeStatus(prev => prev ? {
        ...prev,
        progress: `Completed: ${files.length} file(s) processed.`,
        logs,
      } : prev);
    } catch (err: any) {
      setDistributeStatus(prev => prev ? {
        ...prev,
        progress: `Error: ${err.message}`,
      } : prev);
    }
  };
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    // 🟢 DUAL SAVE: Save to BOTH sets of columns to satisfy any backend version
    const payload = {
      trainer_id: user.id,
      teacher_template_drive_id: settings.teacher_template_drive_id,
      teacher_template_item_id: settings.teacher_template_item_id,
      // Save to OLD columns
      admin_template_drive_id: settings.school_template_drive_id || settings.admin_template_drive_id,
      admin_template_item_id: settings.school_template_item_id || settings.admin_template_item_id,
      // Save to NEW columns (The ones the new backend looks for)
      school_template_drive_id: settings.school_template_drive_id || settings.admin_template_drive_id,
      school_template_item_id: settings.school_template_item_id || settings.admin_template_item_id,
      teacher_folder_drive_id: settings.teacher_folder_drive_id,
      teacher_folder_item_id: settings.teacher_folder_item_id,
      school_folder_drive_id: settings.school_folder_drive_id,
      school_folder_item_id: settings.school_folder_item_id,
      // 🟢 NEW: Add these lines
      booking_url: settings.booking_url,
      phone_number: settings.phone_number,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("trainer_settings")
      .upsert(payload);
    setSaving(false);
    if (error) {
      alert("Error saving settings: " + error.message);
    } else {
      alert("Settings saved! (Synced to DB)");
      onClose();
    }
  };
  const openPicker = (mode: "file" | "folder", targetPrefix: string) => {
    setPickerMode(mode);
    setPickerTarget(targetPrefix);
    setShowPicker(true);
  };
  const handlePickerSelect = (item: { name: string; driveId: string; itemId: string }) => {
    if (!pickerTarget) return;
    setSettings(prev => {
      const next = { ...prev };
      const prefix = pickerTarget!;
      // Standard Update
      // @ts-ignore
      next[`${prefix}_name`] = item.name;
      // @ts-ignore
      next[`${prefix}_drive_id`] = item.driveId;
      // @ts-ignore
      next[`${prefix}_item_id`] = item.itemId;
      // 🟢 SYNC LOGIC: If user picks "admin_template", also update "school_template"
      if (prefix === "admin_template") {
        next.school_template_name = item.name;
        next.school_template_drive_id = item.driveId;
        next.school_template_item_id = item.itemId;
      }
      if (prefix === "school_template") {
        next.admin_template_name = item.name;
        next.admin_template_drive_id = item.driveId;
        next.admin_template_item_id = item.itemId;
      }
      return next;
    });
    setShowPicker(false);
  };
  const renderStatus = (prefix: string) => {
    // @ts-ignore
    const id = settings[`${prefix}_item_id`];
    // @ts-ignore
    const name = settings[`${prefix}_name`];
    if (name) return <span style={{ color: '#059669', fontWeight: 600 }}>Selected: {name}</span>;
    if (id) return <span style={{ color: '#2563eb' }}>✅ Configured (ID set)</span>;
    return <span style={{ color: '#9ca3af' }}>Not configured</span>;
  };
  if (!open) return null;
  return (
    <>
      <div className="modal-backdrop">
        <div className="modal-panel">
          <div className="modal-header">
            <div className="modal-title">Trainer Settings</div>
            <button onClick={onClose} className="btn">×</button>
          </div>
          <div className="modal-body">
            {loading ? (
              <div>Loading settings...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                {/* 1. SOURCES */}
                {/* 🟢 NEW: TEMPLATE DISTRIBUTION */}
                <div className="settings-section">
                  <h4 style={{ marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "6px" }}>📦 Distribute Templates to Workbooks</h4>
                  <p style={{ fontSize: "12px", color: "#666" }}>
                    Copy the hidden template sheet into every workbook in the selected folder.
                  </p>
                  {/* Teacher Distribution */}
                  <div style={{ marginBottom: "16px", border: "1px solid #ddd", padding: "12px", borderRadius: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>Teachers Folder</strong>
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          {settings.teacher_template_item_id && settings.teacher_folder_item_id
                            ? `Template: ${settings.teacher_template_name || 'Configured'} – Folder: ${settings.teacher_folder_name || 'Configured'}`
                            : "⚠️ Template or folder not configured"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <label style={{ fontSize: "12px" }}>
                          <input
                            type="checkbox"
                            checked={forceUpdateTeachers}
                            onChange={(e) => setForceUpdateTeachers(e.target.checked)}
                            disabled={!settings.teacher_template_item_id || !settings.teacher_folder_item_id || distributeStatus?.active}
                          /> Force update
                        </label>
                        <button
                          className="btn btn-sm"
                          disabled={!settings.teacher_template_item_id || !settings.teacher_folder_item_id || distributeStatus?.active}
                          onClick={() => handleDistributeTemplates('teachers', forceUpdateTeachers)}
                        >
                          Distribute to Teachers
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Admin/School Distribution */}
                  <div style={{ marginBottom: "16px", border: "1px solid #ddd", padding: "12px", borderRadius: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>Admins/Schools Folder</strong>
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          {settings.school_template_item_id && settings.school_folder_item_id
                            ? `Template: ${settings.school_template_name || 'Configured'} – Folder: ${settings.school_folder_name || 'Configured'}`
                            : "⚠️ Template or folder not configured"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <label style={{ fontSize: "12px" }}>
                          <input
                            type="checkbox"
                            checked={forceUpdateAdmins}
                            onChange={(e) => setForceUpdateAdmins(e.target.checked)}
                            disabled={!settings.school_template_item_id || !settings.school_folder_item_id || distributeStatus?.active}
                          /> Force update
                        </label>
                        <button
                          className="btn btn-sm"
                          disabled={!settings.school_template_item_id || !settings.school_folder_item_id || distributeStatus?.active}
                          onClick={() => handleDistributeTemplates('admins', forceUpdateAdmins)}
                        >
                          Distribute to Admins
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="settings-section">
                  <h4 style={{ marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "6px" }}>📄 Templates (Sources)</h4>
                  {/* Teacher Template */}
                  <div className="form-row">
                    <label>Teacher Master File</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {renderStatus("teacher_template")}
                      <button className="btn btn-sm" onClick={() => openPicker("file", "teacher_template")}>Select File</button>
                    </div>
                  </div>
                  {/* Admin Template (Mapped to 'school_template' in logic) */}
                  <div className="form-row">
                    <label>School/Admin Master File</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {/* We display status for 'school_template' which is our new source of truth */}
                      {renderStatus("school_template")}
                      <button className="btn btn-sm" onClick={() => openPicker("file", "school_template")}>Select File</button>
                    </div>
                  </div>
                </div>
                {/* 2. DESTINATIONS */}
                <div className="settings-section">
                  <h4 style={{ marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "6px" }}>📂 Destinations (Save Location)</h4>
                  {/* Teacher Folder */}
                  <div className="form-row">
                    <label>Teachers Root Folder</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {renderStatus("teacher_folder")}
                      <button className="btn btn-sm" onClick={() => openPicker("folder", "teacher_folder")}>Select Folder</button>
                    </div>
                  </div>
                  {/* School Folder */}
                  <div className="form-row">
                    <label>Schools Root Folder</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {renderStatus("school_folder")}
                      <button className="btn btn-sm" onClick={() => openPicker("folder", "school_folder")}>Select Folder</button>
                    </div>
                  </div>
                </div>
                {/* 🟢 3. NEW: CONTACT INFO SECTION */}
                <div className="settings-section">
                  <h4 style={{ marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "6px" }}>📞 Contact Info</h4>
                  {/* Booking URL */}
                  <div className="form-row" style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>Booking Page URL</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="https://outlook.office.com/bookwithme/..."
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db" }}
                      value={settings.booking_url || ""}
                      onChange={(e) => setSettings(prev => ({ ...prev, booking_url: e.target.value }))}
                    />
                  </div>
                  {/* Phone Number */}
                  <div className="form-row">
                    <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>Phone Number (for Email Signature)</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. 0912 345 678"
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db" }}
                      value={settings.phone_number || ""}
                      onChange={(e) => setSettings(prev => ({ ...prev, phone_number: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button onClick={onClose} className="btn">Cancel</button>
            <button onClick={handleSave} className="btn btn-primary" disabled={saving || loading}>
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
      {showPicker && (
        <OneDrivePicker
          mode={pickerMode}
          title={pickerMode === 'file' ? "Select Template File" : "Select Destination Folder"}
          onSelect={handlePickerSelect}
          onCancel={() => setShowPicker(false)}
        />
      )}
      {/* Distribution Progress Modal */}
      {distributeStatus?.active && (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <div className="modal-title">
                {distributeStatus.target === 'teachers' ? '📦 Distributing Teacher Template' : '📦 Distributing Admin Template'}
              </div>
              <button
                onClick={() => setDistributeStatus(null)}
                className="btn"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '12px', fontWeight: 600 }}>{distributeStatus.progress}</div>
              {distributeStatus.logs.length > 0 && (
                <div style={{
                  maxHeight: '300px', overflowY: 'auto',
                  background: '#1e293b',        // dark background
                  padding: '12px', borderRadius: '8px',
                  border: '1px solid #334155'
                }}>
                  {distributeStatus.logs.map((log, i) => {
                    let logColor = '#e2e8f0'; // default light text
                    if (log.startsWith('✅')) logColor = '#4ade80';
                    else if (log.startsWith('⏭️') || log.startsWith('🔄')) logColor = '#fbbf24';
                    else if (log.startsWith('❌')) logColor = '#f87171';
                    return (
                      <div key={i} style={{
                        fontSize: '12px', marginBottom: '4px',
                        color: logColor,
                        fontFamily: 'monospace'
                      }}>
                        {log}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setDistributeStatus(null)}
                className="btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};