import fetch from "node-fetch";

const getHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "x-gl-origin": "https://schools.grapeseed.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
});

export const runHardProbe = async (token, log) => {
  const TARGET_CODE = "73683863-18de-4e91-ba09-c41e0bd40137";
  const TARGET_CAMPUS = "cdc6985f-2bb5-4312-9c76-50afac183a93";

  log(`🛡️ [PROBE SERVICE] Starting Deep Rescue for Việt Hưng - CS 3...`);

  try {
    // 1. Get Teacher IDs from the Class list
    const classUrl = `https://services.grapeseed.com/admin/v1/schools/${TARGET_CODE}/classes?campusId=${TARGET_CAMPUS}&offset=0&limit=100&disabled=false`;
    const classResp = await fetch(classUrl, { headers: getHeaders(token) });
    if (!classResp.ok) return log(`❌ PROBE: Classes API error ${classResp.status}`);

    const classData = await classResp.json();
    const classes = Array.isArray(classData) ? classData : (classData.schoolClasses || []);
    const ids = new Set();
    classes.forEach(c => {
      if (c.teacherId) ids.add(c.teacherId.toLowerCase());
      if (c.substituteTeacherIds) c.substituteTeacherIds.forEach(id => ids.add(id.toLowerCase()));
    });

    log(`📍 PROBE: Found ${ids.size} IDs in API classes. Attempting profile retrieval...`);

    // 2. Pre-fetch School Teacher List as the final fallback
    const schoolListUrl = `https://services.grapeseed.com/admin/v1/schools/${TARGET_CODE}/teachers`;
    const schoolListResp = await fetch(schoolListUrl, { headers: getHeaders(token) });
    let schoolBackup = [];
    if (schoolListResp.ok) schoolBackup = await schoolListResp.json();

    for (const id of ids) {
      // --- ATTEMPT 1: Original POST Batch Fetch ---
      const pResp = await fetch("https://services.grapeseed.com/account/v1/users/getUsersByIds", {
        method: "POST",
        headers: getHeaders(token),
        body: JSON.stringify([id])
      });

      if (pResp.ok) {
        const [prof] = await pResp.json();
        if (prof) {
          log(`✅ [PRIMARY SUCCESS] ID ${id} is [${prof.name}]`);
          continue;
        }
      }

      log(`⚠️ [PRIMARY FAILED] Status ${pResp.status} for ID ${id}. Starting Rescues...`);

      // --- ATTEMPT 2: GET Users via Query String (Your Suggestion) ---
      const timestamp = Date.now();
      const getUrl = `https://services.grapeseed.com/account/v1/users?ids=${id}&${timestamp}`;
      const getResp = await fetch(getUrl, { headers: getHeaders(token) });

      if (getResp.ok) {
        const getProfiles = await getResp.json();
        const profile = Array.isArray(getProfiles) ? getProfiles[0] : getProfiles;
        if (profile && profile.name) {
          log(`✨ [RESCUE A SUCCESS] Found via GET API: [${profile.name}]`);
          continue;
        }
      }

      // --- ATTEMPT 3: School Teacher Backup ---
      const rescued = schoolBackup.find(t => (t.id || "").toLowerCase() === id);
      if (rescued) {
        log(`✨ [RESCUE B SUCCESS] Found in School Teacher List: [${rescued.name}]`);
      } else {
        log(`❌ [TOTAL FAILURE] ID ${id} could not be resolved by any endpoint.`);
      }
    }
  } catch (err) {
    log(`❌ PROBE CRITICAL ERROR: ${err.message}`);
  }
};