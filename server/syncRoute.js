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

const clean = (str) => (str || "").trim().toLowerCase();

router.post("/api/sync-preparation", async (req, res) => {
  const { token, userId } = req.body;
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  log(`🛡️ PHASE 1: Data Preparation (Schools & Campuses)`);

  try {
    const supabase = getSupabase();
    if (!userId) throw new Error("❌ CRITICAL: No User ID provided.");

    // 1. Fetch current DB schools
    const { data: dbSchools, error: dbError } = await supabase
      .from("schools")
      .select("*")
      .eq("trainer_id", userId);

    if (dbError) throw dbError;
    log(`📚 DB: Found ${dbSchools.length} school records.`);

    const uniqueCodes = [...new Set(dbSchools.map(s => s.official_code).filter(Boolean))];
    const finalPayload = [];
    const claimedDbRowIds = new Set(); // Tracks which DB row (UUID) is already "taken"

    // 2. Process each Official Code
    for (const code of uniqueCodes) {
      log(`📡 Fetching API for code: ${code}`);
      const apiUrl = `https://services.grapeseed.com/admin/v1/schools/${code}/campuses/accessiblecampuses`;
      
      const response = await fetch(apiUrl, {
        headers: { "Authorization": `Bearer ${token}`, "x-gl-origin": "https://schools.grapeseed.com/" }
      });

      if (!response.ok) continue;

      const apiCampuses = await response.json();
      const dbSiblings = dbSchools.filter(s => s.official_code === code);

      // --- STEP A: MATCH BY UUID (Highest Priority) ---
      // We do this first so existing IDs are locked in.
      for (const apiC of apiCampuses) {
        const match = dbSiblings.find(s => s.campus_id === apiC.id);
        if (match) {
          finalPayload.push({
            id: match.id,
            trainer_id: userId,
            official_code: code,
            school_name: match.school_name,
            campus_name: apiC.name,
            campus_id: apiC.id,
            address: apiC.fullAddress || apiC.address || null,
            disabled: apiC.disabled === true,
            updated_at: new Date().toISOString()
          });
          claimedDbRowIds.add(match.id);
          log(`   ✅ UUID Match: ${apiC.name}`);
        }
      }

      // --- STEP B: MATCH BY NAME (Only for Unclaimed rows with NULL campus_id) ---
      // We iterate API items again, but only look at those NOT matched in Step A.
      for (const apiC of apiCampuses) {
        // Skip if this API item was already matched by UUID
        if (finalPayload.some(p => p.campus_id === apiC.id)) continue;
        
        // IMPORTANT: Only match ENABLED API items by name to avoid disabled items "stealing" rows.
        if (apiC.disabled === true) continue;

        const apiNameClean = clean(apiC.name);
        const match = dbSiblings.find(s => 
          !claimedDbRowIds.has(s.id) && 
          (s.campus_id === null || s.campus_id === "") && 
          clean(s.campus_name) === apiNameClean
        );

        if (match) {
          finalPayload.push({
            id: match.id,
            trainer_id: userId,
            official_code: code,
            school_name: match.school_name,
            campus_name: apiC.name,
            campus_id: apiC.id,
            address: apiC.fullAddress || apiC.address || null,
            disabled: false,
            updated_at: new Date().toISOString()
          });
          claimedDbRowIds.add(match.id);
          log(`   🔄 Name Match (Claimed): ${apiC.name}`);
        } else {
          // --- STEP C: CREATE NEW (If no match found and enabled) ---
          const template = dbSiblings[0] || {};
          finalPayload.push({
            trainer_id: userId,
            official_code: code,
            school_name: template.school_name || "New School",
            campus_name: apiC.name,
            campus_id: apiC.id,
            address: apiC.fullAddress || apiC.address || null,
            disabled: false,
            updated_at: new Date().toISOString()
          });
          log(`   ✨ New Campus Created: ${apiC.name}`);
        }
      }
    }

    // 3. Final Batch Execution
    if (finalPayload.length > 0) {
      log(`💾 Sending ${finalPayload.length} unique operations to Supabase...`);
      const { error: err } = await supabase.from("schools").upsert(finalPayload, { onConflict: 'id' });
      if (err) throw err;
    }

    log(`✅ Phase 1 Complete.`);
    res.json({ success: true, stats: { processed: finalPayload.length }, logs });

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message, logs });
  }
});

export default router;