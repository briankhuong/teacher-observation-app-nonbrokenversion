import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { runHardProbe } from "./probeService.js";

const router = express.Router();
router.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

const clean = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

const getHeaders = (token, regionId = null) => {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-gl-origin": "https://schools.grapeseed.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  };
  if (regionId) {
    headers["x-gl-regionid"] = regionId;
  }
  return headers;
};

/* -------------------------------------------------- */
/* SYNC ROUTE                                         */
/* -------------------------------------------------- */

router.post("/api/sync-teachers", async (req, res) => {
  const { token, userId } = req.body;
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  log("🚀 Starting Full Sync Process (LOG ONLY - DB SAFE)...");

  try {
    /* 1. Validate Trainer */
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !user) throw new Error("Trainer not found");
    log(`👤 Trainer ID: ${userId}`);

    // Standard Probe check
    await runHardProbe(token, log);

    /* ================================================================================= */
    /* PHASE 1: SCHOOL & CAMPUS SYNC (PRESERVED)                                         */
    /* ================================================================================= */
    const { data: dbSchools, error: schoolErr } = await supabase
      .from("schools")
      .select("id, official_code, school_name, campus_name, campus_id, disabled, trainer_id")
      .eq("trainer_id", userId);

    if (schoolErr) throw new Error("DB Error: " + schoolErr.message);
    
    if (dbSchools?.length > 0) {
      const schoolsByCode = {};
      dbSchools.forEach(row => {
        if (row.official_code) {
          if (!schoolsByCode[row.official_code]) schoolsByCode[row.official_code] = [];
          schoolsByCode[row.official_code].push(row);
        }
      });

      const updatesMap = new Map(); 
      const insertsMap = new Map(); 

      await Promise.all(Object.keys(schoolsByCode).map(async (officialCode) => {
        const apiResp = await fetch(
          `https://services.grapeseed.com/admin/v1/schools/${officialCode}/campuses/accessiblecampuses`,
          { headers: getHeaders(token) }
        );
        if (!apiResp.ok) return;
        let apiCampuses = await apiResp.json();
        apiCampuses.sort((a, b) => (a.disabled && !b.disabled ? -1 : 1));

        const existingDbRows = schoolsByCode[officialCode];
        for (const apiCamp of apiCampuses) {
          const cleanApiName = clean(apiCamp.name);
          let matchedRow = existingDbRows.find(r => r.campus_id === apiCamp.id) || 
                           existingDbRows.find(r => clean(r.campus_name) === cleanApiName);

          if (matchedRow) {
            if (matchedRow.disabled !== apiCamp.disabled || matchedRow.campus_id !== apiCamp.id) {
              updatesMap.set(matchedRow.id, { 
                id: matchedRow.id,
                trainer_id: userId,
                campus_id: apiCamp.id, 
                disabled: apiCamp.disabled, 
                updated_at: new Date()
              });
            }
          } else if (!apiCamp.disabled && existingDbRows.length > 0) {
            if (!insertsMap.has(apiCamp.id)) {
              insertsMap.set(apiCamp.id, {
                trainer_id: userId,
                official_code: officialCode,
                school_name: existingDbRows[0].school_name,
                campus_name: apiCamp.name,
                campus_id: apiCamp.id,
                disabled: apiCamp.disabled,
                created_at: new Date()
              });
            }
          }
        }
      }));

      if (updatesMap.size > 0) await supabase.from("schools").upsert(Array.from(updatesMap.values()));
      if (insertsMap.size > 0) await supabase.from("schools").insert(Array.from(insertsMap.values()));
      log("✅ Phase 1 Complete.");
    }

    /* ================================================================================= */
    /* PHASE 2: TEACHER UUID ALIGNMENT (PRESERVED)                                       */
    /* ================================================================================= */
    log("🚀 Starting Phase 2: Perfect Pair UUID Alignment...");
    const { data: activeSchools } = await supabase
      .from("schools")
      .select("id, school_name, campus_name, campus_id, official_code")
      .eq("trainer_id", userId)
      .eq("disabled", false);

    const schoolUuidMap = new Map();
    activeSchools?.forEach(s => schoolUuidMap.set(`${s.id}|${clean(s.campus_name)}`, s.campus_id));

    const { data: initialTeachers } = await supabase.from("teachers").select("*").eq("trainer_id", userId);

    const teacherUpdates = [];
    for (const t of initialTeachers || []) {
      if (!t.school_id || !t.campus) continue;
      const correctUuid = schoolUuidMap.get(`${t.school_id}|${clean(t.campus)}`);
      if (correctUuid && t.campus_id !== correctUuid) {
        teacherUpdates.push({ id: t.id, campus_id: correctUuid, updated_at: new Date() });
      }
    }
    if (teacherUpdates.length > 0) await supabase.from("teachers").upsert(teacherUpdates);
    log("✅ Phase 2 Complete.");

    /* ================================================================================= */
    /* PHASE 3: DISCOVERY & TAGS (LOG ONLY - NO DB WRITE)                                */
    /* ================================================================================= */
    log("🔍 Starting Phase 3: Discovery & Metadata Reconciliation...");

    const { data: teachers } = await supabase.from("teachers").select("*").eq("trainer_id", userId);
    
    // Arrays to hold bulk changes (Calculated but NOT Saved)
    const updatesToSave = [];
    const insertsToSave = [];

    for (const s of activeSchools || []) {
      const campusId = s.campus_id;
      const schoolName = s.school_name;
      const officialCode = s.official_code;
      const campusName = s.campus_name;

      log(`--- Processing Campus: ${campusName} ---`);

      const classResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${officialCode}/classes?campusId=${campusId}&offset=0&limit=100&disabled=false`, { headers: getHeaders(token) });
      if (!classResp.ok) continue;
      const classData = await classResp.json();
      const apiClasses = Array.isArray(classData) ? classData : (classData.schoolClasses || []);

      const apiActiveIds = new Set();
      apiClasses.forEach(c => {
        if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
        if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
      });

      const campusDbTeachers = (teachers || []).filter(t => t.campus_id === campusId);
      const campusDbIds = new Set(campusDbTeachers.map(t => (t.grapeseed_id || "").toLowerCase()));

      // -----------------------------------------------------
      // 1. PROCESS EXISTING TEACHERS
      // -----------------------------------------------------
      for (const t of campusDbTeachers) {
        const gseedId = (t.grapeseed_id || "").toLowerCase();
        const isActive = apiActiveIds.has(gseedId);
        let finalTagString = t.tags || "";
        let logTagLabel = "";

        if (isActive) {
          // ACTIVE LOGIC: Check API for tags
          let apiTags = [];
          if (gseedId && gseedId !== "null") {
            const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
            if (tagResp.ok) {
              const tagData = await tagResp.json();
              apiTags = tagData.tags || tagData.entityTags || (Array.isArray(tagData) ? tagData : []);
            }
          }

          // 1. Clean names
          const rawNames = apiTags
            .map(tag => (tag.name || "").trim())
            .filter(name => isNaN(Number(name)))
            .map(name => name.split(' ')[0].toLowerCase());
          
          // 2. Check for Brian
          const hasBrian = rawNames.some(n => n === 'brian');
          
          // 3. Filter out Brian for the "Other" check
          const otherTrainers = [...new Set(rawNames.filter(n => n !== 'brian'))];

          if (otherTrainers.length > 0) {
             // Case A: Tagged by others (e.g. Natalie or Brian & Natalie)
             finalTagString = otherTrainers.join(" & ");
             logTagLabel = `[${finalTagString}] `;
          } else {
             if (hasBrian) {
               // Case B: Tagged ONLY by Brian -> Remove tag completely (null)
               finalTagString = null; 
               logTagLabel = ""; // Empty string = No badge in log
             } else {
               // Case C: Truly No Tags -> Show "No tag"
               finalTagString = "No tag";
               logTagLabel = "[No tag] ";
             }
          }

        } else {
          // INACTIVE LOGIC
          logTagLabel = "[INACTIVE] ";
          if (!String(finalTagString).toLowerCase().includes("inactive")) {
            finalTagString = finalTagString ? `${finalTagString}, Inactive` : "Inactive";
          }
        }

        updatesToSave.push({
          id: t.id,
          tags: finalTagString,
          updated_at: new Date()
        });

        const statusIcon = isActive ? "✅" : "⚪";
        log(`${statusIcon} [ACTIVE] ${logTagLabel}${t.name} - ${t.email || 'no email'} - ${schoolName} - ${campusName} - ${officialCode} - ${campusId} - ${gseedId}`);
      }

      // -----------------------------------------------------
      // 2. DISCOVER [NEW] TEACHERS
      // -----------------------------------------------------
      const missingIds = [...apiActiveIds].filter(id => id && !campusDbIds.has(id));
      for (const id of missingIds) {
        try {
          const getUrl = `https://services.grapeseed.com/account/v1/users?ids=${id}&t=${Date.now()}`;
          const getResp = await fetch(getUrl, { headers: getHeaders(token) });
          
          if (getResp.ok) {
            const profiles = await getResp.json();
            const profile = Array.isArray(profiles) ? profiles[0] : profiles;
            
            if (profile && profile.name) {
              // Calculate Tags for New Teacher
              let newTeacherTag = "No tag";
              let apiTags = [];
              const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${id}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
              
              if (tagResp.ok) {
                const tagData = await tagResp.json();
                apiTags = tagData.tags || tagData.entityTags || (Array.isArray(tagData) ? tagData : []);
                
                const rawNames = apiTags
                  .map(tag => (tag.name || "").trim())
                  .filter(name => isNaN(Number(name)))
                  .map(name => name.split(' ')[0].toLowerCase());

                const hasBrian = rawNames.some(n => n === 'brian');
                const otherTrainers = [...new Set(rawNames.filter(n => n !== 'brian'))];

                if (otherTrainers.length > 0) {
                    newTeacherTag = otherTrainers.join(" & ");
                } else if (hasBrian) {
                    newTeacherTag = null; // Only Brian -> Empty
                }
                // else stays "No tag"
              }

              insertsToSave.push({
                trainer_id: userId,
                grapeseed_id: id,
                name: profile.name,
                email: profile.email || "",
                school_id: s.id,
                school_name: schoolName,
                campus: campusName,
                campus_id: campusId,
                tags: newTeacherTag,
                created_at: new Date(),
                updated_at: new Date()
              });

              let newLogLabel = newTeacherTag ? `[${newTeacherTag}] ` : "";
              if (newTeacherTag === "No tag") newLogLabel = "[No tag] ";

              log(`✨ [ACTIVE] [New] ${newLogLabel}${profile.name} - ${profile.email || 'no email'} - ${schoolName} - ${campusName} - ${officialCode} - ${campusId} - ${id}`);
            }
          }
        } catch (e) {
          log(`🚨 Exception during Discovery for ${id}: ${e.message}`);
        }
      }
    }

    // -----------------------------------------------------
    // 3. BULK SAVE (DISABLED FOR DRY RUN)
    // -----------------------------------------------------
    /*
    if (updatesToSave.length > 0) {
      const { error: upErr } = await supabase.from("teachers").upsert(updatesToSave);
      if (upErr) log(`❌ DB Update Error: ${upErr.message}`);
      else log(`💾 Updated tags for ${updatesToSave.length} existing teachers.`);
    }

    if (insertsToSave.length > 0) {
      const { error: insErr } = await supabase.from("teachers").insert(insertsToSave);
      if (insErr) log(`❌ DB Insert Error: ${insErr.message}`);
      else log(`💾 Inserted ${insertsToSave.length} new teachers.`);
    }
    */
   
    log(`🛑 DRY RUN COMPLETE: Would have updated ${updatesToSave.length} teachers and inserted ${insertsToSave.length} new teachers.`);
    log("✅ Sync Complete.");
    res.json({ success: true, logs });

  } catch (err) {
    log("❌ Critical Error: " + err.message);
    res.json({ success: false, error: err.message, logs });
  }
});

export default router;