// server/mergeRoutes.js

import express from "express";
import { mergeTeacherSheet, mergeAdminSheet } from "./msGraphWorkbook.js";
import { updateSchoolViewOnlyUrl } from "./supabaseHelpers.js";

const router = express.Router();

router.post("/merge-teacher", async (req, res) => {
  try {
    const { workbookUrl, sheetName, model } = req.body || {};

    if (!workbookUrl || !sheetName || !model) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, or model",
      });
    }

    const sheetUrl = await mergeTeacherSheet({
      workbookUrl,
      sheetName,
      model,
    });

    // ✅ DO NOT persist anywhere
    // Teacher workbook URL lives in TEACHERS table only

    return res.json({ ok: true, sheetUrl });
  } catch (err) {
  console.error("[route] /api/merge-teacher error", err);
  return res.status(500).json({
    ok: false,
    error: err?.message || "Server error",
    stack: err?.stack, // DEV only (remove later)
  });
}
});



router.post("/merge-admin", async (req, res) => {
  try {
    const { workbookUrl, sheetName, model, schoolId } = req.body || {};

    if (!workbookUrl || !sheetName || !model || !schoolId) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, model, or schoolId",
      });
    }

    const sheetUrl = await mergeAdminSheet({
      workbookUrl,
      sheetName,
      model,
    });

    // ⚠️ View-only link not implemented yet
    // Will be added later via Graph createLink(type=view)
    const viewOnlyWorkbookUrl = null;

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
    stack: err?.stack, // DEV only (remove later)
  });
}
});
export default router;