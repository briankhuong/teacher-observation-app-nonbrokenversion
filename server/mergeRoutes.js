// server/mergeRoutes.js
import express from "express";
import { mergeTeacherSheet, mergeAdminSheet } from "./msGraphWorkbook.js";
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

router.post("/merge-teacher", async (req, res) => {
  try {
    const token = extractBearerToken(req);

    const { workbookUrl, sheetName, model } = req.body || {};
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }
    if (!workbookUrl || !sheetName || !model) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, or model",
      });
    }

    const sheetUrl = await mergeTeacherSheet({
      token,
      workbookUrl,
      sheetName,
      model,
    });

    // ✅ DO NOT persist anywhere (teacher workbook URL lives in TEACHERS table only)
    return res.json({ ok: true, sheetUrl });
  } catch (err) {
    console.error("[route] /api/merge-teacher error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      stack: err?.stack, // DEV only
    });
  }
});

router.post("/merge-admin", async (req, res) => {
  try {
    const token = extractBearerToken(req);

    const { workbookUrl, sheetName, model, schoolId } = req.body || {};
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }
    if (!workbookUrl || !sheetName || !model || !schoolId) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, model, or schoolId",
      });
    }

    const { sheetUrl, viewOnlyWorkbookUrl } = await mergeAdminSheet({
      token,
      workbookUrl,
      sheetName,
      model,
    });

    // ✅ Store view-only url on school (for admin email later)
    if (viewOnlyWorkbookUrl) {
      await updateSchoolViewOnlyUrl({
        id: schoolId,
        viewOnlyUrl: viewOnlyWorkbookUrl,
      });
    }

    return res.json({
      ok: true,
      sheetUrl,
      viewOnlyWorkbookUrl,
    });
  } catch (err) {
    console.error("[route] /api/merge-admin error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      stack: err?.stack, // DEV only
    });
  }
});

export default router;