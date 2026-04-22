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

router.post("/api/sync-teachers", async (req, res) => {
  const { token, userId } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  const startTime = Date.now();
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };
  const touchedTeacherIds = new Set();

  try {
    /* 1. TRAINER IDENTITY (Exact split logic) */
    const { data: { user: trainerUser }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !trainerUser) throw new Error("Trainer not found");
    const myName = clean(trainerUser.user_metadata?.display_name || trainerUser.user_metadata?.full_name || "").split(" ")[0]; 
    log(`👤 Syncing for Trainer: "${myName}"`);

    /* 2. GET ALL ACTIVE SCHOOLS */
    const { data: dbSchools, error: schoolsErr } = await supabase
      .from("schools")
      .select("id, school_name, campus_name, official_code, campus_id")
      .eq("trainer_id", userId)
      .eq("disabled", false);

    if (schoolsErr) throw new Error(`DB Error: ${schoolsErr.message}`);
    if (!dbSchools || dbSchools.length === 0) return res.json({ success: true, logs: ["⚠️ No schools."] });

    /* PHASE 1: ORPHAN ALIGNMENT (Text Clues) */
    const { data: orphans } = await supabase.from("teachers").select("*").eq("trainer_id", userId).is("school_id", null);
    if (orphans?.length > 0) {
      const alignmentUpdates = orphans.map(t => {
        const tText = clean(`${t.school_name} ${t.campus}`);
        let best = { id: null, score: 0, name: "", campus: "" };
        dbSchools.forEach(s => {
          const sText = clean(`${s.school_name} ${s.campus_name}`);
          const score = (tText === sText) ? 1.0 : getSimilarity(tText, sText);
          if (score > best.score) best = { id: s.id, score, name: s.school_name, campus: s.campus_name };
        });
        return (best.score >= 0.9) ? { id: t.id, school_id: best.id, school_name: best.name, campus: best.campus, updated_at: new Date() } : null;
      }).filter(Boolean);
      if (alignmentUpdates.length > 0) await supabase.from("teachers").upsert(alignmentUpdates);
    }

    /* MASTER LOOP: MULTI-SILO PROCESSOR */
    await pMap(dbSchools, async (schoolRow) => {
        const schoolLogPrefix = `[${schoolRow.school_name}]`;
        let targetCampusId = schoolRow.campus_id;

        try {
            /* PHASE 2: BUILDING REPAIR (GEOGRAPHY) */
            const apiCResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${schoolRow.official_code}/campuses/accessiblecampuses`, { headers: getHeaders(token) });
            if (!apiCResp.ok) return;
            const apiCampuses = await apiCResp.json();
            const targetApiCamp = apiCampuses.find(c => c.id === targetCampusId) || 
                                  apiCampuses.find(c => clean(c.name) === clean(schoolRow.campus_name));

            if (!targetApiCamp) return log(`${schoolLogPrefix} ❌ Campus not found.`);

            if (targetCampusId !== targetApiCamp.id) {
                await supabase.from("schools").update({ campus_id: targetApiCamp.id }).eq("id", schoolRow.id);
                targetCampusId = targetApiCamp.id;
            }

            /* PHASE 3: SOURCE OF TRUTH (TRIPLE-NULL NET) */
            const [classResp, { data: allPotentialTeachers }] = await Promise.all([
                fetch(`https://services.grapeseed.com/admin/v1/schools/${schoolRow.official_code}/classes?campusId=${targetCampusId}&offset=0&limit=100&disabled=false`, { headers: getHeaders(token) }),
                supabase.from("teachers").select("*").or(`school_id.eq.${schoolRow.id},school_name.eq."${schoolRow.school_name}"`)
            ]);

            const classData = await classResp.json();
            const apiClasses = classData.schoolClasses || classData || [];
            
            // Empty Class Alert
            supabase.from("schools").update({ has_empty_class: apiClasses.some(c => !c.teacherId) }).eq("id", schoolRow.id).then();

            const apiActiveIds = new Set();
            apiClasses.forEach(c => {
                if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
                if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
            });

            const emailToApiId = new Map();
            const apiProfiles = await pMap([...apiActiveIds], async (id) => {
                const r = await fetch(`https://services.grapeseed.com/account/v1/users?ids=${id}`, { headers: getHeaders(token) });
                const d = await r.json();
                return Array.isArray(d) ? d[0] : d;
            }, { concurrency: 10 });
            apiProfiles.forEach(p => { if (p?.email) emailToApiId.set(p.email.toLowerCase().trim(), p.id.toLowerCase()); });

            const updatesToSave = [];
            const insertsToSave = [];

            /* PHASE 4: RESOLUTION (ORIGINAL TAG LOGIC TRANSLANTED) */
            const sandboxCandidates = (allPotentialTeachers || []).filter(t => t.campus_id === targetCampusId || !t.campus_id);

            await pMap(sandboxCandidates, async (t) => {
                let gseedId = (t.grapeseed_id || "").toLowerCase();
                const cleanEmail = (t.email || "").toLowerCase().trim();

                // DETECTIVE HEAL: Bridge ID via Email Phonebook
                if (!gseedId && emailToApiId.has(cleanEmail)) {
                    gseedId = emailToApiId.get(cleanEmail);
                }

                const isActive = apiActiveIds.has(gseedId);
                let finalTags = Array.isArray(t.tags) ? t.tags : [];

                if (isActive) {
                    // --- START ORIGINAL TAG SIEVE ---
                    let rawTagObjects = [];
                    if (gseedId && gseedId !== "null" && gseedId !== "") {
                        const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
                        if (tagResp.ok) {
                            const tData = await tagResp.json();
                            // UNIVERSAL PARSER (COPY-PASTE)
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
                    } else {
                        if (hasMe) finalTags = []; 
                        else finalTags = ["No tag"];
                    }
                    // --- END ORIGINAL TAG SIEVE ---
                } else {
                    // --- ORIGINAL INACTIVE APPENDAGE LOGIC ---
                    const currentClean = finalTags.filter(tag => tag.toLowerCase() !== "inactive");
                    finalTags = [...currentClean, "Inactive"];
                }

                updatesToSave.push({
                    id: t.id,
                    trainer_id: userId,
                    name: t.name,
                    email: t.email,
                    grapeseed_id: gseedId,
                    campus_id: targetCampusId,
                    school_id: schoolRow.id,
                    school_name: schoolRow.school_name,
                    campus: schoolRow.campus_name,
                    tags: finalTags,
                    updated_at: new Date()
                });
                touchedTeacherIds.add(t.id);touchedTeacherIds.add(t.id);
            }, { concurrency: 20 });

            /* PHASE 5: THE CLONER (NEW INSTANCES) */
            const siloIds = new Set(updatesToSave.map(u => u.grapeseed_id).filter(id => id));
            const missingIds = [...apiActiveIds].filter(id => !siloIds.has(id));

            for (const id of missingIds) {
                const profile = apiProfiles.find(p => p && p.id.toLowerCase() === id);
                if (profile) {
                    // NEW DISCOVERY TAG PROCESSING (PARALLEL FETCH)
                    const tagResp = await fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${id}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) });
                    let rawT = [];
                    if (tagResp.ok) {
                        const d = await tagResp.json();
                        rawT = d.tags || d.entityTags || (Array.isArray(d) ? d[0]?.tags : []);
                    }
                    const pNames = (rawT || []).map(tag => (tag.name || "").trim()).filter(n => isNaN(Number(n))).map(n => clean(n).split(" ")[0]);
                    const others = [...new Set(pNames.filter(n => n !== myName))];
                    const cloneTags = others.length > 0 ? others : (pNames.includes(myName) ? [] : ["No tag"]);

                    insertsToSave.push({
                        trainer_id: userId,
                        grapeseed_id: id,
                        name: profile.name,
                        email: (profile.email || "").toLowerCase().trim(),
                        school_id: schoolRow.id,
                        school_name: schoolRow.school_name,
                        campus: schoolRow.campus_name,
                        campus_id: targetCampusId,
                        tags: cloneTags,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                    log(`${schoolLogPrefix} ✨ [CLONED] ${profile.name}`);
                }
            }
/* PHASE 6: COMMIT (Updated for Ghost Hunter) */
            // 🟢 Capture IDs of newly inserted teachers for the Safe List
            const insertPromise = insertsToSave.length > 0 
                ? supabase.from("teachers").insert(insertsToSave).select("id") 
                : Promise.resolve({ data: [] });

            const [updateRes, insertRes] = await Promise.all([
                updatesToSave.length > 0 ? supabase.from("teachers").upsert(updatesToSave, { onConflict: 'id' }) : Promise.resolve(),
                insertPromise
            ]);

            // Add newly generated IDs to the Safe List
            if (insertRes.data) {
                insertRes.data.forEach(row => touchedTeacherIds.add(row.id));
            }

        } catch (schoolErr) {
            log(`${schoolLogPrefix} ❌ Error: ${schoolErr.message}`);
        }
    }, { concurrency: 15 });

