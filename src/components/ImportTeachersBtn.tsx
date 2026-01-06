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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in.");

      // 1. Fetch existing schools for matching
      const { data: schools, error: schoolErr } = await supabase
        .from('schools')
        .select('id, official_code, school_name, campus_name')
        .eq('trainer_id', user.id);
      
      if (schoolErr) throw schoolErr;
      if (!schools || schools.length === 0) throw new Error("No schools found. Please import Schools first.");

      const rows = await readXlsxFile(file);
      const dataRows = rows.slice(1); // Skip header
      
      let rawTeachers: any[] = []; 
      const errors: string[] = [];

      dataRows.forEach((row, index) => {
        // Col 0: Name, 1: Email, 2: School Code/Name, 3: Campus, 4: Url
        const name = row[0]?.toString().trim();       
        const email = row[1]?.toString().trim();      
        const schoolIdentifier = row[2]?.toString().trim();       
        const campus = row[3]?.toString().trim();     
        const url = row[4]?.toString().trim();        

        if (!name || !schoolIdentifier || !campus) return; // Skip invalid rows

        // 2. Find School (Try Code first, then Name)
        const matchedSchool = schools.find(s => 
            (s.official_code && s.official_code.toLowerCase() === schoolIdentifier.toLowerCase() && s.campus_name?.toLowerCase() === campus.toLowerCase()) ||
            (s.school_name.toLowerCase() === schoolIdentifier.toLowerCase() && s.campus_name?.toLowerCase() === campus.toLowerCase())
        );

        if (matchedSchool) {
          rawTeachers.push({
            trainer_id: user.id,            
            name: name,                     
            school_name: matchedSchool.school_name, 
            campus: matchedSchool.campus_name, 
            email: email || null, // Null matches specific SQL constraints better than empty string
            worksheet_url: url || null,
            updated_at: new Date().toISOString()
          });
        } else {
          errors.push(`Row ${index + 2}: School "${schoolIdentifier}" + Campus "${campus}" not found.`);
        }
      });

      // 3. Deduplicate: Prefer rows with URLs
      // 🟢 IMPROVED: Use pipe '|' separator to prevent merging errors
      const uniqueMap = new Map();
      
      for (const t of rawTeachers) {
          const emailPart = t.email ? t.email.toLowerCase().trim() : 'no-email';
          // Using | is safer than - 
          const uniqueKey = `${t.name.toLowerCase().trim()}|${emailPart}|${t.school_name.toLowerCase().trim()}|${t.campus.toLowerCase().trim()}`;
          
          if (uniqueMap.has(uniqueKey)) {
             const existing = uniqueMap.get(uniqueKey);
             // If existing has no URL but new one does, upgrade it
             if (!existing.worksheet_url && t.worksheet_url) {
                 uniqueMap.set(uniqueKey, t); 
             }
          } else {
              uniqueMap.set(uniqueKey, t);
          }
      }
      
      const teachersToUpsert = Array.from(uniqueMap.values());

      if (errors.length > 0) {
        const proceed = confirm(`Found ${teachersToUpsert.length} valid teachers.\n\n${errors.length} rows had errors (school not found).\n\nProceed?`);
        if (!proceed) { setLoading(false); e.target.value = ''; return; }
      }

      if (teachersToUpsert.length > 0) {
        // 4. Upsert using the Email-aware constraint
        const { error } = await supabase
          .from('teachers')
          .upsert(teachersToUpsert, { 
            onConflict: 'trainer_id, email, name, school_name, campus' 
          });
        
        if (error) throw error;
        
        alert(`Success! Imported ${teachersToUpsert.length} teachers.`);
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
    <div className="flex items-center gap-2">
      <a
        href="/templates/teachers_template.xlsx"
        download
        className="btn btn-outline"
        style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
      >
        <span>📥</span> Template
      </a>

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
          className="btn btn-primary"
          style={{ cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <span>👩‍🏫</span>
          {loading ? 'Processing...' : 'Import Teachers'}
        </label>
      </div>
    </div>
  );
}