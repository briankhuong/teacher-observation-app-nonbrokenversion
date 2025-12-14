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
      // 1. Get Current User
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in to upload.");

      // 2. Parse Excel
      const rows = await readXlsxFile(file);
      const dataRows = rows.slice(1); // Skip header row

      if (dataRows.length === 0) throw new Error("File is empty.");

      // 3. Map Rows to DB Columns
      const schoolsToUpsert = dataRows.map((row) => ({
        trainer_id: user.id,
        // The Identity Columns (Must match to trigger Update)
        official_code:      row[0]?.toString().trim() || null, 
        school_name:        row[1]?.toString().trim(), 
        campus_name:        row[2]?.toString().trim(), 
        
        // The Data Columns (These will be updated)
        address:            row[3]?.toString().trim() || null,
        admin_name:         row[4]?.toString().trim() || null,
        admin_email:        row[5]?.toString().trim() || null,
        admin_phone:        row[6]?.toString().trim() || null,
        am_name:            row[7]?.toString().trim() || null,
        am_email:           row[8]?.toString().trim() || null,
        admin_workbook_url: row[9]?.toString().trim() || null,
      }));

      // 4. UPSERT (Update if exists, Insert if new)
      const { error } = await supabase
        .from('schools')
        .upsert(schoolsToUpsert, { 
            // This must match the constraint we created in SQL
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
    <div className="flex flex-col gap-2 items-start">
        <div className="flex gap-3 items-center">
            <a 
                href="/templates/schools_template.xlsx" 
                download 
                className="text-xs text-blue-600 hover:underline"
            >
                Download Template
            </a>
            
            <label className="cursor-pointer bg-green-600 text-white text-sm px-4 py-2 rounded shadow hover:bg-green-700 transition">
                {loading ? 'Processing...' : 'Import Schools'}
                <input 
                type="file" 
                accept=".xlsx" 
                onChange={handleFileUpload} 
                className="hidden" 
                disabled={loading}
                />
            </label>
        </div>
        <p className="text-xs text-gray-500">
            *Re-uploading updates existing schools
        </p>
    </div>
  );
}