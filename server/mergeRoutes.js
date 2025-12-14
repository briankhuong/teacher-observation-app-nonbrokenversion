import express from "express";
// 🔹 Import createViewOnlyLink here
import { mergeTeacherSheet, mergeAdminSheet, createViewOnlyLink } from "./msGraphWorkbook.js";
import { updateSchoolViewOnlyUrl } from "./supabaseHelpers.js";

const router = express.Router();

router.get("/ping", (req, res) => {
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

router.post("/merge-teacher", async (req, res) => {
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

router.post("/merge-admin", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { workbookUrl, sheetName, model, schoolId } = req.body || {};
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
    if (!workbookUrl || !sheetName || !model || !schoolId) return res.status(400).json({ ok: false, error: "Missing args" });

    // 1. Run Excel Logic (Upload)
    const result = await mergeAdminSheet({ token, workbookUrl, sheetName, model });

    // 2. FAST RESPONSE: Send "Success" to UI immediately
    res.json({
      ok: true,
      ...result,
      // The UI will see this is null initially, but that's okay because...
      viewOnlyWorkbookUrl: null, 
      message: "Sheet merged! View link is generating in background..."
    });

    // 3. BACKGROUND WORK: Generate Link & Update DB
    if (result.driveId && result.itemId) {
      console.log(`[Background] Generating link for School ${schoolId}...`);
      
      createViewOnlyLink(result.driveId, result.itemId, token)
        .then(async (link) => {
          if (link) {
            console.log(`[Background] Link created: ${link}`);
            await updateSchoolViewOnlyUrl({ id: schoolId, viewOnlyUrl: link });
          } else {
            console.warn(`[Background] Link creation returned null.`);
          }
        })
        .catch(err => {
          console.error(`[Background] Link generation failed:`, err);
        });
    }

  } catch (err) {
    console.error("[route] /api/merge-admin error", err);
    // Only send error if we haven't sent the success response yet
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: err?.message || "Server error", ...errPayload(err) });
    }
  }
});

export default router;