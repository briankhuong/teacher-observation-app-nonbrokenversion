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
  const { token, userId } = req.body; // <--- MUST RECEIVE YOUR SUPABASE USER ID
  const logs = [];
  const log = (m) => { console.log(m); logs.push(m); };

  log("🚀 Sync Started: Personal Account Only...");

  try {
    const supabase = getSupabase();

    if (!userId) {
      throw new Error("❌ CRITICAL: No User ID provided. Cannot identify your schools.");
    }

    // 1. Fetch API Data (Logistics Token sees ALL, so we fetch normally)
    const vbaUserId = "b6133f96-5f21-47ca-9ab3-1b4205bf073f";
    const myurl = `https://services.grapeseed.com/admin/v1/resources/users/${vbaUserId}/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName`;

    const response = await fetch(myurl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-gl-origin": "https://schools.grapeseed.com/",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) throw new Error(`GrapeSEED API Failed: ${response.status}`);
    const allData = await response.json();

    // Map status by School UUID
    const apiSchoolMap = new Map(); 
    if (Array.isArray(allData)) {
      allData.forEach(item => {
        const sId = item.schoolId;
        if (!apiSchoolMap.has(sId)) apiSchoolMap.set(sId, false);
        if (!item.teacherId) apiSchoolMap.set(sId, true);
      });
    }

    // 2. Get ONLY YOUR schools from DB
    // STRICT FILTER: .eq("trainer_id", userId)
    const { data: mySchools, error: dbError } = await supabase
      .from("schools")
      .select("id, school_name, official_code")
      .eq("trainer_id", userId); // <--- THIS LINE SAVES YOU

    if (dbError) throw new Error(`Supabase Error: ${dbError.message}`);
    
    const validSchools = mySchools || [];

    if (validSchools.length === 0) {
      log("⚠️ You have no schools assigned to your account in Supabase.");
      return res.json({ success: true, logs });
    }

    log(`Step 2: Checking your ${validSchools.length} schools against API...`);
    
    const uniqueAccountSchools = new Set();
    const emptySchoolNames = new Set();

    for (const row of validSchools) {
      if (row.official_code && apiSchoolMap.has(row.official_code)) {
        uniqueAccountSchools.add(row.official_code);
        
        const hasEmpty = apiSchoolMap.get(row.official_code);
        
        if (hasEmpty) {
            emptySchoolNames.add(row.school_name);
        }
        
        // Update DB (Only touches rows belonging to userId)
        await supabase
          .from("schools")
          .update({ has_empty_class: hasEmpty })
          .eq("id", row.id);
      }
    }

    log(`✅ Synced ${uniqueAccountSchools.size} unique schools belonging to YOU.`);
    log(`🚩 Found ${emptySchoolNames.size} of YOUR schools with empty classes.`);
    
    if (emptySchoolNames.size > 0) {
        log("📋 Your Action Items:");
        emptySchoolNames.forEach(name => log(`   • ${name}`));
    }

    res.json({ success: true, logs });

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;