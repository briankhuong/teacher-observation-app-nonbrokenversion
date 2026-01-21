import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();
router.use(express.json());

let supabaseInstance = null;
function getSupabase() {
  if (supabaseInstance) return supabaseInstance;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  supabaseInstance = createClient(url, key);
  return supabaseInstance;
}

router.post("/api/sync-grapeseed", async (req, res) => {
  const { token, userId } = req.body; 
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  log("🚀 Sync Started: School Status + Teacher Email Harvest...");

  try {
    const supabase = getSupabase();
    if (!userId) throw new Error("❌ CRITICAL: No User ID provided.");

    // 1. GET YOUR SCHOOLS (Based on image_d48ab8.png schema)
    const { data: mySchools, error: dbError } = await supabase
      .from("schools")
      .select("id, school_name, official_code") // 'tags' removed as it's not in schema
      .eq("trainer_id", userId);

    if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);
    const validSchools = mySchools || [];
    const mySchoolCodes = new Set(validSchools.map(s => s.official_code).filter(Boolean));
    
    log(`🛡️ Filter Loaded: Scanning for your ${mySchoolCodes.size} schools.`);

    // 2. FETCH CLASS LIST
    const vbaUserId = "b6133f96-5f21-47ca-9ab3-1b4205bf073f";
    const myurl = `https://services.grapeseed.com/admin/v1/resources/users/${vbaUserId}/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName`;

    const response = await fetch(myurl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-gl-origin": "https://schools.grapeseed.com/",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) throw new Error(`API Failed: ${response.status}`);
    const allData = await response.json();

    // 3. PROCESS SCHOOLS (has_empty_class) & HARVEST TEACHER IDs
    const apiSchoolMap = new Map(); 
    const myTeacherIds = new Set();

    if (Array.isArray(allData)) {
      allData.forEach(item => {
        const sId = item.schoolId;
        if (mySchoolCodes.has(sId)) {
             // Tracking 'has_empty_class' logic
             if (!apiSchoolMap.has(sId)) apiSchoolMap.set(sId, false);
             if (!item.teacherId) apiSchoolMap.set(sId, true);
             // Harvesting Teacher IDs for email lookup
             if (item.teacherId) myTeacherIds.add(item.teacherId);
        }
      });
    }

    // UPDATE DB SCHOOL STATUS (has_empty_class column confirmed in image_d48ab8.png)
    let schoolsUpdatedCount = 0;
    for (const row of validSchools) {
      if (row.official_code && apiSchoolMap.has(row.official_code)) {
        const hasEmpty = apiSchoolMap.get(row.official_code);
        await supabase
          .from("schools")
          .update({ has_empty_class: hasEmpty }) 
          .eq("id", row.id);
        schoolsUpdatedCount++;
      }
    }
    log(`✅ Schools Status Updated: ${schoolsUpdatedCount}`);

    // 4. FETCH TEACHER EMAILS (Using 'ids' wrapper confirmed in diagnostics)
    log(`🔎 Harvesting emails for ${myTeacherIds.size} unique teachers...`);
    const resolvedEmails = new Set();

    if (myTeacherIds.size > 0) {
        const teacherIds = Array.from(myTeacherIds);
        const chunkSize = 50; 
        log("--------------------------------------------------");
        log("📋 TEACHER EMAILS FOUND:");

        for (let i = 0; i < teacherIds.length; i += chunkSize) {
            const chunk = teacherIds.slice(i, i + chunkSize);
            const payload = { ids: chunk }; 

            const userDetailsResp = await fetch("https://services.grapeseed.com/account/v1/users/getUsersByIds", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-gl-origin": "https://schools.grapeseed.com/"
                },
                body: JSON.stringify(payload)
            });

            if (userDetailsResp.ok) {
                const chunkUsers = await userDetailsResp.json();
                chunkUsers.forEach(u => {
                    // Field confirmed as 'email' (lowercase) from image_d63d71.jpg
                    if (u.email) {
                        const email = u.email.trim().toLowerCase();
                        log(`• ${email}`);
                        resolvedEmails.add(email);
                    }
                });
            }
        }
        log("--------------------------------------------------");
    }

    // 5. COMPARE & TAG TEACHERS (Using teachers.tags column from image_d4f7f2.png)
    const { data: dbTeachers } = await supabase
        .from("teachers")
        .select("id, email, tags")
        .eq("trainer_id", userId);

    const teacherSyncTag = "Active-Jan-2026";
    let teachersTaggedCount = 0;

    for (const teacher of (dbTeachers || [])) {
        if (!teacher.email) continue;
        const dbEmail = teacher.email.trim().toLowerCase();

        if (resolvedEmails.has(dbEmail)) {
            let currentTags = Array.isArray(teacher.tags) ? teacher.tags : [];
            if (!currentTags.includes(teacherSyncTag)) {
                currentTags.push(teacherSyncTag);
                await supabase
                  .from("teachers")
                  .update({ tags: currentTags })
                  .eq("id", teacher.id);
                teachersTaggedCount++;
            }
        }
    }
    log(`✅ Teachers Tagged as Active: ${teachersTaggedCount}`);

    res.json({ success: true, logs });

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;