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

  // 🛑 CONFIG: Change this to your actual GrapeSEED trainer tag name
  const myTrainerTagName = "brian"; 

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

    // 4. NEW: TAG AUDIT (Identify Mutual Teachers)
    const teacherAuditResults = new Map(); // Maps Teacher ID -> "Mutual" or "Exclusive"
    if (myTeacherIds.size > 0) {
        const idList = Array.from(myTeacherIds);
        const tagResp = await fetch("https://services.grapeseed.com/admin/v1/tags/entitytags", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`, 
                "Content-Type": "application/json", 
                "x-gl-origin": "https://schools.grapeseed.com/" 
            },
            body: JSON.stringify({ ids: idList })
        });

        if (tagResp.ok) {
            const tagData = await tagResp.json();
            tagData.forEach(entity => {
                // Filter out non-string tags like "2019" (keep only trainer names)
                const trainerNames = (entity.tags || [])
                    .map(t => t.name?.toLowerCase())
                    .filter(name => name && isNaN(name));

                // LOGIC: >1 trainer OR 1 trainer that isn't you = Mutual
                const isMutual = trainerNames.length > 1 || (trainerNames.length === 1 && !trainerNames.includes(myTrainerTagName.toLowerCase()));
                teacherAuditResults.set(entity.entityId, isMutual ? "Mutual" : "Exclusive");
            });
        }
    }

    // 5. RESOLVE EMAILS FROM API
    const emailToAuditMap = new Map(); // Maps Email -> "Mutual" or "Exclusive"
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
                    if (u.email) {
                        const email = u.email.trim().toLowerCase();
                        // Link the resolved email to the Audit status found in Step 4
                        emailToAuditMap.set(email, teacherAuditResults.get(u.id));
                    }
                });
            }
        }
    }

    // 6. COMPARE & UPDATE TEACHER STATUS (Modified for Tag Audit)
    const { data: dbTeachers } = await supabase
        .from("teachers")
        .select("id, email, name, tags, is_active, status")
        .eq("trainer_id", userId);

    let activeCount = 0;
    let inactiveCount = 0;

    for (const teacher of (dbTeachers || [])) {
        if (!teacher.email) continue;
        const dbEmail = teacher.email.trim().toLowerCase();
        
        const auditResult = emailToAuditMap.get(dbEmail); // "Mutual", "Exclusive", or undefined
        const isCurrentlyTeaching = !!auditResult;

        const updateData = {
            is_active: isCurrentlyTeaching,
            status: isCurrentlyTeaching ? "Active" : "Inactive"
        };

        if (isCurrentlyTeaching) {
            let currentTags = Array.isArray(teacher.tags) ? teacher.tags : [];
            
            // Standard Active Tag
            if (!currentTags.includes("Active-Jan-2026")) {
                currentTags.push("Active-Jan-2026");
            }

            // Logic: Apply or Remove "Mutual" tag
            if (auditResult === "Mutual") {
                if (!currentTags.includes("Mutual")) {
                    currentTags.push("Mutual");
                    log(`🏷️ Demoted: ${teacher.name} (${teacher.email}) -> Added Mutual tag.`);
                }
            } else if (auditResult === "Exclusive") {
                if (currentTags.includes("Mutual")) {
                    currentTags = currentTags.filter(t => t !== "Mutual");
                    log(`✨ Promoted: ${teacher.name} (${teacher.email}) -> Removed Mutual tag.`);
                }
            }

            updateData.tags = currentTags;
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