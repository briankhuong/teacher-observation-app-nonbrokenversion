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

// ⚡️ CONCURRENCY HELPER (Process 10 items at once)
async function pMap(array, mapper, { concurrency = 10 } = {}) {
  const results = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => mapper(item));
    results.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= concurrency) await Promise.race(executing);
  }
  return Promise.all(results);
}

/* -------------------------------------------------- */
/* SYNC ROUTE                                         */
/* -------------------------------------------------- */
router.post("/api/sync-teachers", async (req, res) => {
  const { token, userId } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  const startTime = Date.now();
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  try {
    /* 1. TRAINER IDENTITY */
    const { data: { user: trainerUser }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !trainerUser) throw new Error("Trainer not found");
    // Dynamic Name Extraction
    const myName = clean(trainerUser.user_metadata?.display_name || trainerUser.user_metadata?.full_name || "").split(" ")[0]; 
    log(`👤 Syncing for Trainer: "${myName}"`);

    /* 2. GET ALL ACTIVE SCHOOLS */
    const { data: dbSchools, error: schoolsErr } = await supabase
      .from("schools")
      .select("*")
      .eq("trainer_id", userId)
      .eq("disabled", false);

    if (schoolsErr) throw new Error(`DB Error: ${schoolsErr.message}`);
    if (!dbSchools || dbSchools.length === 0) {
        log("⚠️ No active schools found for this trainer.");
        return res.json({ success: true, logs });
    }

    log(`🏫 Found ${dbSchools.length} active schools. Starting Parallel Sync...`);

    /* ================================================================================= */
    /* MASTER LOOP: PROCESS EACH SCHOOL (PARALLEL)                                       */
    /* ================================================================================= */
    await pMap(dbSchools, async (schoolRow) => {
        const targetOfficialCode = schoolRow.official_code;
        let targetCampusId = schoolRow.campus_id; 
        const schoolLogPrefix = `[${schoolRow.school_name}]`;

        try {
            /* ------------------------------------------------------ */
            /* PHASE 1: SCHOOL CONTAINER REPAIR                       */
            /* ------------------------------------------------------ */
            const apiCResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${targetOfficialCode}/campuses/accessiblecampuses`, { headers: getHeaders(token) });
            if (!apiCResp.ok) {
                log(`${schoolLogPrefix} ⚠️ Failed to fetch campuses (API ${apiCResp.status}). Skipping.`);
                return; // Return instead of continue in pMap
            }
            const apiCampuses = await apiCResp.json();
            
            const targetApiCamp = apiCampuses.find(c => c.id === targetCampusId) || 
                                  apiCampuses.find(c => clean(c.name) === clean(schoolRow.campus_name));

            if (!targetApiCamp) {
                log(`${schoolLogPrefix} ❌ Campus not found in API. Skipping.`);
                return;
            }

            if (targetCampusId !== targetApiCamp.id) {
                await supabase.from("schools").update({ campus_id: targetApiCamp.id }).eq("id", schoolRow.id);
                targetCampusId = targetApiCamp.id; 
            }

            /* ------------------------------------------------------ */
            /* PHASE 2: TEACHER GEOGRAPHY REPAIR                      */
            /* ------------------------------------------------------ */
            const { data: schoolTeachers } = await supabase.from("teachers").select("*").eq("trainer_id", userId).eq("school_id", schoolRow.id);
            const moveQueue = schoolTeachers.filter(t => t.campus_id !== targetCampusId);
            
            if (moveQueue.length > 0) {
                const idsToMove = moveQueue.map(t => t.id);
                await supabase.from("teachers").update({ campus_id: targetCampusId }).in("id", idsToMove);
            }

            /* ------------------------------------------------------ */
            /* PHASE 3: IDENTITY HANDSHAKE & TAG LOGIC                */
            /* ------------------------------------------------------ */
            const classResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${targetOfficialCode}/classes?campusId=${targetCampusId}&offset=0&limit=100&disabled=false`, { headers: getHeaders(token) });
            const classData = await classResp.json();
            const apiClasses = classData.schoolClasses || classData || [];

            const apiActiveIds = new Set();
            apiClasses.forEach(c => {
                if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
                if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
            });

            // Re-fetch Snapshot
            const { data: updatedSnapshot } = await supabase.from("teachers").select("*").eq("trainer_id", userId).eq("school_id", schoolRow.id);
            const currentSandboxTeachers = updatedSnapshot.filter(t => t.campus_id === targetCampusId);

            const updatesToSave = [];
            const insertsToSave = [];

            // --- A. PROCESS EXISTING TEACHERS ---
            for (const t of currentSandboxTeachers) {
                const gseedId = (t.grapeseed_id || "").toLowerCase();
                const isActive = apiActiveIds.has(gseedId);
                
                let finalTags = Array.isArray(t.tags) ? t.tags : [];
                let logTagLabel = "";

                if (isActive) {
                    let rawTagObjects = [];
                    if (gseedId && gseedId !== "null") {
                        const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
                        if (tagResp.ok) {
                            const tData = await tagResp.json();
                            // >>> UNIVERSAL PARSER <<<
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
                            finalTags = []; // Exclusive
                            logTagLabel = ""; 
                        } else {
                            finalTags = ["No tag"]; // Ghost
                            logTagLabel = "[No tag] ";
                        }
                    }
                    log(`${schoolLogPrefix} 🔗 [MATCH] ${logTagLabel}${t.name}`);

                } else {
                    logTagLabel = "[INACTIVE] ";
                    const currentClean = finalTags.filter(tag => tag.toLowerCase() !== "inactive");
                    finalTags = [...currentClean, "Inactive"];
                    log(`${schoolLogPrefix} ⚪ [MATCH] [INACTIVE] ${t.name}`);
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

            // --- B. DISCOVER NEW TEACHERS (PARALLEL FETCH) ---
            const sandboxIds = new Set(currentSandboxTeachers.map(t => (t.grapeseed_id || "").toLowerCase()));
            const missingIds = [...apiActiveIds].filter(id => id && !sandboxIds.has(id));

            // Run requests for new teachers in parallel chunks
            await pMap(missingIds, async (id) => {
                const pResp = await fetch(`https://services.grapeseed.com/account/v1/users?ids=${id}`, { headers: getHeaders(token) });
                const profiles = await pResp.json();
                const profile = Array.isArray(profiles) ? profiles[0] : profiles;

                if (profile && profile.name) {
                    let calculatedTags = ["No tag"];
                    let rawTagObjects = [];
                    
                    const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${id}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
                    if (tagResp.ok) {
                        const tData = await tagResp.json();
                        // >>> UNIVERSAL PARSER <<<
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
                        !t.grapeseed_id
                    );

                    const logLabel = calculatedTags.length === 0 ? "" : `[${calculatedTags.join(" & ")}] `;

                    if (manualMatch) {
                        // Check if we already staged this update in this loop to prevent dupes
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
                        log(`${schoolLogPrefix} 🔗 [LINKED] ${logLabel}${profile.name} (via ${apiEmail})`);
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
                        log(`${schoolLogPrefix} ✨ [NEW] ${logLabel}${profile.name}`);
                    }
                }
            }, { concurrency: 5 }); // 5 requests at a time per school for new teachers

            /* ------------------------------------------------------ */
            /* PHASE 4: COMMIT (PER SCHOOL)                           */
            /* ------------------------------------------------------ */
            if (updatesToSave.length > 0) {
                const { error: upErr } = await supabase.from("teachers").upsert(updatesToSave, { onConflict: 'id' });
                if (upErr) throw new Error(`Update Failed: ${upErr.message}`);
            }
            if (insertsToSave.length > 0) {
                const { error: inErr } = await supabase.from("teachers").insert(insertsToSave);
                if (inErr) throw new Error(`Insert Failed: ${inErr.message}`);
            }
            
            log(`${schoolLogPrefix} ✅ Sync Done.`);

        } catch (schoolErr) {
            log(`${schoolLogPrefix} ❌ Error: ${schoolErr.message}`);
        }
    }, { concurrency: 10 }); // Run 10 schools in parallel

    log(`🏁 Finished Full Sync in ${((Date.now() - startTime)/1000).toFixed(2)}s`);
    res.json({ success: true, logs });

  } catch (err) {
    log(`❌ FATAL: ${err.message}`);
    res.json({ success: false, error: err.message, logs });
  }
});

export default router;