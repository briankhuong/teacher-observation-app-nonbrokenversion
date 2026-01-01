// server/mergeRoutes.js
import express from "express";
import { 
  mergeTeacherSheet, 
  mergeAdminSheet, 
  createViewOnlyLink, 
  copyFile, 
  ensureFolderExists 
} from "./msGraphWorkbook.js";

import { 
  updateSchoolViewOnlyUrl, 
  getTrainerSettings 
} from "./supabaseHelpers.js";

const router = express.Router();

router.get("/api/ping", (req, res) => {
  res.json({ ok: true, from: "mergeRoutes" });
});

function extractBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

function errPayload(err) {
  return {
    message: err?.message || "Server error",
    status: err?.status,
    url: err?.url,
    raw: err?.raw,
    stack: err?.stack, 
  };
}

// =====================================================================
// 🟢 ROUTE 1: Merge Teacher Sheet
// =====================================================================
router.post("/api/merge-teacher", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { workbookUrl, sheetName, model } = req.body || {};
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
    if (!workbookUrl || !sheetName || !model) return res.status(400).json({ ok: false, error: "Missing args" });

    const result = await mergeTeacherSheet({ token, workbookUrl, sheetName, model });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[route] /api/merge-teacher error", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error", ...errPayload(err) });
  }
});

// =====================================================================
// 🟢 ROUTE 2: Merge Admin Sheet
// =====================================================================
router.post("/api/merge-admin", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { workbookUrl, sheetName, model, schoolId } = req.body || {};
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
    if (!workbookUrl || !sheetName || !model || !schoolId) return res.status(400).json({ ok: false, error: "Missing args" });

    // 1. Run Excel Logic (Upload)
    const result = await mergeAdminSheet({ token, workbookUrl, sheetName, model });

    // 2. FAST RESPONSE
    res.json({
      ok: true,
      ...result,
      viewOnlyWorkbookUrl: null, 
      message: "Sheet merged! View link is generating in background..."
    });

    // 3. BACKGROUND WORK
    if (result.driveId && result.itemId) {
      console.log(`[Background] Generating link for School ${schoolId}...`);
      createViewOnlyLink(result.driveId, result.itemId, token)
        .then(async (link) => {
          if (link) {
            await updateSchoolViewOnlyUrl({ id: schoolId, viewOnlyUrl: link });
          }
        })
        .catch(err => {
          console.error(`[Background] Link generation failed:`, err);
        });
    }

  } catch (err) {
    console.error("[route] /api/merge-admin error", err);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: err?.message || "Server error", ...errPayload(err) });
    }
  }
});

// =====================================================================
// 🟢 ROUTE 3: Provision Teacher Workbook
// =====================================================================
router.post("/api/provision-teacher", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { teacherName, schoolName, trainerId } = req.body; 

    if (!token || !teacherName || !schoolName || !trainerId) {
      return res.status(400).json({ ok: false, error: "Missing args" });
    }

    const settings = await getTrainerSettings(trainerId);
    if (!settings || !settings.teacher_template_item_id || !settings.teacher_folder_item_id) {
      return res.status(400).json({ ok: false, error: "Settings not configured." });
    }

    const safeSchoolName = schoolName.replace(/[\/\\?%*:|"<>]/g, ".").trim();
    const safeTeacherName = teacherName.replace(/[\/\\?%*:|"<>]/g, ".").trim();

    console.log(`[Provision] Sanitized: "${safeTeacherName}" @ "${safeSchoolName}"`);

    const schoolFolderId = await ensureFolderExists(
      settings.teacher_folder_drive_id,
      settings.teacher_folder_item_id,
      safeSchoolName, 
      token
    );

    const newFileName = `Teacher ${safeTeacherName} - ${safeSchoolName}.xlsx`;

    const newItemId = await copyFile(
      settings.teacher_template_drive_id,
      settings.teacher_template_item_id, 
      settings.teacher_folder_drive_id,
      schoolFolderId,                    
      newFileName,
      token
    );

    const linkUrl = `https://graph.microsoft.com/v1.0/drives/${settings.teacher_folder_drive_id}/items/${newItemId}/createLink`;
    const linkResp = await fetch(linkUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "edit", scope: "anonymous" }) 
    });
    
    let finalUrl = null;
    if (linkResp.ok) {
      const linkData = await linkResp.json();
      finalUrl = linkData.link.webUrl;
    }

    return res.json({ ok: true, workbookUrl: finalUrl });

  } catch (err) {
    console.error("[Provision] Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================================
// 🟢 ROUTE 4: Provision School/Admin Workbook
// =====================================================================
router.post("/api/provision-school", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { schoolName, trainerId } = req.body; 

    if (!token || !schoolName || !trainerId) {
      return res.status(400).json({ ok: false, error: "Missing args (token, schoolName, trainerId)" });
    }

    // 1. Get Settings
    const settings = await getTrainerSettings(trainerId);
    
    // Check for SCHOOL settings using SPECIFIC column names
    if (!settings || !settings.school_template_item_id || !settings.school_folder_item_id) {
      console.error("❌ FAILURE: Missing 'school_template_item_id' or 'school_folder_item_id'");
      return res.status(400).json({ 
        ok: false, 
        error: "School Template or Root Folder not configured in Settings." 
      });
    }

    // Sanitization
    const safeSchoolName = schoolName.replace(/[\/\\?%*:|"<>]/g, ".").trim();
    console.log(`[Provision School] Sanitized: "${safeSchoolName}"`);

    const newFileName = `School reports - ${safeSchoolName}.xlsx`;

    // 2. Copy Template -> New File
    const newItemId = await copyFile(
      settings.school_template_drive_id,
      settings.school_template_item_id, 
      settings.school_folder_drive_id,
      settings.school_folder_item_id,    
      newFileName,
      token
    );

    // 3. Create Edit Link
    const linkUrl = `https://graph.microsoft.com/v1.0/drives/${settings.school_folder_drive_id}/items/${newItemId}/createLink`;
    const linkResp = await fetch(linkUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "edit", scope: "anonymous" }) 
    });
    
    let finalUrl = null;
    if (linkResp.ok) {
      const linkData = await linkResp.json();
      finalUrl = linkData.link.webUrl;
    }

    return res.json({ ok: true, workbookUrl: finalUrl });

  } catch (err) {
    console.error("[Provision School] Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;