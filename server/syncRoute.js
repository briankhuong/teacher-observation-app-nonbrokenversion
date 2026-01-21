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

  log("🚀 Sync Started: Full Reconciliation (3-State Tags + Auto-Insert)...");

  try {
    const supabase = getSupabase();
    if (!userId) throw new Error("❌ CRITICAL: No User ID provided.");

    // 1. RESOLVE TRAINER NAME (Metadata Lookup)
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData?.user) throw new Error("Could not resolve Trainer Profile.");
    
    const meta = userData.user.user_metadata || {};
    const displayName = meta.display_name || meta.full_name || meta.name || ""; 
    const myTrainerTagName = displayName.split(" ")[0].toLowerCase().trim(); 

    if (!myTrainerTagName) throw new Error("❌ Name Resolution Failed: Trainer name is empty.");
    log(`👤 Syncing as Trainer: ${displayName} (Tag: ${myTrainerTagName})`);

    // 2. GET YOUR SCHOOLS
    const { data: mySchools, error: dbError } = await supabase
      .from("schools")
      .select("id, school_name, official_code")
      .eq("trainer_id", userId);

    if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);
    const validSchools = mySchools || [];
    const mySchoolCodes = new Set(validSchools.map(s => s.official_code).filter(Boolean));
    const schoolCodeToIdMap = new Map(validSchools.map(s => [s.official_code, s.id]));
    
    // 3. FETCH MASTER CLASS LIST
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

    if (!response.ok) throw new Error(`GrapeSEED API Failed: ${response.status}`);
    const allData = await response.json();

    const apiSchoolMap = new Map(); 
    const activeTeacherIdsInMySchools = new Set();
    const teacherIdToMetadata = new Map(); 

    if (Array.isArray(allData)) {
      allData.forEach(item => {
        const sId = item.schoolId;
        if (mySchoolCodes.has(sId)) {
             if (!apiSchoolMap.has(sId)) apiSchoolMap.set(sId, false);
             if (!item.teacherId) apiSchoolMap.set(sId, true);
             
             if (item.teacherId) {
                activeTeacherIdsInMySchools.add(item.teacherId);
                if (!teacherIdToMetadata.has(item.teacherId)) {
                   teacherIdToMetadata.set(item.teacherId, {
                      name: item.teacherName, 
                      school_name: item.schoolName,
                      campus: item.campusName,
                      school_id: schoolCodeToIdMap.get(sId)
                   });
                }
             }
        }
      });
    }

    // UPDATE SCHOOL STATUS (Badges)
    for (const row of validSchools) {
      if (row.official_code && apiSchoolMap.has(row.official_code)) {
        await supabase.from("schools").update({ has_empty_class: apiSchoolMap.get(row.official_code) }).eq("id", row.id);
      }
    }

    // 4. TAG AUDIT (THE PRE-FILL SOLUTION)
    const teacherAuditResults = new Map(); 
    activeTeacherIdsInMySchools.forEach(id => teacherAuditResults.set(id, "No tag"));

    if (activeTeacherIdsInMySchools.size > 0) {
        log(`🔬 Auditing tags for ${activeTeacherIdsInMySchools.size} teachers...`);
        const tagResp = await fetch("https://services.grapeseed.com/admin/v1/tags/entitytags", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`, 
                "Content-Type": "application/json", 
                "x-gl-origin": "https://schools.grapeseed.com/" 
            },
            body: JSON.stringify({ ids: Array.from(activeTeacherIdsInMySchools) })
        });

        if (tagResp.ok) {
            const tagData = await tagResp.json();
            tagData.forEach(entity => {
                const trainerNames = (entity.tags || [])
                    .map(t => t.name?.toLowerCase().trim())
                    .filter(name => name && isNaN(name));

                if (trainerNames.length === 1 && trainerNames[0] === myTrainerTagName) {
                    teacherAuditResults.set(entity.entityId, "CLEAR"); 
                } else if (trainerNames.length > 0) {
                    teacherAuditResults.set(entity.entityId, "Mutual");
                }
            });
        }
    }

    // 5. RESOLVE EMAILS & NAMES (CHUNKED BY 50)
    const emailToAuditMap = new Map(); 
    const teacherIdToEmailMap = new Map();
    const teacherIdToResolvedNameMap = new Map();

    if (activeTeacherIdsInMySchools.size > 0) {
        const teacherIds = Array.from(activeTeacherIdsInMySchools);
        const chunkSize = 50; 

        for (let i = 0; i < teacherIds.length; i += chunkSize) {
            const chunk = teacherIds.slice(i, i + chunkSize);
            const userDetailsResp = await fetch("https://services.grapeseed.com/account/v1/users/getUsersByIds", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "x-gl-origin": "https://schools.grapeseed.com/"
                },
                body: JSON.stringify({ ids: chunk }) 
            });

            if (userDetailsResp.ok) {
                const chunkUsers = await userDetailsResp.json();
                chunkUsers.forEach(u => {
                    if (u.email) {
                        const email = u.email.trim().toLowerCase();
                        emailToAuditMap.set(email, teacherAuditResults.get(u.id));
                        teacherIdToEmailMap.set(u.id, email);
                        // Captured from your browser observation: property is 'name'
                        teacherIdToResolvedNameMap.set(u.id, u.name || u.fullName || u.displayName);
                    }
                });
            }
        }
    }

    // 6. FINAL DB RECONCILIATION
    const { data: dbTeachers } = await supabase
        .from("teachers")
        .select("id, email, name, tags, is_active, status, grapeseed_id")
        .eq("trainer_id", userId);

    const existingEmails = new Set();
    const existingGsIds = new Set();
    let activeCount = 0;
    let inactiveCount = 0;

    for (const teacher of (dbTeachers || [])) {
        if (teacher.email) existingEmails.add(teacher.email.trim().toLowerCase());
        if (teacher.grapeseed_id) existingGsIds.add(teacher.grapeseed_id);

        if (!teacher.email) continue;
        const dbEmail = teacher.email.trim().toLowerCase();
        
        const auditResult = emailToAuditMap.get(dbEmail); 
        const isCurrentlyTeaching = emailToAuditMap.has(dbEmail); 

        const updateData = {
            is_active: isCurrentlyTeaching,
            status: isCurrentlyTeaching ? "Active" : "Inactive"
        };

        if (isCurrentlyTeaching) {
            let currentTags = Array.isArray(teacher.tags) ? teacher.tags : [];
            if (auditResult === "No tag") {
                if (!currentTags.includes("No tag")) currentTags.push("No tag");
                currentTags = currentTags.filter(t => t !== "Mutual");
            } 
            else if (auditResult === "Mutual") {
                if (!currentTags.includes("Mutual")) currentTags.push("Mutual");
                currentTags = currentTags.filter(t => t !== "No tag");
            } 
            else if (auditResult === "CLEAR") {
                currentTags = currentTags.filter(t => t !== "Mutual" && t !== "No tag");
            }
            updateData.tags = currentTags;
            activeCount++;
        } else {
            inactiveCount++;
        }
        await supabase.from("teachers").update(updateData).eq("id", teacher.id);
    }

    // 7. AUTO-INSERT MISSING TEACHERS
    let insertedCount = 0;
    for (const gsId of Array.from(activeTeacherIdsInMySchools)) {
        const email = teacherIdToEmailMap.get(gsId);
        if (!email) continue;

        if (!existingEmails.has(email) && !existingGsIds.has(gsId)) {
            const meta = teacherIdToMetadata.get(gsId);
            const auditResult = teacherAuditResults.get(gsId);
            const finalName = teacherIdToResolvedNameMap.get(gsId) || meta.name || "New Teacher";
            
            const insertTags = [];
            if (auditResult === "No tag") insertTags.push("No tag");
            if (auditResult === "Mutual") insertTags.push("Mutual");

            const { error: insErr } = await supabase.from("teachers").insert({
                trainer_id: userId,
                name: finalName, 
                email: email,
                school_name: meta.school_name,
                campus: meta.campus,
                school_id: meta.school_id,
                grapeseed_id: gsId,
                is_active: true,
                status: "Active",
                tags: insertTags
            });

            if (!insErr) {
                insertedCount++;
                log(`✨ New Teacher Added: ${finalName} (${email})`);
            } else {
                log(`⚠️ Insert failed for ${email}: ${insErr.message}`);
            }
        }
    }

    log(`✅ Sync Complete for ${displayName}.`);
    log(`🎯 Results: ${activeCount} Updated, ${insertedCount} Inserted, ${inactiveCount} Inactive.`);

    res.json({ success: true, logs });

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;