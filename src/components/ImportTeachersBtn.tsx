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

      // 2. Fetch YOUR Schools (to link teachers correctly)
      const { data: schools, error: schoolErr } = await supabase
        .from('schools')
        .select('id, official_code, school_name, campus_name')
        .eq('trainer_id', user.id);
      
      if (schoolErr) throw schoolErr;
      if (!schools || schools.length === 0) throw new Error("No schools found. Please import Schools first.");

      // 3. Parse Excel
      const rows = await readXlsxFile(file);
      const dataRows = rows.slice(1);

      const teachersToInsert: any[] = [];
      const errors: string[] = [];

      // 4. Loop & Match
      dataRows.forEach((row, index) => {
        // Excel Cols: 0=Name, 1=Email, 2=SchoolCode, 3=Campus, 4=WorksheetURL
        const name = row[0]?.toString().trim();
        const email = row[1]?.toString().trim();
        const code = row[2]?.toString().trim();
        const campus = row[3]?.toString().trim();
        const url = row[4]?.toString().trim();

        if (!name || !code || !campus) {
           errors.push(`Row ${index + 2}: Missing Name, Code, or Campus.`);
           return;
        }

        // --- THE LOOKUP LOGIC ---
        // Find a school that matches BOTH the Code AND the Campus Name
        const matchedSchool = schools.find(s => 
            s.official_code?.toLowerCase() === code.toLowerCase() &&
            s.campus_name?.toLowerCase() === campus.toLowerCase()
        );

        if (matchedSchool) {
          teachersToInsert.push({
            trainer_id: user.id,
            name: name,
            email: email || null,
            school_id: matchedSchool.id,        // LINKED UUID
            school_name: matchedSchool.school_name, // COPIED TEXT (For easier display)
            campus: campus,                     // COPIED TEXT
            worksheet_url: url || null
          });
        } else {
          errors.push(`Row ${index + 2}: No match for Code "${code}" + Campus "${campus}"`);
        }
      });

      // 5. Report Errors
      if (errors.length > 0) {
        alert(`Found ${errors.length} issues:\n` + errors.slice(0, 5).join('\n') + (errors.length > 5 ? '\n...' : ''));
        const proceed = confirm(`We found ${teachersToInsert.length} valid teachers and ${errors.length} errors. Import the valid ones?`);
        if (!proceed) return;
      }

      // 6. Insert Valid Data
      if (teachersToInsert.length > 0) {
        const { error } = await supabase.from('teachers').insert(teachersToInsert);
        if (error) throw error;
        
        alert(`Successfully imported ${teachersToInsert.length} teachers!`);
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
            *Must match School Code & Campus exactly
        </p>
    </div>
  );
}