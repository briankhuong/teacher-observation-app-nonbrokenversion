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

const clean = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

// Updated getHeaders to include the Regional Passport
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

  // Vietnam Regional ID derived from your network logs
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

  log("🚀 Starting Full Sync Process...");

  try {
    /* 1. Validate Trainer */
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !user) throw new Error("Trainer not found");
    log(`👤 Trainer ID: ${userId}`);

    /* ================================================================================= */
    /* PHASE 1: SCHOOL & CAMPUS SYNC (DO NOT TOUCH - PRESERVED)                          */
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

        apiCampuses.sort((a, b) => {
          if (a.disabled && !b.disabled) return -1;
          if (!a.disabled && b.disabled) return 1;
          return 0;
        });

        const existingDbRows = schoolsByCode[officialCode];

        for (const apiCamp of apiCampuses) {
          const cleanApiName = clean(apiCamp.name);
          
          let matchedRow = existingDbRows.find(r => r.campus_id === apiCamp.id) || 
                           existingDbRows.find(r => clean(r.campus_name) === cleanApiName);

          if (matchedRow) {
            const isDifferent = matchedRow.disabled !== apiCamp.disabled || matchedRow.campus_id !== apiCamp.id;
            const alreadyPending = updatesMap.has(matchedRow.id);

            if (isDifferent || alreadyPending) {
              updatesMap.set(matchedRow.id, { 
                id: matchedRow.id,
                trainer_id: userId,
                school_name: matchedRow.school_name,
                campus_name: matchedRow.campus_name, 
                official_code: officialCode,
                campus_id: apiCamp.id, 
                disabled: apiCamp.disabled, 
                updated_at: new Date()
              });
            }

          } else if (!apiCamp.disabled && existingDbRows.length > 0) {
            const parentInfo = existingDbRows[0];
            if (parentInfo.school_name && !insertsMap.has(apiCamp.id)) {
              insertsMap.set(apiCamp.id, {
                trainer_id: userId,
                official_code: officialCode,
                school_name: parentInfo.school_name,
                campus_name: apiCamp.name,
                campus_id: apiCamp.id,
                disabled: apiCamp.disabled,
                created_at: new Date()
              });
            }
          }
        }
      }));

      const updatesToProcess = Array.from(updatesMap.values());
      const insertsToProcess = Array.from(insertsMap.values());

      if (updatesToProcess.length > 0) {
        await supabase.from("schools").upsert(updatesToProcess);
        log(`🔄 Updated ${updatesToProcess.length} campus records.`);
      }

      if (insertsToProcess.length > 0) {
        await supabase.from("schools").insert(insertsToProcess);
        log(`✨ Created ${insertsToProcess.length} new campus records.`);
      }
      
      log("✅ Phase 1 Complete.");
    }

    /* ================================================================================= */
    /* PHASE 2: TEACHER UUID ALIGNMENT (PRESERVED)                                       */
    /* ================================================================================= */
    log("🚀 Starting Phase 2: Perfect Pair UUID Alignment...");

    const { data: activeSchools, error: fsErr } = await supabase
      .from("schools")
      .select("id, campus_name, campus_id")
      .eq("trainer_id", userId)
      .eq("disabled", false);

    if (fsErr) throw new Error("Phase 2 Reference Error: " + fsErr.message);

    const schoolUuidMap = new Map();
    activeSchools.forEach(s => {
      const key = `${s.id}|${clean(s.campus_name)}`;
      schoolUuidMap.set(key, s.campus_id);
    });

    const { data: teachers, error: tErr } = await supabase
      .from("teachers")
      .select("id, name, email, grapeseed_id, school_id, campus, campus_id, school_name")
      .eq("trainer_id", userId);

    if (tErr) throw new Error("Phase 2 Teacher Fetch Failed: " + tErr.message);

    const teacherUpdates = [];

    for (const t of teachers) {
      if (!t.school_id || !t.campus) continue;
      const teacherKey = `${t.school_id}|${clean(t.campus)}`;
      const correctUuid = schoolUuidMap.get(teacherKey);

      if (correctUuid && t.campus_id !== correctUuid) {
        teacherUpdates.push({
          id: t.id,
          name: t.name,
          email: t.email,
          grapeseed_id: t.grapeseed_id,
          school_name: t.school_name,
          campus: t.campus,
          school_id: t.school_id,
          trainer_id: userId,
          campus_id: correctUuid,
          updated_at: new Date()
        });
      }
    }

    if (teacherUpdates.length > 0) {
      await supabase.from("teachers").upsert(teacherUpdates);
      log(`🔗 Aligned ${teacherUpdates.length} teacher UUIDs.`);
    } else {
      log("⚪ Teacher UUIDs already aligned.");
    }

    log("✅ Phase 2 Complete.");

    /* ================================================================================= */
    /* PHASE 3.1 & 3.3: CLASS & TAG DISCOVERY (INDIVIDUAL LOOKUP)                        */
    /* ================================================================================= */
    log("🔍 Starting Phase 3.1 & 3.3: Class and Tag Discovery...");

    const { data: activeTeachers, error: tFetchErr } = await supabase
      .from("teachers")
      .select(`
        id, 
        name, 
        campus_id, 
        grapeseed_id,
        schools!inner (official_code)
      `)
      .eq("trainer_id", userId)
      .not("campus_id", "is", null);

    if (tFetchErr) {
      log(`🚨 Error fetching teachers for Phase 3: ${tFetchErr.message}`);
    } else if (activeTeachers?.length > 0) {
      log(`📊 Scanning ${activeTeachers.length} teachers...`);

      const campusClassCache = new Map();

      for (const t of activeTeachers) {
        try {
          // --- PART A: DYNAMIC TAG FETCH (Phase 3.3) ---
          let trainerAttribution = "";
          const targetGSeedId = (t.grapeseed_id || "").toLowerCase();

          if (targetGSeedId) {
            const tagUrl = `https://services.grapeseed.com/admin/v1/tags/teachertagsbyrole?entityId=${t.grapeseed_id}&regionId=${VIETNAM_REGION_ID}`;
            
            // USING REGIONAL PASSPORT HEADERS
            const tagResp = await fetch(tagUrl, { 
              headers: getHeaders(token, VIETNAM_REGION_ID) 
            });
            
            if (tagResp.ok) {
              const tagData = await tagResp.json();
              
              // Determine if tags are at root or in a property
              const tags = tagData.tags || tagData.entityTags || (Array.isArray(tagData) ? tagData : []);
              
              const trainerNames = tags
                .map(tag => (tag.name || "").trim())
                .filter(name => name && isNaN(Number(name))) 
                .map(name => name.split(' ')[0].toLowerCase());

              if (trainerNames.length > 0) {
                trainerAttribution = ` - ${[...new Set(trainerNames)].join(" & ")}`;
              }
            }
          }

          // --- PART B: CLASS FETCH (Phase 3.1) ---
          const officialCode = t.schools?.official_code;
          const campusId = t.campus_id;

          if (!officialCode) continue;

          if (!campusClassCache.has(campusId)) {
            const url = `https://services.grapeseed.com/admin/v1/schools/${officialCode}/classes?campusId=${campusId}&offset=0&limit=100&disabled=false`;
            const classResp = await fetch(url, { headers: getHeaders(token) });

            if (classResp.ok) {
              const data = await classResp.json();
              const classList = Array.isArray(data) ? data : (data.schoolClasses || []);
              campusClassCache.set(campusId, classList);
            }
          }

          const allCampusClasses = campusClassCache.get(campusId) || [];
          
          // Preserved Active/Inactive status logic with casing normalization
          const teacherClasses = allCampusClasses.filter(c => {
             const classTeacherId = (c.teacherId || "").toLowerCase();
             const subIds = (c.substituteTeacherIds || []).map(id => id.toLowerCase());
             return classTeacherId === targetGSeedId || subIds.includes(targetGSeedId);
          });

          // Final Log construction with Active/Inactive and Trainer Tags
          if (teacherClasses.length > 0) {
            log(`✅ [ACTIVE${trainerAttribution}] ${t.name} has ${teacherClasses.length} class(es).`);
            teacherClasses.forEach(c => {
              log(`   - Class: "${c.name}" | Unit: ${c.currentUnit} | Students: ${c.studentCount}`);
            });
          } else {
            log(`⚪ [INACTIVE${trainerAttribution}] ${t.name} (ID: ${t.grapeseed_id}) has 0 assigned classes.`);
          }
        } catch (e) {
          log(`🚨 Error processing ${t.name}: ${e.message}`);
        }
      }
    }

    log("✅ Phase 3.1 & 3.3 Complete.");
    res.json({ success: true, logs });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message, logs });
  }
});

export default router;