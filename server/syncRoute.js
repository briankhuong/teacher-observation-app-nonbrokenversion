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

// ⚡️ GLOBAL CONCURRENCY HELPER
async function pMap(array, mapper, { concurrency = 20 } = {}) {
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
        log("⚠️ No active schools found.");
        return res.json({ success: true, logs });
    }

    log(`🏫 Found ${dbSchools.length} active schools. Launching Hyper-Parallel Sync...`);

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
            const [apiCResp, { data: schoolTeachers }] = await Promise.all([
                fetch(`https://services.grapeseed.com/admin/v1/schools/${targetOfficialCode}/campuses/accessiblecampuses`, { headers: getHeaders(token) }),
                supabase.from("teachers").select("*").eq("trainer_id", userId).eq("school_id", schoolRow.id)
            ]);

            if (!apiCResp.ok) {
                log(`${schoolLogPrefix} ⚠️ API Error ${apiCResp.status}. Skipping.`);
                return;
            }
            const apiCampuses = await apiCResp.json();
            
            const targetApiCamp = apiCampuses.find(c => c.id === targetCampusId) || 
                                  apiCampuses.find(c => clean(c.name) === clean(schoolRow.campus_name));

            if (!targetApiCamp) {
                log(`${schoolLogPrefix} ❌ Campus not found. Skipping.`);
                return;
            }

            if (targetCampusId !== targetApiCamp.id) {
                supabase.from("schools").update({ campus_id: targetApiCamp.id }).eq("id", schoolRow.id).then();
                targetCampusId = targetApiCamp.id; 
            }

            /* ------------------------------------------------------ */
            /* PHASE 2: TEACHER GEOGRAPHY REPAIR                      */
            /* ------------------------------------------------------ */
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

            // >>>>>> 🟢 NEW: EMPTY CLASS CHECK (Start) <<<<<<
            const hasEmptyClass = apiClasses.some(c => !c.teacherId);
            // Fire-and-forget update to the school table
            supabase.from("schools")
              .update({ has_empty_class: hasEmptyClass })
              .eq("id", schoolRow.id)
              .then(() => { /* silent success */ })
              .catch(err => console.error(`${schoolLogPrefix} Failed to update empty class status:`, err));
            // >>>>>> 🟢 NEW: EMPTY CLASS CHECK (End) <<<<<<

            const apiActiveIds = new Set();
            apiClasses.forEach(c => {
                if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
                if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
            });

            // Re-fetch Snapshot (Scoped)
            const { data: updatedSnapshot } = await supabase.from("teachers").select("*").eq("trainer_id", userId).eq("school_id", schoolRow.id);
            const currentSandboxTeachers = updatedSnapshot.filter(t => t.campus_id === targetCampusId);

            const updatesToSave = [];
            const insertsToSave = [];

            // --- A. PROCESS EXISTING TEACHERS (PARALLELIZED) ---
            const existingResults = await pMap(currentSandboxTeachers, async (t) => {
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
                            // UNIVERSAL PARSER
                            if (tData.tags) rawTagObjects = tData.tags; 
                            else if (tData.entityTags) rawTagObjects = tData.entityTags; 
                            else if (Array.isArray(tData)) {
                                if (tData[0] && (tData[0].tags || tData[0].entityTags)) rawTagObjects = tData[0].tags || tData[0].entityTags;
                                else rawTagObjects = tData;
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
                            finalTags = []; 
                            logTagLabel = ""; 
                        } else {
                            finalTags = ["No tag"]; 
                            logTagLabel = "[No tag] ";
                        }
                    }

                } else {
                    logTagLabel = "[INACTIVE] ";
                    const currentClean = finalTags.filter(tag => tag.toLowerCase() !== "inactive");
                    finalTags = [...currentClean, "Inactive"];
                }

                return {
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
                };
            }, { concurrency: 20 });

            updatesToSave.push(...existingResults);

            // --- B. DISCOVER NEW TEACHERS (PARALLELIZED) ---
            const sandboxIds = new Set(currentSandboxTeachers.map(t => (t.grapeseed_id || "").toLowerCase()));
            const missingIds = [...apiActiveIds].filter(id => id && !sandboxIds.has(id));

            const newTeachers = await pMap(missingIds, async (id) => {
                const [pResp, tagResp] = await Promise.all([
                    fetch(`https://services.grapeseed.com/account/v1/users?ids=${id}`, { headers: getHeaders(token) }),
                    fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${id}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) })
                ]);

                const profiles = await pResp.json();
                const profile = Array.isArray(profiles) ? profiles[0] : profiles;

                if (profile && profile.name) {
                    let calculatedTags = ["No tag"];
                    let rawTagObjects = [];
                    
                    if (tagResp.ok) {
                        const tData = await tagResp.json();
                        if (tData.tags) rawTagObjects = tData.tags;
                        else if (tData.entityTags) rawTagObjects = tData.entityTags;
                        else if (Array.isArray(tData)) {
                            if (tData[0] && (tData[0].tags || tData[0].entityTags)) rawTagObjects = tData[0].tags || tData[0].entityTags;
                            else rawTagObjects = tData;
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

                    return { id, profile, calculatedTags };
                }
                return null;
            }, { concurrency: 20 });

            for (const item of newTeachers) {
                if (!item) continue;
                const { id, profile, calculatedTags } = item;
                const apiEmail = (profile.email || "").toLowerCase().trim();
                
                const manualMatch = updatedSnapshot.find(t => (t.email || "").toLowerCase().trim() === apiEmail && !t.grapeseed_id);

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
                    log(`${schoolLogPrefix} 🔗 [LINKED] ${profile.name}`);
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
                    log(`${schoolLogPrefix} ✨ [NEW] ${profile.name}`);
                }
            }

            /* ------------------------------------------------------ */
            /* PHASE 4: COMMIT (PER SCHOOL)                           */
            /* ------------------------------------------------------ */
            await Promise.all([
                updatesToSave.length > 0 ? supabase.from("teachers").upsert(updatesToSave, { onConflict: 'id' }) : Promise.resolve(),
                insertsToSave.length > 0 ? supabase.from("teachers").insert(insertsToSave) : Promise.resolve()
            ]);

        } catch (schoolErr) {
            log(`${schoolLogPrefix} ❌ Error: ${schoolErr.message}`);
        }
    }, { concurrency: 15 });

    const duration = ((Date.now() - startTime)/1000).toFixed(2);
    log(`🏁 Finished Full Sync in ${duration}s`);
    res.json({ success: true, logs });

  } catch (err) {
    log(`❌ FATAL: ${err.message}`);
    res.json({ success: false, error: err.message, logs });
  }
});
/* -------------------------------------------------- */
/* INTERNAL HELPER: Fetch GrapeSEED Master Token      */
/* -------------------------------------------------- */
async function getMasterToken() {
  const url = "https://account.grapeseed.com/connect/token";
  const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();
  const username = (process.env.GRAPESEED_USERNAME || "").trim();
  const password = (process.env.GRAPESEED_PASSWORD || "").trim();

  const bodyString = `grant_type=password&scope=offline_access basicinfo openid&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyString,
  });

  if (!response.ok) throw new Error(`Master Token Failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */
// ✅ NEW: Simple Levenshtein-based similarity helper (0.0 to 1.0)
function getSimilarity(s1, s2) {
  let longer = s1.toLowerCase(), shorter = s2.toLowerCase();
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}
function editDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

/* -------------------------------------------------- */
/* UPDATED: CAMPUS SEARCH PROXY                       */
/* -------------------------------------------------- */
router.post("/api/lookup-campuses", async (req, res) => {
  const { schoolCode } = req.body; 

  if (!schoolCode) return res.status(400).json({ error: "Missing schoolCode" });

  try {
    const masterToken = await getMasterToken();
    const url = `https://services.grapeseed.com/admin/v1/schools/${schoolCode}/campuses/accessiblecampuses`;
    const response = await fetch(url, { headers: getHeaders(masterToken) });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: "GrapeSEED API Error", details: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("[Lookup] Server Error:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

/* -------------------------------------------------- */
/* NEW: PULSE AUDIT ENGINE (Discovery Only)           */
/* -------------------------------------------------- */
router.post("/api/pulse-audit", async (req, res) => {
  const { userId } = req.body;
  const auditResults = {
    newCampuses: [],
    disabledCampuses: [],
    classlessClasses: [],
    nameMismatches: [],
    disconnectedCampuses: [],
    newTeachers: [],       // 🟢 NEW: Container for discovered teachers
    teacherTagIssues: []   // 🟢 NEW: Container for tag mismatches
  };

  try {
    const token = await getMasterToken();
    const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5"; // 🟢 ADDED: Constant for Tag Check

    // 🟢 ADDED: Trainer Identity (Needed for Tag Logic)
    const { data: { user: trainerUser }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !trainerUser) throw new Error("Trainer not found");
    const myName = clean(trainerUser.user_metadata?.display_name || trainerUser.user_metadata?.full_name || "").split(" ")[0];

    const { data: dbSchools, error: schoolsErr } = await supabase
      .from("schools")
      .select("*")
      .eq("trainer_id", userId)
      .eq("disabled", false);

    if (schoolsErr) throw new Error(`DB Error: ${schoolsErr.message}`);
    if (!dbSchools || dbSchools.length === 0) return res.json(auditResults);

    // Group DB schools by official_code to process "Symmetrically" per school
    const schoolsByCode = {};
    dbSchools.forEach(s => {
      if (!schoolsByCode[s.official_code]) schoolsByCode[s.official_code] = [];
      schoolsByCode[s.official_code].push(s);
    });

    const schoolCodes = Object.keys(schoolsByCode);

    await pMap(schoolCodes, async (code) => {
      try {
        const myLocalSchools = schoolsByCode[code];
        const apiCResp = await fetch(
          `https://services.grapeseed.com/admin/v1/schools/${code}/campuses/accessiblecampuses`, 
          { headers: getHeaders(token) }
        );
        
        if (!apiCResp.ok) return;
        const apiCampuses = await apiCResp.json();

        // TRACKERS
        const matchedApiIds = new Set();
        const matchedDbIds = new Set();

        // --- PHASE 1: EXACT MATCHES (ID or Name) ---
        apiCampuses.forEach(apiC => {
          // A. Try ID Match
          const idMatch = myLocalSchools.find(dbS => dbS.campus_id === apiC.id);
          
          if (idMatch) {
            // Lock both IDs so they aren't treated as "Orphans"
            matchedApiIds.add(apiC.id);
            matchedDbIds.add(idMatch.id);

            // Rule: ID matches but Name changed? -> NAME_MISMATCH
            if (clean(apiC.name) !== clean(idMatch.campus_name)) {
              auditResults.nameMismatches.push({ db_record: idMatch, api_name: apiC.name });
            }
            // Rule: ID matches but API says Disabled? -> DISABLED_CAMPUS
            if (apiC.disabled) {
              auditResults.disabledCampuses.push(idMatch);
            }
          } 
          else {
            // B. Try Exact Name Match (For records with missing or mistyped IDs)
            const nameMatch = myLocalSchools.find(dbS => 
              !matchedDbIds.has(dbS.id) && 
              clean(dbS.campus_name) === clean(apiC.name)
            );

                if (nameMatch) {
                matchedApiIds.add(apiC.id);
                matchedDbIds.add(nameMatch.id);

                auditResults.nameMismatches.push({ 
                    db_record: nameMatch, 
                    api_name: apiC.name, 
                    needs_id: apiC.id,
                    mismatch_type: 'id_mismatch'
                });

              if (apiC.disabled) {
                auditResults.disabledCampuses.push(nameMatch);
              }
            }
          }
        });

        // --- PHASE 2: FUZZY MATCHING (Disconnected Records) ---
        const apiOrphans = apiCampuses.filter(apiC => !apiC.disabled); 
        const dbOrphans = myLocalSchools.filter(dbS => !matchedDbIds.has(dbS.id));

        dbOrphans.forEach(dbS => {
          const suggestions = apiOrphans
            .map(apiC => ({ ...apiC, score: getSimilarity(clean(apiC.name), clean(dbS.campus_name)) }))
            .filter(apiC => apiC.score > 0.6) // 60% similarity threshold
            .sort((a, b) => b.score - a.score);

          if (suggestions.length > 0) {
            auditResults.disconnectedCampuses.push({
              db_record: dbS,
              suggestions: suggestions.map(s => ({ id: s.id, name: s.name, fullAddress: s.fullAddress, phone: s.phone }))
            });
            // Mark API items as "potentially claimed" so they aren't called purely NEW
            suggestions.forEach(s => matchedApiIds.add(s.id));
            matchedDbIds.add(dbS.id);
          }
        });

        // --- PHASE 3: FINAL CATEGORIZATION ---
        // [A] Truly New Campuses
        apiCampuses.forEach(apiC => {
            const isSuggestedAsLink = auditResults.disconnectedCampuses.some(d => d.suggestions.some(s => s.id === apiC.id));
            if (!matchedApiIds.has(apiC.id) && !apiC.disabled && !isSuggestedAsLink) {
                auditResults.newCampuses.push({
                    ...apiC,
                    official_code: code,
                    parent_school_name: myLocalSchools[0]?.school_name || "Unknown School"
                });
            }
        });
        // [B] THE SCOPED SAFETY NET
        if (Array.isArray(apiCampuses)) {
            myLocalSchools.forEach(dbS => {
                const isAccountedFor = 
                    matchedDbIds.has(dbS.id) || 
                    auditResults.disconnectedCampuses.some(d => d.db_record.id === dbS.id) ||
                    auditResults.nameMismatches.some(m => m.db_record.id === dbS.id);

                if (!isAccountedFor) {
                    auditResults.disabledCampuses.push(dbS);
                }
            });
        }

        // --- PHASE 4: TEACHER & CLASS AUDIT (Scoped to Campus) ---
        // 🟢 INJECTED LOGIC STARTS HERE
        const syncedLocalIds = myLocalSchools.filter(s => s.campus_id);

        await pMap(syncedLocalIds, async (schoolRow) => {
          try {
            const classResp = await fetch(
              `https://services.grapeseed.com/admin/v1/schools/${code}/classes?campusId=${schoolRow.campus_id}&offset=0&limit=100&disabled=false`, 
              { headers: getHeaders(token) }
            );
            
            if (!classResp.ok) return; 

            const classData = await classResp.json();
            const apiClasses = Array.isArray(classData.schoolClasses) 
              ? classData.schoolClasses 
              : (Array.isArray(classData) ? classData : []);

            // [A] CHECK FOR CLASSLESS CLASSES (Existing Logic)
            apiClasses.forEach(cls => {
              if (cls && !cls.teacherId) {
                auditResults.classlessClasses.push({
                  ...cls,
                  school_name: schoolRow.school_name,
                  campus_name: schoolRow.campus_name,
                  official_code: code, 
                  campus_id: schoolRow.campus_id,
                  teacherUrl: `https://schools.grapeseed.com/regions/${VIETNAM_REGION_ID}/schools/${code}/teachers`
                });
              }
            });

            // [B] PREPARE TEACHER LISTS (Discovery Logic)
            const apiActiveIds = new Set();
            apiClasses.forEach(c => {
                if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
                if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
            });

            // Fetch DB Teachers (SCHOOL scope for Handshake, CAMPUS scope for Diffing)
            const { data: allSchoolTeachers } = await supabase
                .from("teachers")
                .select("*")
                .eq("school_id", schoolRow.id);

            // Filter for THIS specific campus loop
            const currentCampusTeachers = (allSchoolTeachers || []).filter(t => t.campus_id === schoolRow.campus_id);
            const dbCampusIds = new Set(currentCampusTeachers.map(t => (t.grapeseed_id || "").toLowerCase()));

            // [C] IDENTIFY NEW TEACHERS
            // Logic: Present in API (Campus X) but missing in DB (Campus X)
            const missingIds = [...apiActiveIds].filter(id => id && !dbCampusIds.has(id));

            if (missingIds.length > 0) {
                // Enrich data to get Name/Email
                const profiles = await pMap(missingIds, async (id) => {
                    const r = await fetch(`https://services.grapeseed.com/account/v1/users?ids=${id}`, { headers: getHeaders(token) });
                    const d = await r.json();
                    return Array.isArray(d) ? d[0] : d;
                }, { concurrency: 5 });

                    profiles.forEach((profile, idx) => {
                    if (!profile) return;
                    const apiEmail = (profile.email || "").toLowerCase().trim();
                    const gseedId = missingIds[idx];

                    // 1. Check for Handshake (Email match, no ID)
                    const isHandshake = (allSchoolTeachers || []).some(t => 
                        (t.email || "").toLowerCase().trim() === apiEmail && !t.grapeseed_id
                    );

                    // 2. Check for "Ghost Campus" (Teacher exists in DB school, but different campus_id)
                    const existsInDifferentCampus = (allSchoolTeachers || []).find(t => 
                        (t.grapeseed_id || "").toLowerCase() === gseedId.toLowerCase()
                    );

                    // 🟢 Determine Reason
                    let reason = "Truly New (Not in DB)";
                    if (isHandshake) reason = "Handshake: Link Manual Record";
                    else if (existsInDifferentCampus) {
                        reason = `Mismatched: Found in campus "${existsInDifferentCampus.campus || 'Unknown'}"`;
                    }

                    auditResults.newTeachers.push({
                        name: profile.name,
                        email: profile.email,
                        grapeseed_id: gseedId,
                        school_id: schoolRow.id,
                        campus_id: schoolRow.campus_id,
                        parent_school_name: schoolRow.school_name,
                        campus_name: schoolRow.campus_name, // 🟢 Official target campus name
                        is_handshake: isHandshake,
                        reason: reason // 🟢 Pass reason to UI
                    });
                });
            }

            // [D] AUDIT TAGS (Active & Inactive)
            // 1. Check Active Teachers for Bad Tags
            const activeDbTeachers = currentCampusTeachers.filter(t => apiActiveIds.has((t.grapeseed_id || "").toLowerCase()));
            
            await pMap(activeDbTeachers, async (t) => {
                try {
                    const gseedId = t.grapeseed_id;
                    const tagUrl = `https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`;
                    
                    const tagResp = await fetch(tagUrl, { 
                        headers: getHeaders(token, VIETNAM_REGION_ID),
                        signal: AbortSignal.timeout(5000) 
                    }).catch(err => { throw new Error(`Network Error: ${err.message}`); });

                    if (!tagResp.ok) throw new Error(`API Error: ${tagResp.status}`);

                    const tData = await tagResp.json();
                    let rawTagObjects = [];
                    if (tData.tags) rawTagObjects = tData.tags; 
                    else if (tData.entityTags) rawTagObjects = tData.entityTags; 
                    else if (Array.isArray(tData)) {
                         if (tData[0] && (tData[0].tags || tData[0].entityTags)) rawTagObjects = tData[0].tags || tData[0].entityTags;
                         else rawTagObjects = tData;
                    }

                    // 🟢 1. CALCULATE DISPLAY TAGS (Match sync-teacher logic)
                    const displayTags = rawTagObjects
                        .map(tag => (tag.name || "").trim())
                        .filter(name => isNaN(Number(name))) 
                        .map(name => clean(name).split(" ")[0]); 

                    // 🟢 2. CALCULATE DB LOGIC (The "Sync-Teacher" Cleaning Rule)
                    const hasMe = displayTags.some(n => n === myName);
                    const others = [...new Set(displayTags.filter(n => n !== myName))];

                    let targetDbTags = [];
                    if (others.length > 0) targetDbTags = others;
                    else if (hasMe) targetDbTags = []; 
                    else targetDbTags = ["No tag"];

                    // 🟢 3. COMPARE & PUSH
                    const currentTags = Array.isArray(t.tags) ? t.tags : [];
                    const isDiff = JSON.stringify([...targetDbTags].sort()) !== JSON.stringify([...currentTags].sort());

                    if (isDiff) {
                        auditResults.teacherTagIssues.push({
                            id: t.id,
                            gseed_id: t.grapeseed_id,
                            name: t.name,
                            school_name: schoolRow.school_name,
                            official_code: code,
                            school_id: schoolRow.id,
                            issue: "Incorrect Tags",
                            expected: displayTags.length > 0 ? displayTags : ["No tag"], // What shows in Portal
                            current_tags: currentTags, // What shows in DB
                            is_error: false
                        });
                    }

                } catch (tagErr) {
                    console.error(`[Audit Failure] Teacher: ${t.name} | Error: ${tagErr.message}`);
                    auditResults.teacherTagIssues.push({
                        id: t.id,
                        name: t.name,
                        school_name: schoolRow.school_name,
                        issue: "🚨 Audit Failed",
                        expected: [`Error: ${tagErr.message}`],
                        current_tags: t.tags || [],
                        is_error: true
                    });
                }
            }, { concurrency: 5 });

            // 2. Check Inactive Teachers (Should have "Inactive")
            const inactiveDbTeachers = currentCampusTeachers.filter(t => !apiActiveIds.has((t.grapeseed_id || "").toLowerCase()));
            inactiveDbTeachers.forEach(t => {
                const currentTags = Array.isArray(t.tags) ? t.tags : [];
                const hasInactive = currentTags.some(tag => tag.toLowerCase() === "inactive");
                
                if (!hasInactive) {
                    auditResults.teacherTagIssues.push({
                        id: t.id,
                        gseed_id: t.grapeseed_id,
                        name: t.name,
                        school_name: schoolRow.school_name,
                        school_id: schoolRow.id,
                        issue: "Missing 'Inactive' Tag",
                        expected: [...currentTags, "Inactive"]
                    });
                }
            });

          } catch (fetchErr) {
            console.error(`Class/Teacher audit failed for campus ${schoolRow.campus_id}:`, fetchErr.message);
          }
        }, { concurrency: 10 });
        // 🟢 INJECTED LOGIC ENDS HERE

      } catch (err) {
        console.error(`Audit failed for code ${code}:`, err);
      }
    }, { concurrency: 10 });

    res.json(auditResults);

  } catch (err) {
    console.error("Pulse Audit Fatal Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------- */
/* NEW: SURGICAL SYNC (Single Teacher Operation)      */
/* -------------------------------------------------- */
router.post("/api/sync-surgical", async (req, res) => {
  const { userId, teacherData } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  if (!teacherData || !teacherData.grapeseed_id) {
    return res.status(400).json({ error: "Missing teacher data" });
  }

  try {
    const token = await getMasterToken();

    // 1. Get Trainer Identity
    const { data: { user: trainerUser }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !trainerUser) throw new Error("Trainer not found");
    const myName = clean(trainerUser.user_metadata?.display_name || trainerUser.user_metadata?.full_name || "").split(" ")[0];

    // 2. Fetch Fresh Data (Source of Truth)
    const [pResp, tagResp] = await Promise.all([
      fetch(`https://services.grapeseed.com/account/v1/users?ids=${teacherData.grapeseed_id}`, { headers: getHeaders(token) }),
      fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${teacherData.grapeseed_id}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) })
    ]);

    if (!pResp.ok) throw new Error(`API Error: ${pResp.status}`);
    const profiles = await pResp.json();
    const profile = Array.isArray(profiles) ? profiles[0] : profiles;
    
    if (!profile) throw new Error("Teacher profile not found in GrapeSEED");

    // 3. Process Tags
    let finalTags = ["No tag"];
    let rawTagObjects = [];
    if (tagResp.ok) {
        const tData = await tagResp.json();
        if (tData.tags) rawTagObjects = tData.tags;
        else if (tData.entityTags) rawTagObjects = tData.entityTags;
        else if (Array.isArray(tData)) {
            if (tData[0] && (tData[0].tags || tData[0].entityTags)) rawTagObjects = tData[0].tags || tData[0].entityTags;
            else rawTagObjects = tData;
        }
    }

    const rawNames = rawTagObjects
        .map(tag => (tag.name || "").trim())
        .filter(name => isNaN(Number(name)))
        .map(name => clean(name).split(" ")[0]);

    const hasMe = rawNames.some(n => n === myName);
    const others = [...new Set(rawNames.filter(n => n !== myName))];

    if (others.length > 0) finalTags = others;
    else if (hasMe) finalTags = [];

    // 4. PREPARE STRICT PAYLOAD (Golden Record)
    // We query the DB for the target school to ensure names/IDs are 100% correct
    const { data: schoolRow } = await supabase
      .from("schools")
      .select("school_name, campus_name, id, campus_id")
      .eq("id", teacherData.school_id)
      .single();

    if (!schoolRow) throw new Error("Associated school record not found");

    const payload = {
        trainer_id: userId,
        name: profile.name,
        email: (profile.email || "").toLowerCase().trim(),
        grapeseed_id: teacherData.grapeseed_id,
        school_id: schoolRow.id,              // 🟢 REPAIRED: Enforce correct school_id
        school_name: schoolRow.school_name,   // 🟢 REPAIRED: Enforce correct school_name
        campus_id: schoolRow.campus_id,
        campus: schoolRow.campus_name,
        tags: finalTags,
        updated_at: new Date()
    };

    // 5. EXECUTE OPERATION
    
    // [A] CHECK FOR HANDSHAKE (Placeholder in same school)
    const { data: handshakeCandidate } = await supabase
        .from("teachers")
        .select("id")
        .eq("school_id", schoolRow.id)
        .eq("email", payload.email)
        .is("grapeseed_id", null)
        .maybeSingle();

    if (handshakeCandidate) {
        console.log(`[Surgical] 🔗 Linking placeholder ${handshakeCandidate.id} to ${profile.name}`);
        await supabase.from("teachers").update(payload).eq("id", handshakeCandidate.id);
        return res.json({ success: true, action: "linked" });
    }

    // [B] CHECK FOR EXISTING RECORD IN THIS CAMPUS (Full Repair)
    // Note: We check specifically for this campus_id to avoid moving teachers from other campuses
    const { data: existingInCampus } = await supabase
        .from("teachers")
        .select("id")
        .eq("grapeseed_id", payload.grapeseed_id)
        .eq("campus_id", schoolRow.campus_id) 
        .maybeSingle();

    if (existingInCampus) {
        console.log(`[Surgical] 🔄 Performing Full Repair for ${profile.name}`);
        // 🟢 FIX: Update ALL fields (Payload), not just tags, to fix missing school_id
        await supabase.from("teachers").update(payload).eq("id", existingInCampus.id);
        return res.json({ success: true, action: "repaired" });
    }

    // [C] INSERT NEW RECORD
    console.log(`[Surgical] ✨ Inserting new record for ${profile.name}`);
    await supabase.from("teachers").insert({ ...payload, created_at: new Date() });

    res.json({ success: true, action: "inserted" });

  } catch (err) {
    console.error("Surgical Sync Failed:", err);
    res.status(500).json({ error: err.message });
  }
});
export default router;