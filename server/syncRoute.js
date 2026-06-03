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
    /* 2. GET ALL ACTIVE SCHOOLS (campuses) */
    const { data: dbSchools, error: schoolsErr } = await supabase
      .from("schools")
      .select("id, school_name, campus_name, official_code, campus_id")
      .eq("trainer_id", userId)
      .eq("disabled", false);
    if (schoolsErr) throw new Error(`DB Error: ${schoolsErr.message}`);
    if (!dbSchools || dbSchools.length === 0) return res.json({ success: true, logs: ["⚠️ No schools."] });
    /* MASTER LOOP: CAMPUS LEVEL */
    await pMap(dbSchools, async (schoolRow) => {
      const schoolLogPrefix = `[${schoolRow.school_name}]`;
      const targetCampusId = schoolRow.campus_id;
      try {
        /* 3. FETCH CLASSES & DB TEACHERS FOR THIS CAMPUS */
        const classUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolRow.official_code}/classes?campusId=${targetCampusId}&offset=0&limit=100&disabled=false`;
        const classResp = await fetch(classUrl, { headers: getHeaders(token) });
        if (!classResp.ok) return;
        const classData = await classResp.json();
        const apiClasses = classData.schoolClasses || classData || [];
        const apiActiveIds = new Set();
        apiClasses.forEach(c => {
          if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
          if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
        });
        // Fetch teachers for this campus by the unique campus_id
        const { data: campusTeachers, error: teachersErr } = await supabase
          .from("teachers")
          .select("*")
          .eq("campus_id", targetCampusId);
        if (teachersErr) {
          log(`${schoolLogPrefix} ❌ Error fetching teachers: ${teachersErr.message}`);
          return;
        }
        const dbCampusTeachers = campusTeachers || [];
        const updatesToSave = [];
        const insertsToSave = [];
        /* 4. PROCESS EXISTING TEACHERS */
        await pMap(dbCampusTeachers, async (t) => {
          const gseedId = (t.grapeseed_id || "").toLowerCase();
          if (!gseedId) return;                     // should not happen (IDs are always present now)
          // 🆕 Repair missing school_id
          if (!t.school_id) {
            t.school_id = schoolRow.id;
          }
          const isActive = apiActiveIds.has(gseedId);
          let finalTags = Array.isArray(t.tags) ? t.tags : [];
          if (isActive) {
            // ---- Active: fetch tags and compute ----
            let rawTagObjects = [];
            const tagResp = await fetch(
              `https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`,
              { headers: getHeaders(token, VIETNAM_REGION_ID) }
            );
            if (tagResp.ok) {
              const tData = await tagResp.json();
              if (tData.tags) rawTagObjects = tData.tags;
              else if (tData.entityTags) rawTagObjects = tData.entityTags;
              else if (Array.isArray(tData)) {
                if (tData[0] && (tData[0].tags || tData[0].entityTags)) rawTagObjects = tData[0].tags || tData[0].entityTags;
                else rawTagObjects = tData;
              }
            }
            // Extract tag names, skip numbers AND the "nexus" model tag
            const rawNames = rawTagObjects
              .map(tag => (tag.name || "").trim())
              .filter(name => {
                if (isNaN(Number(name)) && name.toLowerCase() !== "nexus") return true;
                return false;
              })
              .map(name => clean(name).split(" ")[0]);
            const hasMe = rawNames.some(n => n === myName);
            const others = [...new Set(rawNames.filter(n => n !== myName))];
            if (others.length > 0) {
              finalTags = others;
            } else {
              if (hasMe) finalTags = [];
              else finalTags = ["No tag"];
            }
          } else {
            // ---- Inactive: ensure "Inactive" is present ----
            const currentClean = finalTags.filter(tag => tag.toLowerCase() !== "inactive");
            finalTags = [...currentClean, "Inactive"];
          }
          // Compare old and new tags
          const oldTags = (t.tags || []).slice().sort();
          const newTags = [...finalTags].sort();
          const tagsChanged = JSON.stringify(oldTags) !== JSON.stringify(newTags);
          updatesToSave.push({
            id: t.id,
            trainer_id: userId,
            name: t.name,
            email: t.email,
            grapeseed_id: gseedId,
            campus_id: targetCampusId,
            school_id: schoolRow.id,      // uses the possibly repaired value; the update will also set school_id correctly in DB
            school_name: schoolRow.school_name,
            campus: schoolRow.campus_name,
            tags: finalTags,
            needs_review: tagsChanged ? true : (t.needs_review ?? false),
            updated_at: new Date()
          });
          touchedTeacherIds.add(t.id);
        }, { concurrency: 20 });
        /* 5. NEW TEACHER DISCOVERY */
        const siloIds = new Set(dbCampusTeachers.map(t => (t.grapeseed_id || "").toLowerCase()).filter(id => id));
        const missingIds = [...apiActiveIds].filter(id => !siloIds.has(id));
        if (missingIds.length > 0) {
          // Fetch profiles in batch
          const apiProfiles = await pMap(missingIds, async (id) => {
            const r = await fetch(`https://services.grapeseed.com/account/v1/users?ids=${id}`, { headers: getHeaders(token) });
            const d = await r.json();
            return Array.isArray(d) ? d[0] : d;
          }, { concurrency: 10 });
          for (let i = 0; i < missingIds.length; i++) {
            const id = missingIds[i];
            const profile = apiProfiles[i];
            if (!profile) continue;
            // Fetch tags for the new teacher
            const tagResp = await fetch(
              `https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${id}&regionId=${VIETNAM_REGION_ID}`,
              { headers: getHeaders(token, VIETNAM_REGION_ID) }
            );
            let rawT = [];
            if (tagResp.ok) {
              const d = await tagResp.json();
              // Universal parser – always fallback to empty array
              if (d.tags) rawT = d.tags;
              else if (d.entityTags) rawT = d.entityTags;
              else if (Array.isArray(d)) {
                if (d[0] && (d[0].tags || d[0].entityTags)) rawT = d[0].tags || d[0].entityTags;
                else rawT = d;        // d is an array of tag objects
              }
              // just in case: ensure we have an array
              if (!Array.isArray(rawT)) rawT = [];
            }
            // Process names (skip numbers and "nexus")
            const pNames = rawT
              .map(tag => (tag.name || "").trim())
              .filter(name => isNaN(Number(name)) && name.toLowerCase() !== "nexus")
              .map(name => clean(name).split(" ")[0]);
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
              needs_review: true,
              created_at: new Date(),
              updated_at: new Date()
            });
            log(`${schoolLogPrefix} ✨ [CLONED] ${profile.name}`);
          }
        }
        /* 6. COMMIT */
        const insertPromise = insertsToSave.length > 0
          ? supabase.from("teachers").insert(insertsToSave).select("id")
          : Promise.resolve({ data: [] });
        const [updateRes, insertRes] = await Promise.all([
          updatesToSave.length > 0
            ? supabase.from("teachers").upsert(updatesToSave, { onConflict: 'id' })
            : Promise.resolve(),
          insertPromise
        ]);
        // Add newly created IDs to the safe list
        if (insertRes.data) {
          insertRes.data.forEach(row => touchedTeacherIds.add(row.id));
        }
      } catch (schoolErr) {
        log(`${schoolLogPrefix} ❌ Error: ${schoolErr.message}`);
      }
    }, { concurrency: 15 });
    /* 🟢 GHOST HUNTER CLEANUP (The Purge) */
    if (touchedTeacherIds.size > 0) {
      const safeListArray = Array.from(touchedTeacherIds);
      const { data: ghosts, error: ghostErr } = await supabase
        .from("teachers")
        .select("id, tags, name, email, school_name")
        .eq("trainer_id", userId)
        .not("id", "in", `(${safeListArray.join(",")})`);
      if (ghostErr) {
        log(`👻 Ghost Hunter Query Failed: ${ghostErr.message}`);
      } else if (ghosts && ghosts.length > 0) {
        const validGhosts = ghosts.filter(t => {
          const currentTags = t.tags || [];
          return JSON.stringify(currentTags) !== JSON.stringify(["Inactive"]);
        });
        if (validGhosts.length > 0) {
          const updatePromises = validGhosts.map(async (t) => {
            log(`👻 [INACTIVE] Overwriting: ${t.name} (${t.email}) | School: ${t.school_name}`);
            return supabase
              .from("teachers")
              .update({
                tags: ["Inactive"],
                needs_review: true,
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
    log(`🏁 Finished Sync in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
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
async function searchCompletedSupports(coachId, schoolCode, monthKey, type, campusId, userToken) {
  const [year, month] = monthKey.split('-');
  const targetType = type === 'Visit' ? 0 : 1;
  const url = `https://services.grapeseed.com/admin/v1/visitations/coaches/${coachId}/coachrelated?stage=6`;
  try {
    // 🔥 FIX: Use userToken instead of master token
    console.log(`🔍 Searching completed supports with user token: ${url}`);
    const response = await fetch(url, { headers: getHeaders(userToken) });
    // ... rest of the function unchanged (except the log message)
    if (!response.ok) {
      console.error(`Failed to fetch completed supports: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const items = data.visitations || [];
    console.log(`📋 Found ${items.length} completed supports.`);
    // First pass: exact month match (respecting campus logic)
    let exactMatch = null;
    for (const item of items) {
      const v = item.visitationResponseModel;
      if (!v) continue;
      const isSchoolMatch = String(v.schoolId || "").toLowerCase() === schoolCode.toLowerCase();
      const isTypeMatch = Number(v.type) === targetType;
      const isMonthMatch = v.startDate && v.startDate.includes(`${year}-${month}`);
      if (!isSchoolMatch || !isTypeMatch || !isMonthMatch) continue;
      console.log(`✅ Exact match candidate: ${v.id} (startDate: ${v.startDate})`);
      if (type === 'Visit') {
        if (v.campusId && String(v.campusId).toLowerCase() === String(campusId).toLowerCase()) {
          exactMatch = v;
          break;
        }
        if (!v.campusId) exactMatch = v;
      } else {
        if (!v.campusId) exactMatch = v;
      }
      if (exactMatch) break;
    }
    if (exactMatch) return exactMatch;
    // Second pass: no month restriction – find most recent for school, type, and (for Visit) campus
    console.log(`⚠️ No exact month match. Looking for most recent completed support for school ${schoolCode}, type ${type}${type === 'Visit' ? `, campus ${campusId}` : ''}...`);
    let bestMatch = null;
    let bestDate = null;
    for (const item of items) {
      const v = item.visitationResponseModel;
      if (!v) continue;
      const isSchoolMatch = String(v.schoolId || "").toLowerCase() === schoolCode.toLowerCase();
      const isTypeMatch = Number(v.type) === targetType;
      if (!isSchoolMatch || !isTypeMatch) continue;
      // For Visit, require campus match (if campusId provided)
      if (type === 'Visit' && campusId) {
        // If the support has a campusId, it must match. If it has null campus, it's a general school visit – we can accept it as fallback? 
        // But to be safe, require exact campus match if observation has a campusId.
        if (v.campusId && String(v.campusId).toLowerCase() !== String(campusId).toLowerCase()) {
          continue;
        }
        // If support has null campus, it might be acceptable as a fallback? But to avoid wrong campus, better to require match if observation has campusId.
        // We'll only skip if support has a campusId that doesn't match.
      }
      const d = new Date(v.startDate);
      if (!bestDate || d > bestDate) {
        bestDate = d;
        bestMatch = v;
      }
    }
    if (bestMatch) {
      console.log(`✅ Fallback match: ${bestMatch.id} (startDate: ${bestMatch.startDate})`);
      return bestMatch;
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
        const completed = await searchCompletedSupports(coachId, schoolCode, monthKey, type, campusId, userToken);
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
// -------------------------------------------------- */
// Year of Experience Sync (per-teacher tags)
// -------------------------------------------------- */
router.post("/api/sync-years", async (req, res) => {
  const { token, userId } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
  const currentYear = new Date().getFullYear();
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };
  try {
    // 1. Fetch teachers that need year_count filled (active + mutual only)
    const { data: candidates, error: fetchErr } = await supabase
      .from("teachers")
      .select("id, grapeseed_id, tags")
      .eq("trainer_id", userId)
      .is("year_count", null);
    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!candidates || candidates.length === 0) {
      log("✅ No teachers need year-of-experience update.");
      return res.json({ success: true, logs });
    }
    // Filter out Inactive teachers
    const activeCandidates = candidates.filter(t => {
      const tagsArr = Array.isArray(t.tags) ? t.tags : [];
      return !tagsArr.some(tag => tag.toLowerCase() === "inactive");
    });
    const validTeachers = activeCandidates.filter(t => t.grapeseed_id);
    if (validTeachers.length === 0) {
      log("⚠️ No active teachers with GrapeSEED ID.");
      return res.json({ success: true, logs });
    }
    log(`📡 Fetching year tags for ${validTeachers.length} teachers...`);
    // 2. Process each teacher concurrently
    let updated = 0;
    await pMap(validTeachers, async (teacher) => {
      try {
        const url = `https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${teacher.grapeseed_id}&regionId=${VIETNAM_REGION_ID}`;
        const resp = await fetch(url, { headers: getHeaders(token, VIETNAM_REGION_ID) });
        if (!resp.ok) return;
        const data = await resp.json();
        // Universal parser (same as in sync-teachers)
        let rawTagObjects = [];
        if (data.tags) rawTagObjects = data.tags;
        else if (data.entityTags) rawTagObjects = data.entityTags;
        else if (Array.isArray(data)) {
          if (data[0] && (data[0].tags || data[0].entityTags)) rawTagObjects = data[0].tags || data[0].entityTags;
          else rawTagObjects = data;
        }
        // Find first valid year tag
        let foundYear = null;
        for (const tag of rawTagObjects) {
          const name = (tag.name || "").trim();
          const num = parseInt(name, 10);
          if (!isNaN(num) && num >= 1990 && num <= currentYear) {
            foundYear = num;
            break;
          }
        }
        if (foundYear === null) return;
        const years = currentYear - foundYear;
        // Update only if year_count is still NULL (protect manual edits)
        const { error: updateErr } = await supabase
          .from("teachers")
          .update({
            year_count: years,
            needs_review: true,
            updated_at: new Date()
          })
          .eq("id", teacher.id)
          .is("year_count", null);
        if (!updateErr) {
          updated++;
          log(`✅ ${teacher.grapeseed_id}: ${foundYear} → ${years} years`);
        }
      } catch (err) {
        log(`⚠️ Error processing ${teacher.grapeseed_id}: ${err.message}`);
      }
    }, { concurrency: 10 });
    log(`🏁 Updated ${updated} teachers with years of experience.`);
    res.json({ success: true, logs });
  } catch (err) {
    log(`❌ sync-years error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, logs });
  }
});
// -------------------------------------------------- */
// School Details Lookup (Multi-Campus Import)
// -------------------------------------------------- */
router.post("/api/lookup-school-details", async (req, res) => {
  const { schoolCode } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
  if (!schoolCode) return res.status(400).json({ error: "Missing schoolCode" });
  try {
    const token = await getMasterToken();
    const logs = [];
    // 1. Get school name via breadcrumbs
    const breadcrumbsUrl = `https://services.grapeseed.com/admin/v1/resources/breadcrumbs?breadcrumbIds=${VIETNAM_REGION_ID}&breadcrumbIds=${schoolCode}&breadcrumbTypes=113&breadcrumbTypes=112`;
    const breadResp = await fetch(breadcrumbsUrl, { headers: getHeaders(token) });
    if (!breadResp.ok) {
      return res.status(404).json({ error: "School not found. Check the code." });
    }
    const breadData = await breadResp.json();
    const schoolName = breadData.school?.name || "Unknown School";
    logs.push(`✅ School: ${schoolName}`);
    // 2. Get accessible campuses
    const campusesUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolCode}/campuses/accessiblecampuses`;
    const campResp = await fetch(campusesUrl, { headers: getHeaders(token) });
    if (!campResp.ok) {
      return res.status(404).json({ error: "Could not fetch campuses." });
    }
    const allCampuses = await campResp.json();
    const activeCampuses = allCampuses.filter(c => !c.disabled);
    logs.push(`📡 Found ${activeCampuses.length} active campuses (${allCampuses.length} total)`);
    if (activeCampuses.length === 0) {
      return res.json({ schoolName, campuses: [], logs });
    }
    // 3. For each active campus, get admin contacts + phone (with enhanced fallback)
    const campusDetails = [];
    for (const campus of activeCampuses) {
      let adminName = null, adminEmail = null, adminPhone = null;
      // ---- Step A: Campus contacts ----
      try {
        const contactsUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolCode}/campuses/${campus.id}/contacts?schoolId=${schoolCode}&id=${campus.id}`;
        const contResp = await fetch(contactsUrl, { headers: getHeaders(token) });
        if (contResp.ok) {
          const contData = await contResp.json();
          const campusAdmins = contData.admins || [];
          console.log(`[lookup] Campus ${campus.name} admins:`, JSON.stringify(campusAdmins));
          if (campusAdmins.length > 0) {
            const first = campusAdmins[0];
            adminName = first.name?.trim() || null;
            adminEmail = first.email?.trim() || null;
            adminPhone = first.phone || null;
            // Enrich missing details via user endpoint
            if (first.id && (!adminName || !adminEmail || !adminPhone)) {
              try {
                const userUrl = `https://services.grapeseed.com/account/v1/users?ids=${first.id}`;
                const userResp = await fetch(userUrl, { headers: getHeaders(token) });
                if (userResp.ok) {
                  const userData = await userResp.json();
                  const user = Array.isArray(userData) ? userData[0] : userData;
                  if (!adminName && user?.name) adminName = user.name.trim();
                  if (!adminEmail && user?.email) adminEmail = user.email.trim();
                  if (!adminPhone && user?.phone) adminPhone = user.phone;
                }
              } catch (e) { /* ignore */ }
            }
          }
        }
      } catch (e) {
        logs.push(`⚠️ Campus contacts error for ${campus.name}: ${e.message}`);
      }
      // ---- Step B: Fallback to school contacts if any field still missing ----
      if (!adminName || !adminEmail || !adminPhone) {
        console.log(`[lookup] Campus ${campus.name}: missing fields (name:${!!adminName} email:${!!adminEmail} phone:${!!adminPhone}), trying school contacts...`);
        try {
          const schoolContactsUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolCode}/contacts?id=${schoolCode}`;
          const schResp = await fetch(schoolContactsUrl, { headers: getHeaders(token) });
          if (schResp.ok) {
            const schData = await schResp.json();
            console.log(`[lookup] School contacts for fallback:`, JSON.stringify(schData));
            // Try admins array first
            const schAdmins = schData.admins || [];
            let fallback = schAdmins.find(a => a.name || a.email);
            if (!fallback) {
              // Use any main contact
              fallback = schData.mainBillingContact || schData.mainShippingContact || schData.mainSupportContact;
            }
            if (fallback) {
              if (!adminName && fallback.name?.trim()) adminName = fallback.name.trim();
              if (!adminEmail && fallback.email?.trim()) adminEmail = fallback.email.trim();
              if (!adminPhone && fallback.phone) adminPhone = fallback.phone;
              // If phone still missing and we have an id, try user endpoint
              if (!adminPhone && fallback.id) {
                try {
                  const userUrl = `https://services.grapeseed.com/account/v1/users?ids=${fallback.id}`;
                  const userResp = await fetch(userUrl, { headers: getHeaders(token) });
                  if (userResp.ok) {
                    const userData = await userResp.json();
                    const user = Array.isArray(userData) ? userData[0] : userData;
                    if (user?.phone) adminPhone = user.phone;
                  }
                } catch (e) { /* ignore */ }
              }
            }
          }
        } catch (e) {
          logs.push(`⚠️ School contacts fallback error: ${e.message}`);
        }
      }
      // Final phone fallback to campus phone
      if (!adminPhone) adminPhone = campus.phone || null;
      campusDetails.push({
        campusId: campus.id,
        campusName: campus.name,
        address: campus.fullAddress || null,
        campusPhone: campus.phone || null,
        adminName,
        adminEmail,
        adminPhone,
      });
    }
    logs.push(`✅ Processed ${campusDetails.length} campuses.`);
    res.json({ schoolName, campuses: campusDetails, logs });
  } catch (err) {
    console.error("lookup-school-details error:", err);
    res.status(500).json({ error: err.message });
  }
});
// -------------------------------------------------- */
// Teaching Model Sync (from class licenseType)
// -------------------------------------------------- */
router.post("/api/sync-teaching-models", async (req, res) => {
  const { token, userId } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };
  try {
    // 1. Get all active schools for this trainer
    const { data: dbSchools, error: schoolsErr } = await supabase
      .from("schools")
      .select("id, official_code, campus_id, school_name, campus_name")
      .eq("trainer_id", userId)
      .eq("disabled", false);
    if (schoolsErr) throw new Error(`Schools fetch error: ${schoolsErr.message}`);
    if (!dbSchools || dbSchools.length === 0) {
      log("⚠️ No schools found.");
      return res.json({ success: true, logs });
    }
    // Map: teacherId (lowercase) → Set of licenseTypes
    const teacherLicenseMap = new Map();
    // 2. Loop schools/campuses to fetch class lists and then class details
    await pMap(dbSchools, async (schoolRow) => {
      try {
        const classListUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolRow.official_code}/classes?campusId=${schoolRow.campus_id}&offset=0&limit=100&disabled=false`;
        const listResp = await fetch(classListUrl, { headers: getHeaders(token) });
        if (!listResp.ok) return;
        const classData = await listResp.json();
        const apiClasses = classData.schoolClasses || classData || [];
        // For each class, fetch detail to get licenseType
        const classDetails = await pMap(apiClasses, async (cls) => {
          if (!cls.teacherId || !cls.id) return null;
          try {
            const detailUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolRow.official_code}/classes/${cls.id}?regionId=${VIETNAM_REGION_ID}&schoolId=${schoolRow.official_code}&campusId=${schoolRow.campus_id}&classId=${cls.id}&id=${cls.id}`;
            const detailResp = await fetch(detailUrl, { headers: getHeaders(token) });
            if (!detailResp.ok) return null;
            const detail = await detailResp.json();
            return { teacherId: cls.teacherId.toLowerCase(), licenseType: detail.licenseType };
          } catch (e) {
            return null;
          }
        }, { concurrency: 10 });
        // Aggregate
        for (const item of classDetails) {
          if (!item) continue;
          const tid = item.teacherId;
          if (!teacherLicenseMap.has(tid)) teacherLicenseMap.set(tid, new Set());
          teacherLicenseMap.get(tid).add(item.licenseType);
        }
      } catch (err) {
        log(`⚠️ School ${schoolRow.school_name} error: ${err.message}`);
      }
    }, { concurrency: 5 });
    log(`📡 Processed ${teacherLicenseMap.size} teachers from classes.`);
    // 3. Fetch active/mutual teachers from DB
    const { data: dbTeachers, error: teachersErr } = await supabase
      .from("teachers")
      .select("id, grapeseed_id, tags, teaching_model")
      .eq("trainer_id", userId);
    if (teachersErr) throw new Error(`Teachers fetch error: ${teachersErr.message}`);
    if (!dbTeachers || dbTeachers.length === 0) {
      log("⚠️ No teachers found.");
      return res.json({ success: true, logs });
    }
    // Filter out Inactive teachers, only keep those with grapeseed_id
    const activeTeachers = dbTeachers.filter(t => {
      if (!t.grapeseed_id) return false;
      const tagsArr = Array.isArray(t.tags) ? t.tags : [];
      return !tagsArr.some(tag => tag.toLowerCase() === "inactive");
    });
    // 4. Compute model string from licenseTypes
    const licenseToModel = { 1: "Classic", 2: "Connect", 3: "Nexus" };
    const updates = [];
    for (const teacher of activeTeachers) {
      const gsId = teacher.grapeseed_id.toLowerCase();
      const licenseTypes = teacherLicenseMap.get(gsId);
      if (!licenseTypes || licenseTypes.size === 0) continue; // no classes → keep current
      const models = [];
      for (const lt of licenseTypes) {
        const model = licenseToModel[lt];
        if (model) models.push(model);
      }
      if (models.length === 0) continue;
      const newModel = models.sort().join(" + "); // e.g. "Classic + Connect"
      const currentModel = teacher.teaching_model || "";
      if (currentModel !== newModel) {
        updates.push({
          id: teacher.id,
          teaching_model: newModel,
          needs_review: true,
          updated_at: new Date(),
        });
      }
    }
    if (updates.length > 0) {
      let updatedCount = 0;
      for (const u of updates) {
        const { error } = await supabase
          .from("teachers")
          .update({
            teaching_model: u.teaching_model,
            needs_review: u.needs_review,
            updated_at: u.updated_at,
          })
          .eq("id", u.id);
        if (error) {
          log(`⚠️ Failed to update teacher ${u.id}: ${error.message}`);
        } else {
          updatedCount++;
        }
      }
      log(`✅ Updated ${updatedCount} teachers' teaching models.`);
    } else {
      log("✅ All teaching models already up-to-date.");
    }
    res.json({ success: true, logs });
  } catch (err) {
    log(`❌ sync-teaching-models error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, logs });
  }
});
// -------------------------------------------------- */
// School Status Sync (from /visitations/schoolstatuses) – OPTIMIZED
// -------------------------------------------------- */
// -------------------------------------------------- */
// School Status Sync (from /visitations/schoolstatuses) – OPTIMIZED
// -------------------------------------------------- */
router.post("/api/sync-school-status", async (req, res) => {
  const { token, userId } = req.body;
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };
  try {
    // 1. Fetch all exclusive schools for this trainer (including disabled)
    const { data: dbSchools, error: dbErr } = await supabase
      .from("schools")
      .select("*")
      .eq("trainer_id", userId)
      .eq("exclusive", "exclusive"); // Keep original exclusive-only scope
    if (dbErr) throw new Error(`DB schools fetch: ${dbErr.message}`);
    if (!dbSchools) return res.json({ success: true, logs: ["No exclusive schools found."] });
    // Group by official_code
    const dbByCode = new Map();
    for (const s of dbSchools) {
      if (!s.official_code) continue;
      const code = s.official_code.toLowerCase();
      if (!dbByCode.has(code)) dbByCode.set(code, []);
      dbByCode.get(code).push(s);
    }
    // 2. Fetch API school statuses
    const apiUrl = "https://services.grapeseed.com/admin/v1/visitations/schoolstatuses";
    const apiResp = await fetch(apiUrl, { headers: getHeaders(token) });
    if (!apiResp.ok) throw new Error(`schoolstatuses failed: ${apiResp.status}`);
    const apiData = await apiResp.json();
    const apiSchools = Array.isArray(apiData) ? apiData : [];
    const apiIdMap = new Map();
    for (const s of apiSchools) {
      const id = (s.schoolId || "").toLowerCase();
      if (id) apiIdMap.set(id, s);
    }
    const apiIds = new Set(apiIdMap.keys());
    const dbCodes = new Set(dbByCode.keys());
    // Helper to enrich admin details for a campus (Fully Restored recursive Profile Fetching)
    const enrichCampusAdmin = async (code, campus) => {
      let adminName = null, adminEmail = null, adminPhone = null;
      try {
        const contUrl = `https://services.grapeseed.com/admin/v1/schools/${code}/campuses/${campus.id}/contacts?schoolId=${code}&id=${campus.id}`;
        const contResp = await fetch(contUrl, { headers: getHeaders(token) });
        if (contResp.ok) {
          const contData = await contResp.json();
          const admins = contData.admins || [];
          console.log(`[lookup] Campus ${campus.name} admins:`, JSON.stringify(admins));
          if (admins.length > 0) {
            const first = admins[0];
            adminName = first.name?.trim() || null;
            adminEmail = first.email?.trim() || null;
            adminPhone = first.phone || null;
            // 🟢 RESTORED: Deep profile retrieval fallback
            if (first.id && (!adminName || !adminEmail || !adminPhone)) {
              try {
                const userUrl = `https://services.grapeseed.com/account/v1/users?ids=${first.id}`;
                const userResp = await fetch(userUrl, { headers: getHeaders(token) });
                if (userResp.ok) {
                  const userData = await userResp.json();
                  const user = Array.isArray(userData) ? userData[0] : userData;
                  if (!adminName && user?.name) adminName = user.name.trim();
                  if (!adminEmail && user?.email) adminEmail = user.email.trim();
                  if (!adminPhone && user?.phone) adminPhone = user.phone;
                }
              } catch (e) { /* ignore */ }
            }
          }
        }
      } catch (e) { }
      // Fallback to school contacts if any field still missing
      if (!adminName || !adminEmail || !adminPhone) {
        try {
          const schContUrl = `https://services.grapeseed.com/admin/v1/schools/${code}/contacts?id=${code}`;
          const schResp = await fetch(schContUrl, { headers: getHeaders(token) });
          if (schResp.ok) {
            const schData = await schResp.json();
            const schAdmins = schData.admins || [];
            let fb = schAdmins.find(a => a.name || a.email);
            if (!fb) fb = schData.mainBillingContact || schData.mainShippingContact || schData.mainSupportContact;
            if (fb) {
              if (!adminName && fb.name?.trim()) adminName = fb.name.trim();
              if (!adminEmail && fb.email?.trim()) adminEmail = fb.email.trim();
              if (!adminPhone && fb.phone) adminPhone = fb.phone;
              // 🟢 RESTORED: Deep school contact fallback
              if (!adminPhone && fb.id) {
                try {
                  const userUrl = `https://services.grapeseed.com/account/v1/users?ids=${fb.id}`;
                  const userResp = await fetch(userUrl, { headers: getHeaders(token) });
                  if (userResp.ok) {
                    const userData = await userResp.json();
                    const user = Array.isArray(userData) ? userData[0] : userData;
                    if (user?.phone) adminPhone = user.phone;
                  }
                } catch (e) { /* ignore */ }
              }
            }
          }
        } catch (e) { }
      }
      if (!adminPhone) adminPhone = campus.phone || null;
      return { adminName, adminEmail, adminPhone };
    };
    // 🟢 NEW HELPER: Fetch and check for missing teachers (Empty Classes)
    const checkEmptyClasses = async (schoolCode, campusId) => {
      try {
        const classUrl = `https://services.grapeseed.com/admin/v1/schools/${schoolCode}/classes?campusId=${campusId}&offset=0&limit=100&disabled=false`;
        const classResp = await fetch(classUrl, { headers: getHeaders(token) });
        if (!classResp.ok) return false;
        const classData = await classResp.json();
        const apiClasses = Array.isArray(classData.schoolClasses) ? classData.schoolClasses : (Array.isArray(classData) ? classData : []);
        return apiClasses.some(cls => cls && !cls.teacherId);
      } catch (e) {
        return false;
      }
    };
    // 3. Process new schools (in API but not in DB) – parallel
    const newCodes = [...apiIds].filter(id => !dbCodes.has(id));
    let newSchoolCount = 0;
    await pMap(newCodes, async (code) => {
      const schoolName = apiIdMap.get(code)?.schoolName || "Unknown School";
      log(`🏫 New school: ${schoolName} (${code})`);
      try {
        const campUrl = `https://services.grapeseed.com/admin/v1/schools/${code}/campuses/accessiblecampuses`;
        const campResp = await fetch(campUrl, { headers: getHeaders(token) });
        if (!campResp.ok) return;
        const campuses = await campResp.json();
        const active = campuses.filter(c => !c.disabled);
        if (active.length === 0) return;
        const campusRows = await pMap(active, async (campus) => {
          const { adminName, adminEmail, adminPhone } = await enrichCampusAdmin(code, campus);
          const hasEmptyClass = await checkEmptyClasses(code, campus.id); // 🟢 CHECK EMPTY CLASSES
          return {
            trainer_id: userId,
            school_name: schoolName,
            campus_name: campus.name,
            official_code: code,
            campus_id: campus.id,
            admin_name: adminName,
            admin_email: adminEmail,
            admin_phone: adminPhone,
            address: campus.fullAddress || null,
            caring: false,
            disabled: false,
            exclusive: "exclusive",
            needs_review: true,
            has_empty_class: hasEmptyClass, // 🟢 SAVE TO DB
            admin_workbook_url: null,
            notes: null,
            visit_count: null,
            created_at: new Date(),
            updated_at: new Date(),
          };
        }, { concurrency: 10 });
        if (campusRows.length > 0) {
          // 🟢 RESTORED: Existing Same School duplication safety block
          const { data: existingSameSchool } = await supabase
            .from("schools")
            .select("id")
            .eq("trainer_id", userId)
            .eq("official_code", code)
            .limit(1);
          if (existingSameSchool && existingSameSchool.length > 0) {
            log(`⚠️ Skipping ${schoolName} – already exists with official_code ${code} (shared/temporary/exclusive).`);
            return;
          }
          const { error: insertErr } = await supabase.from("schools").insert(campusRows);
          if (insertErr) {
            if (insertErr.code === "23505") {
              log(`⚠️ ${schoolName} already exists (unique constraint). Skipping.`);
            } else {
              log(`❌ Insert error for ${schoolName}: ${insertErr.message}`);
            }
          } else {
            newSchoolCount += campusRows.length;
          }
        }
      } catch (e) {
        log(`⚠️ Error processing new school ${code}: ${e.message}`);
      }
    }, { concurrency: 5 });
    // 4. Disable schools in DB but not in API
    const removedCodes = [...dbCodes].filter(code => !apiIds.has(code));
    let disabledCount = 0;
    await pMap(removedCodes, async (code) => {
      const rows = dbByCode.get(code) || [];
      for (const row of rows) {
        const { error } = await supabase
          .from("schools")
          .update({
            disabled: true,
            needs_review: true,
            previous_data: JSON.stringify({ disabled: row.disabled ?? null }),
            updated_at: new Date()
          })
          .eq("id", row.id);
        if (!error) disabledCount++;
      }
    }, { concurrency: 10 });
    // 5. Existing schools: re‑enable, campus‑level sync, refresh admin – parallel
    const existingCodes = [...dbCodes].filter(code => apiIds.has(code));
    let reEnabledCount = 0, campusDisabledCount = 0, adminUpdatedCount = 0, newCampusCount = 0;
    await pMap(existingCodes, async (code) => {
      const dbRows = dbByCode.get(code) || [];
      // Re‑enable any that were disabled
      for (const row of dbRows) {
        if (row.disabled) {
          await supabase
            .from("schools")
            .update({
              disabled: false,
              needs_review: true,
              previous_data: JSON.stringify({ disabled: row.disabled ?? null }),
              updated_at: new Date()
            })
            .eq("id", row.id);
          reEnabledCount++;
        }
      }
      try {
        const campUrl = `https://services.grapeseed.com/admin/v1/schools/${code}/campuses/accessiblecampuses`;
        const campResp = await fetch(campUrl, { headers: getHeaders(token) });
        if (!campResp.ok) return;
        const apiCampuses = await campResp.json();
        const apiCampMap = new Map(apiCampuses.map(c => [c.id, c]));
        await pMap(dbRows, async (row) => {
          if (!row.campus_id) return;
          const apiCampus = apiCampMap.get(row.campus_id);
          if (!apiCampus || apiCampus.disabled) {
            const { error } = await supabase
              .from("schools")
              .update({
                disabled: true,
                needs_review: true,
                previous_data: JSON.stringify({ disabled: row.disabled ?? null }),
                updated_at: new Date()
              })
              .eq("id", row.id);
            if (!error) campusDisabledCount++;
            return;
          }
          const { adminName, adminEmail, adminPhone } = await enrichCampusAdmin(code, apiCampus);
          const hasEmptyClass = await checkEmptyClasses(code, apiCampus.id); // 🟢 CHECK EMPTY CLASSES
          const finalPhone = adminPhone || apiCampus.phone || null;
          const normalized = (s) => (s || "").trim().toLowerCase();
          if (
            normalized(adminName) !== normalized(row.admin_name) ||
            normalized(adminEmail) !== normalized(row.admin_email) ||
            normalized(finalPhone) !== normalized(row.admin_phone) ||
            hasEmptyClass !== row.has_empty_class // 🟢 ADDED: Trigger update on missing teacher changes
          ) {
            log(`🔍 Updating admin for ${row.school_name} - ${row.campus_name}: ${row.admin_name} → ${adminName}`);
            const updatePayload = {
              admin_name: adminName,
              admin_email: adminEmail,
              admin_phone: finalPhone,
              address: apiCampus.fullAddress || row.address,
              has_empty_class: hasEmptyClass, // 🟢 UPDATE
              needs_review: true,
              // Store as a JSON string to avoid serialization issues
              previous_data: JSON.stringify({
                admin_name: row.admin_name ?? null,
                admin_email: row.admin_email ?? null,
                admin_phone: row.admin_phone ?? null,
                address: row.address ?? null,
                has_empty_class: row.has_empty_class ?? null // 🟢 PRESERVE LOGS
              }),
              updated_at: new Date(),
            };
            const { error: updErr } = await supabase
              .from("schools")
              .update(updatePayload)
              .eq("id", row.id);
            if (!updErr) adminUpdatedCount++;
            else log(`❌ Update error: ${updErr.message}`); // 🟢 RESTORED: Error logging
          }
        }, { concurrency: 10 });
        // Discover and insert new campuses for this school
        const dbCampusIds = new Set(dbRows.map(r => r.campus_id).filter(Boolean));
        const newApiCampuses = apiCampuses.filter(c => !c.disabled && !dbCampusIds.has(c.id));
        if (newApiCampuses.length > 0) {
          const newRows = await pMap(newApiCampuses, async (campus) => {
            const { adminName, adminEmail, adminPhone } = await enrichCampusAdmin(code, campus);
            const hasEmptyClass = await checkEmptyClasses(code, campus.id); // 🟢 CHECK EMPTY CLASSES
            return {
              trainer_id: userId,
              school_name: dbRows[0]?.school_name || 'Unknown',
              campus_name: campus.name,
              official_code: code,
              campus_id: campus.id,
              admin_name: adminName,
              admin_email: adminEmail,
              admin_phone: adminPhone || campus.phone || null,
              address: campus.fullAddress || null,
              has_empty_class: hasEmptyClass, // 🟢 SAVE TO DB
              caring: false,
              disabled: false,
              exclusive: dbRows[0]?.exclusive || 'exclusive',
              needs_review: true,
              admin_workbook_url: null,
              notes: null,
              visit_count: null,
              created_at: new Date(),
              updated_at: new Date(),
            };
          }, { concurrency: 5 });
          if (newRows.length > 0) {
            const { error: insertErr } = await supabase.from('schools').insert(newRows);
            if (insertErr) {
              log(`❌ Insert new campuses error for ${code}: ${insertErr.message}`); // 🟢 RESTORED: Error logging
            } else {
              newCampusCount += newRows.length;
              log(`🏫 Added ${newRows.length} new campus(es) for school ${code}`); // 🟢 RESTORED: Success logging
            }
          }
        }
      } catch (e) {
        log(`⚠️ Campus sync error for ${code}: ${e.message}`);
      }
    }, { concurrency: 5 });
    // 🟢 RESTORED: Accurate duplicate logging formats
    log(
      `✅ Sync complete: ${newSchoolCount} new schools, ${newCampusCount || 0} new campuses, ${disabledCount} disabled, ` +
      `${reEnabledCount} re‑enabled, ${campusDisabledCount} campuses disabled, ${adminUpdatedCount} admin refreshed.`
    );
    log(
      `✅ Sync complete: ${newSchoolCount} new, ${disabledCount} disabled, ` +
      `${reEnabledCount} re‑enabled, ${campusDisabledCount} campuses disabled, ${adminUpdatedCount} admin refreshed.`
    );
    res.json({ success: true, logs });
  } catch (err) {
    log(`❌ sync-school-status error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, logs });
  }
});
export default router;