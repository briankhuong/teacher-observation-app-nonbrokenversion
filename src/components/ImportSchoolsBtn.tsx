import React, { useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { supabase } from '../supabaseClient'; 
import { Download, Upload } from "lucide-react";

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
      // Skip header row (Row 1)
      const dataRows = rows.slice(1);
      
      if (dataRows.length === 0) throw new Error("File is empty.");

      // Map Excel Columns to DB Columns
      // Col 0: Code, 1: School*, 2: Campus*, 3: Address, 4: AdminName, 5: Email, 6: Phone, 7: AM, 8: AMEmail, 9: WorkbookURL
      const schoolsToUpsert = dataRows
        .filter(row => row[1] && row[2]) // Ensure School Name and Campus exist
        .map((row) => ({
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
          updated_at:         new Date().toISOString(),
        }));

      if (schoolsToUpsert.length === 0) {
        throw new Error("No valid rows found. Ensure 'School Name' (Col B) and 'Campus Name' (Col C) are filled.");
      }

      // 🟢 NEW: Remove Duplicates (Fixes "row affected second time" error)
      const uniqueSchools = Object.values(
        schoolsToUpsert.reduce((acc: any, school: any) => {
          // Use pipe | to separate fields safely
          const key = `${school.school_name}|${school.campus_name}`.toLowerCase().trim();
          acc[key] = school; 
          return acc;
        }, {})
      );

      // Upsert based on the SQL constraint we created
      const { error } = await supabase
        .from('schools')
        .upsert(uniqueSchools, { 
            onConflict: 'trainer_id, school_name, campus_name' 
        });

      if (error) throw error;

      alert(`Success! Processed ${schoolsToUpsert.length} schools.`);
      onUploadComplete(); 

    } catch (err: any) {
      console.error(err);
      alert('Error importing schools: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = ''; 
    }
  };

// Inside your ImportSchoolsBtn return...
return (
  <>
    {/* Download Template Icon */}
    <a
      href="/templates/schools_template.xlsx"
      download
      className="tm-pure-icon"
      title="Download Template"
    >
      <Download size={18} strokeWidth={2} />
    </a>

    {/* Import Icon */}
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input
        type="file"
        id="file-upload-schools"
        accept=".xlsx"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
      <label
        htmlFor="file-upload-schools"
        className="tm-pure-icon"
        title="Import Schools"
      >
        <Upload size={18} strokeWidth={2} />
      </label>
    </div>
  </>
);
}