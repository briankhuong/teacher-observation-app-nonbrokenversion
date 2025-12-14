import React, { useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { supabase } from '../supabaseClient';

export default function ImportTeachersBtn({ onUploadComplete }: { onUploadComplete: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      // 1. Get User
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in.");

      // 2. Fetch Schools for Lookup
      const { data: schools, error: schoolErr } = await supabase
        .from('schools')
        .select('id, official_code, school_name, campus_name')
        .eq('trainer_id', user.id);
      
      if (schoolErr) throw schoolErr;
      if (!schools || schools.length === 0) throw new Error("No schools found. Please import Schools first.");

      // 3. Parse Excel
      const rows = await readXlsxFile(file);
      const dataRows = rows.slice(1);

      let rawTeachers: any[] = []; // Changed name to rawTeachers to indicate they aren't clean yet
      const errors: string[] = [];

      // 4. Loop & Prepare Data
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

      // --- NEW LOGIC STARTS HERE ---

      // 5. Smart Deduplication
      // Goal: If Name+Email+Campus are identical, keep the one with the workbook link.

      // A. Sort so rows with 'worksheet_url' come FIRST. 
      // This ensures that when we dedup, the "good" row is the one we keep.
      rawTeachers.sort((a, b) => {
          // If a has url and b doesn't, a comes first (-1)
          if (a.worksheet_url && !b.worksheet_url) return -1;
          // If b has url and a doesn't, b comes first (1)
          if (!a.worksheet_url && b.worksheet_url) return 1;
          return 0;
      });

      // B. Filter using a Map to ensure Uniqueness
      const uniqueMap = new Map();
      const teachersToUpsert: any[] = [];

      for (const teacher of rawTeachers) {
          // Create a unique key based on your criteria: Name + Email + Campus
          // We use lowerCase to avoid "John" vs "john" duplicates
          const uniqueKey = `${teacher.name}-${teacher.email || 'no-email'}-${teacher.campus}`.toLowerCase();

          if (!uniqueMap.has(uniqueKey)) {
              uniqueMap.set(uniqueKey, true); // Mark as seen
              teachersToUpsert.push(teacher); // Add to final list
          }
          // If uniqueMap HAS the key, we skip this row. 
          // Since we sorted above, we are skipping the "worse" version (the one without the link).
      }
      
      const duplicateCount = rawTeachers.length - teachersToUpsert.length;

      // --- NEW LOGIC ENDS HERE ---

      // 6. Report Errors (Optional stop)
      if (errors.length > 0) {
        const proceed = confirm(`Found ${rawTeachers.length} rows (${duplicateCount} duplicates removed) and ${errors.length} errors.\n\nFirst error: ${errors[0]}\n\nProceed with valid rows?`);
        if (!proceed) {
            setLoading(false);
            e.target.value = ''; 
            return;
        }
      }

      // 7. UPSERT
      if (teachersToUpsert.length > 0) {
        const { error } = await supabase
          .from('teachers')
          .upsert(teachersToUpsert, { 
            // ⚠️ Ensure this constraint exists in Supabase: (trainer_id, name, school_name, campus)
            onConflict: 'trainer_id, name, school_name, campus' 
          });

        if (error) throw error;
        
        // Updated Alert message to show user what happened
        alert(`Success! Imported ${teachersToUpsert.length} teachers.\n(Automatically removed ${duplicateCount} duplicates)`);
        onUploadComplete();
      } else {
        alert("No valid teachers found to import.");
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
    <div className="flex flex-col gap-2 items-start">
        <div className="flex gap-3 items-center">
            <a 
                href="/templates/teachers_template.xlsx" 
                download 
                className="text-xs text-blue-600 hover:underline"
            >
                Download Template
            </a>
            
            <label className="cursor-pointer bg-blue-600 text-white text-sm px-4 py-2 rounded shadow hover:bg-blue-700 transition">
                {loading ? 'Processing...' : 'Import Teachers'}
                <input type="file" accept=".xlsx" onChange={handleFileUpload} className="hidden" disabled={loading}/>
            </label>
        </div>
        <p className="text-xs text-gray-500">
            *Use exact Name & Campus to update existing
        </p>
    </div>
  );
}