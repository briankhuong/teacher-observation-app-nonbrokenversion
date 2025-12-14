import React, { useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { supabase } from '../supabaseClient';

export default function ImportTeachersBtn({ onUploadComplete }: { onUploadComplete: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // ... (Logic kept exactly the same) ...
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in.");

      const { data: schools, error: schoolErr } = await supabase
        .from('schools')
        .select('id, official_code, school_name, campus_name')
        .eq('trainer_id', user.id);
      
      if (schoolErr) throw schoolErr;
      if (!schools || schools.length === 0) throw new Error("No schools found. Please import Schools first.");

      const rows = await readXlsxFile(file);
      const dataRows = rows.slice(1);
      let rawTeachers: any[] = []; 
      const errors: string[] = [];

      dataRows.forEach((row, index) => {
        const name = row[0]?.toString().trim();       
        const email = row[1]?.toString().trim();      
        const code = row[2]?.toString().trim();       
        const campus = row[3]?.toString().trim();     
        const url = row[4]?.toString().trim();        

        if (!name || !code || !campus) {
           errors.push(`Row ${index + 2}: Missing Name, Code, or Campus.`);
           return;
        }
        const matchedSchool = schools.find(s => 
            s.official_code?.toLowerCase() === code.toLowerCase() &&
            s.campus_name?.toLowerCase() === campus.toLowerCase()
        );
        if (matchedSchool) {
          rawTeachers.push({
            trainer_id: user.id,            
            name: name,                     
            school_name: matchedSchool.school_name, 
            campus: campus,                 
            email: email || null,
            worksheet_url: url || null,
            school_id: matchedSchool.id,    
            updated_at: new Date().toISOString()
          });
        } else {
          errors.push(`Row ${index + 2}: School Code "${code}" + Campus "${campus}" not found.`);
        }
      });

      rawTeachers.sort((a, b) => {
          if (a.worksheet_url && !b.worksheet_url) return -1;
          if (!a.worksheet_url && b.worksheet_url) return 1;
          return 0;
      });

      const uniqueMap = new Map();
      const teachersToUpsert: any[] = [];
      for (const teacher of rawTeachers) {
          const uniqueKey = `${teacher.name}-${teacher.email || 'no-email'}-${teacher.campus}`.toLowerCase();
          if (!uniqueMap.has(uniqueKey)) {
              uniqueMap.set(uniqueKey, true);
              teachersToUpsert.push(teacher);
          }
      }
      
      const duplicateCount = rawTeachers.length - teachersToUpsert.length;
      if (errors.length > 0) {
        const proceed = confirm(`Found ${rawTeachers.length} rows (${duplicateCount} duplicates removed) and ${errors.length} errors.\nFirst error: ${errors[0]}\nProceed?`);
        if (!proceed) { setLoading(false); e.target.value = ''; return; }
      }

      if (teachersToUpsert.length > 0) {
        const { error } = await supabase
          .from('teachers')
          .upsert(teachersToUpsert, { onConflict: 'trainer_id, name, school_name, campus' });
        if (error) throw error;
        alert(`Success! Imported ${teachersToUpsert.length} teachers.`);
        onUploadComplete();
      } else {
        alert("No valid teachers found.");
      }
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* 1. Download Template (Outline Pill) */}
      <a
        href="/templates/teachers_template.xlsx"
        download
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors shadow-sm"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Template
      </a>

      {/* 2. Import Button (Blue Pill) */}
      <div>
        <input
          type="file"
          id="file-upload-teachers"
          accept=".xlsx"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
          disabled={loading}
        />
        <label
          htmlFor="file-upload-teachers"
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-full shadow-sm cursor-pointer transition-colors ${
            loading ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {loading ? 'Processing...' : 'Import Teachers'}
        </label>
      </div>
    </div>
  );
}