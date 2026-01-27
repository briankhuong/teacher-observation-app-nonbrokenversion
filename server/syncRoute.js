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

// Concurrency Helper
async function pMap(array, mapper, { concurrency = 12 } = {}) {
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
  
  // TEST IDs
  const targetOfficialCode = "73683863-18de-4e91-ba09-c41e0bd40137";
  const targetCampusId = "cdc6985f-2bb5-4312-9c76-50afac183a93";
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  // VARS
  const startTime = Date.now();
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  try {
    /* 1. TRAINER IDENTITY (NORMALIZED) */
    const { data: { user: trainerUser }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !trainerUser) throw new Error("Trainer not found");
    
    // Force lowercase for comparison (e.g., "Brian" -> "brian")
    const myNameRaw = trainerUser.user_metadata?.display_name || trainerUser.user_metadata?.full_name || "";
    const myName = clean(myNameRaw).split(" ")[0]; 
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
    const { data: preSnapshot } = await supabase.from("teachers").select("*").eq("trainer_id", userId);
    
    // Find teachers at this school row (by ID or Name) who have the WRONG campus_id
    const moveQueue = preSnapshot.filter(t => 
      t.school_id === schoolRow.id && 
      clean(t.campus) === clean(schoolRow.campus_name) && 
      t.campus_id !== targetCampusId
    );
    
    if (moveQueue.length > 0) {
      await supabase.from("teachers").upsert(moveQueue.map(t => ({ id: t.id, trainer_id: userId, campus_id: targetCampusId })));
    }
    log("✅ Phase 2 Complete.");

    /* ================================================================================= */
    /* PHASE 3: IDENTITY HANDSHAKE & TAG LOGIC                                           */
    /* ================================================================================= */
    log("📌 Phase 3: Identity Handshake...");
    const { data: globalSnapshot } = await supabase.from("teachers").select("*").eq("trainer_id", userId);
    
    const classResp = await fetch(`https://services.grapeseed.com/admin/v1/schools/${targetOfficialCode}/classes?campusId=${targetCampusId}&offset=0&limit=100&disabled=false`, { headers: getHeaders(token) });
    const classData = await classResp.json();
    const apiClasses = classData.schoolClasses || classData || [];

    // BUILD ACTIVE ROLL CALL
    const apiActiveIds = new Set();
    apiClasses.forEach(c => {
      if (c.teacherId) apiActiveIds.add(c.teacherId.toLowerCase());
      if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => apiActiveIds.add(id.toLowerCase()));
    });

    // --- LOGIC: INACTIVE STATUS ---
    // Anyone in our DB sandbox who is NOT in the API Roll Call is Inactive
    const inactivePayload = globalSnapshot
      .filter(t => t.campus_id === targetCampusId && !apiActiveIds.has((t.grapeseed_id || "").toLowerCase()))
      .map(t => ({ id: t.id, trainer_id: userId, tags: ["Inactive"], updated_at: new Date() }));
    
    if (inactivePayload.length > 0) log(`⚠️ Found ${inactivePayload.length} Inactive teachers.`);

    const finalUpdates = [...inactivePayload];
    const finalInserts = [];
    const runEmails = new Set();

    await pMap(Array.from(apiActiveIds), async (gseedId) => {
      const [pResp, tResp] = await Promise.all([
        fetch(`https://services.grapeseed.com/account/v1/users?ids=${gseedId}`, { headers: getHeaders(token) }),
        fetch(`https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${gseedId}&regionId=${VIETNAM_REGION_ID}`, { headers: getHeaders(token, VIETNAM_REGION_ID) })
      ]);

      const prof = (await pResp.json())[0];
      if (!prof) return;
      const apiEmail = (prof.email || "").toLowerCase().trim();

      // --- LOGIC: TAG FILTERING ---
      let finalTags = [];
      let rawTagNames = [];

      if (tResp.ok) {
        const tData = await tResp.json();
        const raw = tData.tags || tData.entityTags || [];
        // Normalize API tags to lowercase names
        rawTagNames = raw.map(t => clean(t.name || "").split(" ")[0]).filter(n => n && isNaN(n));
      }

      if (rawTagNames.length > 0) {
        // We have tags. Filter out MY name.
        const others = rawTagNames.filter(name => name !== myName);
        
        if (others.length === 0 && rawTagNames.includes(myName)) {
          // Case 1: Only I was there. Result: Exclusive (Empty Array).
          finalTags = []; 
        } else if (others.length > 0) {
          // Case 2: Others are there (Shared). Result: Their names.
          finalTags = others;
        } else {
           // Edge case: Tags existed but were weird/numbers, or didn't match me but also didn't match others (shouldn't happen with logic above)
           // Default to whatever is left or "No tag" if purely empty
           finalTags = others.length ? others : ["No tag"];
        }
      } else {
        // Case 3: API returned empty list. Result: Ghost.
        finalTags = ["No tag"];
      }

      // --- LOGIC: IDENTITY SEARCH ---
      // 1. Match by ID + School Row (Most precise)
      let match = globalSnapshot.find(t => (t.grapeseed_id || "").toLowerCase() === gseedId && t.school_id === schoolRow.id);
      
      // 2. Rescue by Email + School Row + Campus Name (Manual Record Rescue)
      if (!match && apiEmail) {
        match = globalSnapshot.find(t => 
          (t.email || "").toLowerCase().trim() === apiEmail && 
          t.school_id === schoolRow.id && 
          clean(t.campus) === clean(schoolRow.campus_name)
        );
      }

      const payload = {
        trainer_id: userId, grapeseed_id: gseedId, name: prof.name, email: apiEmail,
        school_id: schoolRow.id, school_name: schoolRow.school_name,
        campus: schoolRow.campus_name, campus_id: targetCampusId,
        tags: finalTags, updated_at: new Date()
      };

      if (match) {
        finalUpdates.push({ id: match.id, ...payload });
        log(`🔗 [MATCH] ${prof.name} | Tags: ${JSON.stringify(finalTags)}`);
      } else {
        if (apiEmail && runEmails.has(apiEmail)) return;
        finalInserts.push({ ...payload, created_at: new Date() });
        log(`✨ [NEW] ${prof.name} | Tags: ${JSON.stringify(finalTags)}`);
        if (apiEmail) runEmails.add(apiEmail);
      }
    }, { concurrency: 12 });

    /* ================================================================================= */
    /* PHASE 4: FINAL BATCH COMMIT                                                       */
    /* ================================================================================= */
    if (finalUpdates.length > 0) await supabase.from("teachers").upsert(finalUpdates, { onConflict: 'id' });
    if (finalInserts.length > 0) await supabase.from("teachers").insert(finalInserts);

    log(`🏁 Finished: ${finalUpdates.length} updated, ${finalInserts.length} new in ${((Date.now() - startTime)/1000).toFixed(2)}s`);
    res.json({ success: true, logs });

  } catch (err) {
    log(`❌ FATAL: ${err.message}`);
    res.json({ success: false, error: err.message, logs });
  }
});

export default router;