// 🟢 GHOST HUNTER CLEANUP (The Purge)
    // Run this AFTER the loop finishes
    if (touchedTeacherIds.size > 0) {
        const safeListArray = Array.from(touchedTeacherIds);

        // 1. Fetch Untouched Teachers
        // 🟢 REMOVED the .not("tags"...) filter so we catch teachers with NULL/Empty tags
        const { data: ghosts, error: ghostErr } = await supabase
            .from("teachers")
            .select("id, tags, name, email, school_name") 
            .eq("trainer_id", userId)
            .not("id", "in", `(${safeListArray.join(",")})`);

        if (ghostErr) {
            log(`👻 Ghost Hunter Query Failed: ${ghostErr.message}`);
        } else if (ghosts && ghosts.length > 0) {
             
             // 2. Filter in JS: Find those who are NOT ALREADY strictly ["Inactive"]
             // This saves us from updating records that are already correct.
             const validGhosts = ghosts.filter(t => {
                 const currentTags = t.tags || [];
                 return JSON.stringify(currentTags) !== JSON.stringify(["Inactive"]);
             });

             if (validGhosts.length > 0) {
                 // 3. Overwrite tags to ["Inactive"]
                 const updatePromises = validGhosts.map(async (t) => {
                     const msg = `👻 [INACTIVE] Overwriting: ${t.name} (${t.email}) | School: ${t.school_name}`;
                     log(msg); 

                     return supabase
                        .from("teachers")
                        .update({ 
                            tags: ["Inactive"], // 🟢 FORCE OVERWRITE
                            updated_at: new Date() 
                        })
                        .eq("id", t.id);
                 });

                 await Promise.all(updatePromises);
                 log(`✅ Successfully overwrote ${validGhosts.length} teachers to ["Inactive"].`);
             } else {
                 log(`👻 Ghost Hunter: Found ${ghosts.length} ghosts, but they were already Inactive.`);
             }
        } else {
            log(`👻 Ghost Hunter: No inactive teachers found to clean up.`);
        }
    } else {
        log(`⚠️ Ghost Hunter Skipped: Safe List was empty.`);
    }

    log(`🏁 Finished Sync in ${((Date.now() - startTime)/1000).toFixed(2)}s`);
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
  
  // 1. Read from the environment file
  const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();
  const username = (process.env.GRAPESEED_USERNAME || "").trim();
  const password = (process.env.GRAPESEED_PASSWORD || "").trim();

  // 🕵️ DEBUG: Verify the .env file is actually loading
  if (authHeader.length > 10) {
    console.log(`🔐 Auth Header Loaded: ${authHeader.substring(0, 10)}...`);
  } else {
    console.error("❌ CRITICAL: GRAPESEED_AUTH_HEADER is missing or empty in .env!");
  }
  
  console.log(`👤 Logging in as: ${username}`);

  const bodyString = `grant_type=password&scope=offline_access basicinfo openid&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyString,
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Master Token Failed: ${response.status}`);
  }
  
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
// -------------------------------------------------- */
// NEW: Helper to get coachId from user token
// -------------------------------------------------- */
async function getCoachIdFromToken(userToken) {
  // 1. Try direct profile endpoint
  try {
    const response = await fetch('https://services.grapeseed.com/account/v1/users/me', {
      headers: getHeaders(userToken)
    });
    if (response.ok) {
      const profile = await response.json();
      if (profile.id) return profile.id;
    }
  } catch (err) {
    console.warn("Failed to fetch /users/me:", err.message);
  }

  // 2. Fallback: fetch active channels and extract coachId from first visitation
  try {
    const channelsResp = await fetch('https://services.grapeseed.com/admin/v1/visitations/channels', {
      headers: getHeaders(userToken)
    });
    if (channelsResp.ok) {
      const channels = await channelsResp.json();
      const first = Array.isArray(channels) ? channels[0] : null;
      if (first) {
        const v = first.visitation || first;
        // coachId can be in various fields
        if (v.coachId) return v.coachId;
        if (v.coach_id) return v.coach_id;
        if (v.createBy) return v.createBy; // often matches coachId
      }
    }
  } catch (err) {
    console.warn("Failed to fetch channels for coachId fallback:", err.message);
  }

  return null;
}

