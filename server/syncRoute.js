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

  log("🚀 Sync Started: Processing Active & Inactive Teachers...");

  try {
    const supabase = getSupabase();
    if (!userId) throw new Error("❌ CRITICAL: No User ID provided.");

    // 1. GET YOUR SCHOOLS
    const { data: mySchools, error: dbError } = await supabase
      .from("schools")
      .select("id, school_name, official_code")
      .eq("trainer_id", userId);

    if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);
    const validSchools = mySchools || [];
    const mySchoolCodes = new Set(validSchools.map(s => s.official_code).filter(Boolean));
    
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

    // 3. PROCESS SCHOOL STATUS & HARVEST IDs
    const apiSchoolMap = new Map(); 
    const myTeacherIds = new Set();

    if (Array.isArray(allData)) {
      allData.forEach(item => {
        const sId = item.schoolId;
        if (mySchoolCodes.has(sId)) {
             if (!apiSchoolMap.has(sId)) apiSchoolMap.set(sId, false);
             if (!item.teacherId) apiSchoolMap.set(sId, true);
             if (item.teacherId) myTeacherIds.add(item.teacherId);
        }
      });
    }

    // UPDATE SCHOOL STATUS
    for (const row of validSchools) {
      if (row.official_code && apiSchoolMap.has(row.official_code)) {
        await supabase.from("schools").update({ has_empty_class: apiSchoolMap.get(row.official_code) }).eq("id", row.id);
      }
    }

    // 4. RESOLVE EMAILS FROM API
    const resolvedEmails = new Set();
    if (myTeacherIds.size > 0) {
        const teacherIds = Array.from(myTeacherIds);
        const chunkSize = 50; 

        for (let i = 0; i < teacherIds.length; i += chunkSize) {
            const chunk = teacherIds.slice(i, i + chunkSize);
            const userDetailsResp = await fetch("https://services.grapeseed.com/account/v1/users/getUsersByIds", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-gl-origin": "https://schools.grapeseed.com/"
                },
                body: JSON.stringify({ ids: chunk }) 
            });

            if (userDetailsResp.ok) {
                const chunkUsers = await userDetailsResp.json();
                chunkUsers.forEach(u => {
                    if (u.email) resolvedEmails.add(u.email.trim().toLowerCase());
                });
            }
        }
    }

    // 5. COMPARE & UPDATE TEACHER STATUS (ACTIVE VS INACTIVE)
    const { data: dbTeachers } = await supabase
        .from("teachers")
        .select("id, email, name, tags, is_active, status")
        .eq("trainer_id", userId);

    let activeCount = 0;
    let inactiveCount = 0;

    for (const teacher of (dbTeachers || [])) {
        if (!teacher.email) continue;
        const dbEmail = teacher.email.trim().toLowerCase();
        const isCurrentlyTeaching = resolvedEmails.has(dbEmail);

        const updateData = {
            is_active: isCurrentlyTeaching,
            status: isCurrentlyTeaching ? "Active" : "Inactive"
        };

        // If active, ensure the tag exists
        if (isCurrentlyTeaching) {
            let currentTags = Array.isArray(teacher.tags) ? teacher.tags : [];
            if (!currentTags.includes("Active-Jan-2026")) {
                currentTags.push("Active-Jan-2026");
                updateData.tags = currentTags;
            }
            activeCount++;
        } else {
            inactiveCount++;
        }

        await supabase.from("teachers").update(updateData).eq("id", teacher.id);
    }

    log(`✅ Processed ${dbTeachers?.length || 0} teachers.`);
    log(`🎯 Results: ${activeCount} Active, ${inactiveCount} Inactive.`);

    res.json({ success: true, logs });

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;