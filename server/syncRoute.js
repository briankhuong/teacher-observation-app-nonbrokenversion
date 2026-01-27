import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();
router.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */
const clean = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

const getHeaders = (token, regionId = null) => {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-gl-origin": "https://schools.grapeseed.com/",
  };
  if (regionId) headers["x-gl-regionid"] = regionId;
  return headers;
};

/* -------------------------------------------------- */
/* SYNC ROUTE                                         */
/* -------------------------------------------------- */
router.post("/api/sync-teachers", async (req, res) => {
  const { token, userId } = req.body;
  const targetOfficialCode = "73683863-18de-4e91-ba09-c41e0bd40137";
  const targetCampusId = "cdc6985f-2bb5-4312-9c76-50afac183a93";
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  const startTime = Date.now();
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  try {
    /* 1. TRAINER IDENTITY */
    const { data: { user: trainerUser }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !trainerUser) throw new Error("Trainer not found");
    // Dynamic Name Extraction (e.g. "Brian Nguyen" -> "brian")
    const myName = clean(trainerUser.user_metadata?.display_name || trainerUser.user_metadata?.full_name || "").split(" ")[0]; 
    log(`👤 Syncing for Trainer: "${myName}"`);

    /* ================================================================================= */
    /* PHASE 1: SCHOOL CONTAINER REPAIR                                                  */
    /* ================================================================================= */
    log("📌 Phase 1: Stamping School UUID...");
    const { data: dbSchools } = await supabase.from("schools").select("*").eq("trainer_id", userId).eq("official_code", targetOfficialCode);
    const apiCResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${targetOfficialCode}/campuses/accessiblecampuses`, { headers: getHeaders(token) });
    const apiCampuses = await apiCResp.json();
    const targetApiCamp = apiCampuses.find(c => c.id === targetCampusId);
    
    let schoolRow = dbSchools.find(s => s.campus_id === targetCampusId) || 
                    dbSchools.find(s => clean(s.campus_name) === clean(targetApiCamp.name));

    if (!schoolRow) throw new Error("School row not found.");
    if (schoolRow.campus_id !== targetCampusId) {
      await supabase.from("schools").update({ campus_id: targetCampusId }).eq("id", schoolRow.id);
      schoolRow.campus_id = targetCampusId;
    }
    log("✅ Phase 1 Complete.");

    /* ================================================================================= */
    /* PHASE 2: TEACHER GEOGRAPHY REPAIR                                                 */
    /* ================================================================================= */
    log("📌 Phase 2: Aligning Teacher UUIDs...");
    const { data: globalSnapshot } = await supabase.from("teachers").select("*").eq("trainer_id", userId);
    
    const moveQueue = globalSnapshot.filter(t => 
      t.school_id === schoolRow.id && 
      clean(t.campus) === clean(schoolRow.campus_name) && 
      t.campus_id !== targetCampusId
    );
    
    if (moveQueue.length > 0) {
      const idsToMove = moveQueue.map(t => t.id);
      const { error: moveErr } = await supabase
        .from("teachers")
        .update({ campus_id: targetCampusId })
        .in("id", idsToMove);

      if (moveErr) throw new Error(`Phase 2 Fail: ${moveErr.message}`);
    }
    log(`✅ Phase 2 Complete. (${moveQueue.length} aligned)`);

    /* ================================================================================= */
    /* PHASE 3: IDENTITY HANDSHAKE & TAG LOGIC                                           */
    /* ================================================================================= */
    log("📌 Phase 3: Identity Handshake...");

    const classResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${targetOfficialCode}/classes?campusId=${targetCampusId}&offset=0&limit=100&disabled=false`, { headers: getHeaders(token) });
    const classData = await classResp.json();
    const apiClasses = classData.schoolClasses || classData || [];

    const apiActiveIds = new Set();
    apiClasses.forEach(c => {
      if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
      if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
    });

    const updatesToSave = [];
    const insertsToSave = [];
    
    const { data: updatedSnapshot } = await supabase.from("teachers").select("*").eq("trainer_id", userId);
    const currentSandboxTeachers = updatedSnapshot.filter(t => t.campus_id === targetCampusId);

    // -----------------------------------------------------
    // A. PROCESS EXISTING TEACHERS
    // -----------------------------------------------------
    for (const t of currentSandboxTeachers) {
      const gseedId = (t.grapeseed_id || "").toLowerCase();
      const isActive = apiActiveIds.has(gseedId);
      
      let finalTags = Array.isArray(t.tags) ? t.tags : [];
      let logTagLabel = "";

      if (isActive) {
        // --- ACTIVE LOGIC ---
        let rawTagObjects = [];
        if (gseedId && gseedId !== "null") {
          const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
          if (tagResp.ok) {
            const tData = await tagResp.json();
            
            // >>> UNIVERSAL PARSER <<<
            if (tData.tags) { 
                rawTagObjects = tData.tags; // Object Wrapper
            } else if (tData.entityTags) {
                rawTagObjects = tData.entityTags; // Alt Object Wrapper
            } else if (Array.isArray(tData)) {
                // Check if it's an Array Wrapper (First item has .tags)
                if (tData[0] && (tData[0].tags || tData[0].entityTags)) {
                    rawTagObjects = tData[0].tags || tData[0].entityTags;
                } else {
                    // Assume Direct Array (The missing case!)
                    rawTagObjects = tData;
                }
            }
          }
        }

        const rawNames = rawTagObjects
          .map(tag => (tag.name || "").trim())
          .filter(name => isNaN(Number(name))) 
          .map(name => clean(name).split(" ")[0]); 

        const hasMe = rawNames.some(n => n === myName);
        const others = [...new Set(rawNames.filter(n => n !== myName))];

        if (others.length > 0) {
          finalTags = others; 
          logTagLabel = `[${finalTags.join(" & ")}] `;
        } else {
          if (hasMe) {
            // EXCLUSIVE: You are there, no one else is.
            finalTags = []; // BLANK ARRAY
            logTagLabel = ""; 
          } else {
            // GHOST: API returned nothing (or only numbers)
            finalTags = ["No tag"]; 
            logTagLabel = "[No tag] ";
          }
        }
        log(`🔗 [MATCH] [ACTIVE] ${logTagLabel}${t.name}`);

      } else {
        // --- INACTIVE LOGIC ---
        logTagLabel = "[INACTIVE] ";
        const currentClean = finalTags.filter(tag => tag.toLowerCase() !== "inactive");
        finalTags = [...currentClean, "Inactive"];
        log(`⚪ [MATCH] [INACTIVE] ${t.name}`);
      }

      updatesToSave.push({
        id: t.id,
        trainer_id: userId,
        name: t.name,
        email: t.email,
        grapeseed_id: gseedId || t.grapeseed_id,
        campus_id: targetCampusId, 
        school_id: schoolRow.id,
        school_name: schoolRow.school_name,
        campus: schoolRow.campus_name,
        tags: finalTags, 
        updated_at: new Date()
      });
    }

    // -----------------------------------------------------
    // B. DISCOVER NEW TEACHERS
    // -----------------------------------------------------
    const sandboxIds = new Set(currentSandboxTeachers.map(t => (t.grapeseed_id || "").toLowerCase()));
    const missingIds = [...apiActiveIds].filter(id => id && !sandboxIds.has(id));

    for (const id of missingIds) {
      const pResp = await fetch(`https://services.grapeseed.com/account/v1/users?ids=${id}`, { headers: getHeaders(token) });
      const profiles = await pResp.json();
      const profile = Array.isArray(profiles) ? profiles[0] : profiles;

      if (profile && profile.name) {
        let calculatedTags = ["No tag"];
        let rawTagObjects = [];
        
        const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${id}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
        if (tagResp.ok) {
            const tData = await tagResp.json();
            // >>> UNIVERSAL PARSER (Repeat) <<<
            if (tData.tags) rawTagObjects = tData.tags;
            else if (tData.entityTags) rawTagObjects = tData.entityTags;
            else if (Array.isArray(tData)) {
                if (tData[0] && (tData[0].tags || tData[0].entityTags)) {
                    rawTagObjects = tData[0].tags || tData[0].entityTags;
                } else {
                    rawTagObjects = tData;
                }
            }
        }

        const rawNames = rawTagObjects
          .map(tag => (tag.name || "").trim())
          .filter(name => isNaN(Number(name)))
          .map(name => clean(name).split(" ")[0]);

        const hasMe = rawNames.some(n => n === myName);
        const others = [...new Set(rawNames.filter(n => n !== myName))];

        if (others.length > 0) calculatedTags = others; 
        else if (hasMe) calculatedTags = []; 

        const apiEmail = (profile.email || "").toLowerCase().trim();
        const manualMatch = updatedSnapshot.find(t => 
            (t.email || "").toLowerCase().trim() === apiEmail && 
            t.school_id === schoolRow.id && 
            clean(t.campus) === clean(schoolRow.campus_name) &&
            !t.grapeseed_id
        );

        const logLabel = calculatedTags.length === 0 ? "" : `[${calculatedTags.join(" & ")}] `;

        if (manualMatch) {
            const idx = updatesToSave.findIndex(u => u.id === manualMatch.id);
            if (idx > -1) updatesToSave.splice(idx, 1);

            updatesToSave.push({
                id: manualMatch.id,
                trainer_id: userId,
                name: profile.name,
                email: apiEmail,
                grapeseed_id: id,
                campus_id: targetCampusId,
                school_id: schoolRow.id,
                school_name: schoolRow.school_name,
                campus: schoolRow.campus_name,
                tags: calculatedTags,
                updated_at: new Date()
            });
            log(`🔗 [LINKED] ${logLabel}${profile.name} (via ${apiEmail})`);
        } else {
            insertsToSave.push({
                trainer_id: userId,
                grapeseed_id: id,
                name: profile.name,
                email: apiEmail,
                school_id: schoolRow.id,
                school_name: schoolRow.school_name,
                campus: schoolRow.campus_name,
                campus_id: targetCampusId,
                tags: calculatedTags,
                created_at: new Date(),
                updated_at: new Date()
            });
            log(`✨ [NEW] ${logLabel}${profile.name}`);
        }
      }
    }

    /* ================================================================================= */
    /* PHASE 4: COMMIT                                                                   */
    /* ================================================================================= */
    if (updatesToSave.length > 0) {
      const { error: upErr } = await supabase.from("teachers").upsert(updatesToSave, { onConflict: 'id' });
      if (upErr) throw new Error(`Update Failed: ${upErr.message}`);
    }
    
    if (insertsToSave.length > 0) {
      const { error: inErr } = await supabase.from("teachers").insert(insertsToSave);
      if (inErr) throw new Error(`Insert Failed: ${inErr.message}`);
    }

    log(`🏁 Finished: ${updatesToSave.length} updated, ${insertsToSave.length} new in ${((Date.now() - startTime)/1000).toFixed(2)}s`);
    res.json({ success: true, logs });

  } catch (err) {
    log(`❌ FATAL: ${err.message}`);
    res.json({ success: false, error: err.message, logs });
  }
});

export default router;