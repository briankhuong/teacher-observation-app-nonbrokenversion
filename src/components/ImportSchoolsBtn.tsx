import React, { useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { supabase } from '../supabaseClient'; 

export default function ImportSchoolsBtn({ onUploadComplete }: { onUploadComplete: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in to upload.");

      const rows = await readXlsxFile(file);
      const dataRows = rows.slice(1);
      if (dataRows.length === 0) throw new Error("File is empty.");

      const schoolsToUpsert = dataRows.map((row) => ({
        trainer_id: user.id,
        official_code:      row[0]?.toString().trim() || null, 
        school_name:        row[1]?.toString().trim(), 
        campus_name:        row[2]?.toString().trim(), 
        address:            row[3]?.toString().trim() || null,
        admin_name:         row[4]?.toString().trim() || null,
        admin_email:        row[5]?.toString().trim() || null,
        admin_phone:        row[6]?.toString().trim() || null,
        am_name:            row[7]?.toString().trim() || null,
        am_email:           row[8]?.toString().trim() || null,
        admin_workbook_url: row[9]?.toString().trim() || null,
      }));

      const { error } = await supabase
        .from('schools')
        .upsert(schoolsToUpsert, { 
            onConflict: 'trainer_id, school_name, campus_name' 
        });

      if (error) throw error;
      alert(`Success! Processed ${schoolsToUpsert.length} rows.`);
      onUploadComplete(); 
    } catch (err: any) {
      console.error(err);
      alert('Error importing schools: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = ''; 
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* 1. Download Template (Outline Pill) */}
      <a
        href="/templates/schools_template.xlsx"
        download
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors shadow-sm"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Template
      </a>

      {/* 2. Import Button (Green Pill) */}
      <div>
        <input
          type="file"
          id="file-upload-schools"
          accept=".xlsx"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
          disabled={loading}
        />
        <label
          htmlFor="file-upload-schools"
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-full shadow-sm cursor-pointer transition-colors ${
            loading ? "bg-green-400 cursor-wait" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {loading ? 'Processing...' : 'Import Schools'}
        </label>
      </div>
    </div>
  );
}