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
  const { token, userId, dryRun = false } = req.body; 
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  log(`🚀 Sync Started (Mode: ${dryRun ? "DRY RUN" : "LIVE"})`);
  const startTime = Date.now();

  try {
    const supabase = getSupabase();
    if (!userId) throw new Error("❌ CRITICAL: No User ID provided.");

    // 1. RESOLVE TRAINER NAME (Metadata)
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const meta = userData?.user?.user_metadata || {};
    const displayName = meta.display_name || meta.full_name || meta.name || ""; 
    const myTrainerTagName = displayName.split(" ")[0].toLowerCase().trim(); 

    // 2. GET YOUR SCHOOLS
    const { data: mySchools } = await supabase.from("schools").select("id, official_code").eq("trainer_id", userId);
    const mySchoolCodes = new Set((mySchools || []).map(s => s.official_code).filter(Boolean));
    const schoolCodeToIdMap = new Map(mySchools.map(s => [s.official_code, s.id]));
    
    // 3. FETCH MASTER CLASS LIST (ACTIVE CLASSES ONLY)
    const vbaUserId = "b6133f96-5f21-47ca-9ab3-1b4205bf073f";
    const myurl = `https://services.grapeseed.com/admin/v1/resources/users/${vbaUserId}/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName`;

    const response = await fetch(myurl, {
      headers: { "Authorization": `Bearer ${token}`, "x-gl-origin": "https://schools.grapeseed.com/", "Content-Type": "application/json" }
    });
    const allData = await response.json();

    const apiSchoolMap = new Map(); 
    const activeTeacherIdsInMySchools = new Set();
    const teacherIdToMetadata = new Map(); 

    if (Array.isArray(allData)) {
      allData.forEach(item => {
        if (mySchoolCodes.has(item.schoolId)) {
          if (!apiSchoolMap.has(item.schoolId)) apiSchoolMap.set(item.schoolId, false);
          if (!item.teacherId) apiSchoolMap.set(item.schoolId, true);
          if (item.teacherId) {
            activeTeacherIdsInMySchools.add(item.teacherId);
            if (!teacherIdToMetadata.has(item.teacherId)) {
              teacherIdToMetadata.set(item.teacherId, {
                name: item.teacherName, school_name: item.schoolName, campus: item.campusName, school_id: schoolCodeToIdMap.get(item.schoolId)
              });
            }
          }
        }
      });
    }

    // 4. TAG AUDIT (THE PRE-FILL SOLUTION)
    const teacherAuditResults = new Map(); 
    activeTeacherIdsInMySchools.forEach(id => teacherAuditResults.set(id, "No tag"));

    if (activeTeacherIdsInMySchools.size > 0) {
        const tagResp = await fetch("https://services.grapeseed.com/admin/v1/tags/entitytags", {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "x-gl-origin": "https://schools.grapeseed.com/" },
            body: JSON.stringify({ ids: Array.from(activeTeacherIdsInMySchools) })
        });

        if (tagResp.ok) {
            const tagData = await tagResp.json();
            tagData.forEach(entity => {
                const trainerNames = (entity.tags || []).map(t => t.name?.toLowerCase().trim()).filter(name => name && isNaN(name));
                if (trainerNames.length === 1 && trainerNames[0] === myTrainerTagName) teacherAuditResults.set(entity.entityId, "CLEAR"); 
                else if (trainerNames.length > 0) teacherAuditResults.set(entity.entityId, "Mutual");
            });
        }
    }

    // 5. RESOLVE EMAILS (PARALLEL FETCH CHUNKED BY 50)
    const emailToAuditMap = new Map(); 
    const teacherIdToEmailMap = new Map();
    const teacherIdToResolvedNameMap = new Map();

    if (activeTeacherIdsInMySchools.size > 0) {
        const teacherIds = Array.from(activeTeacherIdsInMySchools);
        const chunks = [];
        for (let i = 0; i < teacherIds.length; i += 50) chunks.push(teacherIds.slice(i, i + 50));

        await Promise.all(chunks.map(async (chunk) => {
            const res = await fetch("https://services.grapeseed.com/account/v1/users/getUsersByIds", {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "x-gl-origin": "https://schools.grapeseed.com/" },
                body: JSON.stringify({ ids: chunk }) 
            });
            if (res.ok) {
                const users = await res.json();
                users.forEach(u => {
                    if (u.email) {
                        const email = u.email.trim().toLowerCase();
                        emailToAuditMap.set(email, teacherAuditResults.get(u.id));
                        teacherIdToEmailMap.set(u.id, email);
                        teacherIdToResolvedNameMap.set(u.id, u.name || u.fullName || u.displayName);
                    }
                });
            }
        }));
    }

    // 6. PREPARE BULK PAYLOAD
    const { data: dbTeachers } = await supabase.from("teachers").select("*").eq("trainer_id", userId);
    const existingEmails = new Set(dbTeachers.map(t => t.email?.toLowerCase()));
    const existingGsIds = new Set(dbTeachers.map(t => t.grapeseed_id));

    const finalUploadData = [];
    const stats = { updated: 0, inserted: 0, inactivated: 0 };

    dbTeachers.forEach(teacher => {
        if (!teacher.email) return;
        const email = teacher.email.toLowerCase();
        const auditResult = emailToAuditMap.get(email);
        const isTeaching = emailToAuditMap.has(email);

        let currentTags = Array.isArray(teacher.tags) ? [...teacher.tags] : [];
        if (isTeaching) {
            if (auditResult === "No tag") {
                if (!currentTags.includes("No tag")) currentTags.push("No tag");
                currentTags = currentTags.filter(t => t !== "Mutual");
            } else if (auditResult === "Mutual") {
                if (!currentTags.includes("Mutual")) currentTags.push("Mutual");
                currentTags = currentTags.filter(t => t !== "No tag");
            } else if (auditResult === "CLEAR") {
                currentTags = currentTags.filter(t => t !== "Mutual" && t !== "No tag");
            }
            stats.updated++;
        } else {
            stats.inactivated++;
        }

        finalUploadData.push({
            id: teacher.id,
            trainer_id: userId,
            is_active: isTeaching,
            status: isTeaching ? "Active" : "Inactive",
            tags: currentTags
        });
    });

    activeTeacherIdsInMySchools.forEach(gsId => {
        const email = teacherIdToEmailMap.get(gsId);
        if (email && !existingEmails.has(email) && !existingGsIds.has(gsId)) {
            const meta = teacherIdToMetadata.get(gsId);
            const audit = teacherAuditResults.get(gsId);
            const finalName = teacherIdToResolvedNameMap.get(gsId) || meta.name;
            
            const insertTags = [];
            if (audit === "No tag") insertTags.push("No tag");
            if (audit === "Mutual") insertTags.push("Mutual");

            finalUploadData.push({
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
            stats.inserted++;
        }
    });

    // 7. EXECUTE
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (dryRun) {
        return res.json({ success: true, isDryRun: true, stats, duration, sample: finalUploadData.slice(0, 3), logs });
    }

    if (finalUploadData.length > 0) {
        await supabase.from("teachers").upsert(finalUploadData, { onConflict: 'id' });
    }

    const schoolUpdates = Array.from(apiSchoolMap.entries()).map(([code, hasEmpty]) => ({
      id: schoolCodeToIdMap.get(code), has_empty_class: hasEmpty
    }));
    if (schoolUpdates.length > 0) await supabase.from("schools").upsert(schoolUpdates);

    log(`✅ Sync Complete in ${duration}s.`);
    res.json({ success: true, logs, stats });

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;