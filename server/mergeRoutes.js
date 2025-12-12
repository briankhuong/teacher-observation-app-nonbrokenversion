// server/mergeRoutes.js
import express from "express";
import { mergeTeacherSheet, mergeAdminSheet } from "./msGraphWorkbook.js";
import { updateSchoolViewOnlyUrl } from "./supabaseHelpers.js";

const router = express.Router();

function getBearerToken(req) {
  const h = req.headers?.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

// Simple debug route to confirm mounting
router.get("/ping", (req, res) => {
  res.json({ ok: true, from: "mergeRoutes" });
});

// POST /api/merge-teacher
router.post("/merge-teacher", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const { workbookUrl, sheetName, model } = req.body || {};

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Graph access token" });
    }
    if (!workbookUrl || !sheetName || !model) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, or model",
      });
    }

    console.log("[/api/merge-teacher] body:", {
      workbookUrl,
      sheetName,
      hasModel: !!model,
      hasToken: !!token,
    });

    const sheetUrl = await mergeTeacherSheet({
      workbookUrl,
      sheetName,
      model,
      token, // ✅ pass delegated token
    });

    // ✅ DO NOT persist anywhere (you said URLs live in teachers/schools only)
    return res.json({ ok: true, sheetUrl });
  } catch (err) {
    console.error("[route] /api/merge-teacher error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      stack: err?.stack, // dev only
    });
  }
});

// POST /api/merge-admin
router.post("/merge-admin", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const { workbookUrl, sheetName, model, schoolId } = req.body || {};

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Graph access token" });
    }
    if (!workbookUrl || !sheetName || !model || !schoolId) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, model, or schoolId",
      });
    }

    console.log("[/api/merge-admin] body:", {
      workbookUrl,
      sheetName,
      hasModel: !!model,
      schoolId,
      hasToken: !!token,
    });

    // ✅ returns { sheetUrl, viewOnlyWorkbookUrl }
    const { sheetUrl, viewOnlyWorkbookUrl } = await mergeAdminSheet({
      workbookUrl,
      sheetName,
      model,
      token, // ✅ pass delegated token
    });

    // persist view-only URL on school (optional)
    if (viewOnlyWorkbookUrl) {
      await updateSchoolViewOnlyUrl({
        id: schoolId,
        viewOnlyUrl: viewOnlyWorkbookUrl,
      });
    }

    return res.json({ ok: true, sheetUrl, viewOnlyWorkbookUrl });
  } catch (err) {
    console.error("[route] /api/merge-admin error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      stack: err?.stack, // dev only
    });
  }
});

export default router;