// -------------------------------------------------- */
// NEW: Search completed supports (stage = 6)
// -------------------------------------------------- */
async function searchCompletedSupports(coachId, schoolCode, monthKey, type, campusId) {
  const [year, month] = monthKey.split('-');
  const targetType = type === 'Visit' ? 0 : 1;
  const url = `https://services.grapeseed.com/admin/v1/visitations/coaches/${coachId}/coachrelated?stage=6`;
  
  try {
    const masterToken = await getMasterToken();
    console.log(`🔍 Searching completed supports: ${url}`);
    const response = await fetch(url, { headers: getHeaders(masterToken) });
    if (!response.ok) {
      console.error(`Failed to fetch completed supports: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const items = data.visitations || [];   // ✅ FIX: use visitations array
    console.log(`📋 Found ${items.length} completed supports.`);

    for (const item of items) {
      const v = item.visitationResponseModel;
      if (!v) continue;
      const isSchoolMatch = String(v.schoolId || "").toLowerCase() === schoolCode.toLowerCase();
      const isTypeMatch = Number(v.type) === targetType;
      const isMonthMatch = v.startDate && v.startDate.includes(`${year}-${month}`);
      if (!isSchoolMatch || !isTypeMatch || !isMonthMatch) continue;
      
      console.log(`✅ Match candidate: ${v.id} (school match: ${isSchoolMatch}, type: ${isTypeMatch}, month: ${isMonthMatch})`);
      
      if (type === 'Visit') {
        if (v.campusId && String(v.campusId).toLowerCase() === String(campusId).toLowerCase()) {
          return v;
        }
        if (!v.campusId) return v;
      } else {
        if (!v.campusId) return v;
      }
    }
    // Fallback: return first matching school/type/month regardless of campus
    for (const item of items) {
      const v = item.visitationResponseModel;
      if (!v) continue;
      const isSchoolMatch = String(v.schoolId || "").toLowerCase() === schoolCode.toLowerCase();
      const isTypeMatch = Number(v.type) === targetType;
      const isMonthMatch = v.startDate && v.startDate.includes(`${year}-${month}`);
      if (isSchoolMatch && isTypeMatch && isMonthMatch) {
        console.log(`✅ Fallback match: ${v.id}`);
        return v;
      }
    }
    console.log("❌ No completed support matches.");
    return null;
  } catch (err) {
    console.error("Error searching completed supports:", err);
    return null;
  }
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
      .select("id, official_code, school_name, campus_name, campus_id")
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
                  teacherUrl: `https://schools.grapeseed.com/regions/${VIETNAM_REGION_ID}/schools/${code}/campuses/${schoolRow.campus_id}`
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
               .select("id, email, grapeseed_id, tags, campus_id, campus, school_id, name")
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
        await supabase.from("teachers").update(payload).eq("id", handshakeCandidate.id).select('id');
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
        await supabase.from("teachers").update(payload).eq("id", existingInCampus.id).select('id');
        return res.json({ success: true, action: "repaired" });
    }

    // [C] INSERT NEW RECORD
    console.log(`[Surgical] ✨ Inserting new record for ${profile.name}`);
    await supabase.from("teachers").insert({ ...payload, created_at: new Date() }).select('id');

    res.json({ success: true, action: "inserted" });

  } catch (err) {
    console.error("Surgical Sync Failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// This is the "Pocket" shared by both routes below
let visitationCache = [];

// 1. THE SYNC: Receives token from browser, fetches from GrapeSEED, fills pocket
router.post("/api/sync-grapeseed", async (req, res) => {
  const { userToken } = req.body;

  if (!userToken) {
    console.error("❌ Sync Error: No token received from frontend.");
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    console.log("📡 Proxy Sync: Fetching GrapeSEED data...");
    
    const response = await fetch('https://services.grapeseed.com/admin/v1/visitations/channels', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });

    if (!response.ok) {
      throw new Error(`GrapeSEED API returned ${response.status}`);
    }

    const data = await response.json();
    visitationCache = data; 
    
    console.log(`✅ CACHE REFRESHED: ${data.length} records stored.`);
    res.json({ count: data.length });
  } catch (err) {
    console.error("🔥 Sync Proxy Failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------- */
/* NEW: User-Specific GrapeSEED Login                 */
/* -------------------------------------------------- */
router.post("/api/login-grapeseed", async (req, res) => {
    const { email, password } = req.body;
    const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();

    if (!email || !password) {
        return res.status(400).json({ error: "Missing email or password." });
    }
    if (!authHeader) {
        console.error("❌ CRITICAL: GRAPESEED_AUTH_HEADER missing in .env");
        return res.status(500).json({ error: "Server misconfiguration." });
    }

    try {
        const url = "https://account.grapeseed.com/connect/token";
        const bodyString = `grant_type=password&scope=offline_access basicinfo openid&username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: bodyString,
        });

        if (!response.ok) {
            return res.status(401).json({ error: "Invalid GrapeSEED email or password." });
        }

        const data = await response.json();
        res.json({ access_token: data.access_token });
    } catch (error) {
        console.error("Server Error during GrapeSEED Login:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});



/* -------------------------------------------------- */
/* DEBUG: IDENTITY VERIFICATION (UPDATED)             */
/* -------------------------------------------------- */
router.post("/api/match-visitation", async (req, res) => {
  const { schoolCode, monthKey, type, userToken, campusId } = req.body; 
  const [year, month] = monthKey.split('-');
  const targetType = type === 'Visit' ? 0 : 1;

  if (!userToken) {
    return res.status(401).json({ error: "Unauthorized: Missing GrapeSEED user token." });
  }

  try {
    console.log(`📡 Fetching active channels using trainer's token...`);
    
    const response = await fetch('https://services.grapeseed.com/admin/v1/visitations/channels', {
      headers: getHeaders(userToken) 
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ GrapeSEED API Rejected Token: ${response.status} - ${errorText}`);
      return res.status(401).json({ error: "GrapeSEED API Error", details: errorText });
    }

    const data = await response.json();
    const channels = Array.isArray(data) ? data : [];

    // 1. Try to find an active match (stage < 6)
    const potentialMatches = channels.filter(item => {
      const v = item.visitation || item;
      const isSchoolMatch = String(v.schoolId || "").toLowerCase() === schoolCode.toLowerCase();
      const isTypeMatch = Number(v.type) === targetType;
      const isMonthMatch = v.startDate && v.startDate.includes(`${year}-${month}`);
      return isSchoolMatch && isTypeMatch && isMonthMatch && !v.isCancelled;
    });

    let match = null;

    if (potentialMatches.length > 0) {
      if (type === 'Visit') {
        match = potentialMatches.find(item => {
          const v = item.visitation || item;
          return v.campusId && String(v.campusId).toLowerCase() === String(campusId).toLowerCase();
        });
        if (!match) match = potentialMatches.find(item => !(item.visitation || item).campusId);
      } else {
        match = potentialMatches.find(item => !(item.visitation || item).campusId);
        if (!match) match = potentialMatches[0];
      }
      if (!match) match = potentialMatches[0];
    }

    // 2. If no active match, search completed supports (stage = 6)
    if (!match) {
      console.log(`⚠️ No active match found for ${schoolCode}. Searching completed supports...`);
      const coachId = await getCoachIdFromToken(userToken);
      if (coachId) {
        const completed = await searchCompletedSupports(coachId, schoolCode, monthKey, type, campusId);
        if (completed) {
          console.log(`🎯 Found completed support: ${completed.id} (stage 6)`);
          match = { visitation: completed }; // wrap to match expected structure
        } else {
          console.warn(`⚠️ No completed support found either.`);
        }
      } else {
        console.warn(`⚠️ Could not retrieve coachId.`);
      }
    }

    if (match) {
      const v = match.visitation || match;
      console.log(`🎯 MATCH FOUND: ${v.id} (Campus: ${v.campusId || 'NULL'})`);
      return res.json({ match: { id: v.id, linkId: v.id } });
    }

    console.warn(`⚠️ No match found for ${schoolCode}.`);
    res.json({ match: null, reason: "Task not found." });

  } catch (error) {
    console.error("🔥 Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;