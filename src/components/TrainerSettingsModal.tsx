// src/components/TrainerSettingsModal.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";
import { OneDrivePicker } from "./OneDrivePicker";

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

    if (name) return <span style={{color: '#059669', fontWeight: 600}}>Selected: {name}</span>;
    if (id) return <span style={{color: '#2563eb'}}>✅ Configured (ID set)</span>;
    return <span style={{color: '#9ca3af'}}>Not configured</span>;
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
                <div className="settings-section">
                  <h4 style={{ marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "6px" }}>📄 Templates (Sources)</h4>
                  
                  {/* Teacher Template */}
                  <div className="form-row">
                    <label>Teacher Master File</label>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                         {renderStatus("teacher_template")}
                         <button className="btn btn-sm" onClick={() => openPicker("file", "teacher_template")}>Select File</button>
                    </div>
                  </div>

                  {/* Admin Template (Mapped to 'school_template' in logic) */}
                  <div className="form-row">
                    <label>School/Admin Master File</label>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
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
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                         {renderStatus("teacher_folder")}
                         <button className="btn btn-sm" onClick={() => openPicker("folder", "teacher_folder")}>Select Folder</button>
                    </div>
                  </div>

                  {/* School Folder */}
                  <div className="form-row">
                    <label>Schools Root Folder</label>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                         {renderStatus("school_folder")}
                         <button className="btn btn-sm" onClick={() => openPicker("folder", "school_folder")}>Select Folder</button>
                    </div>
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
    </>
  );
};