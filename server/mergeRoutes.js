// server/mergeRoutes.js
import express from "express";
import { mergeTeacherSheet, mergeAdminSheet } from "./msGraphWorkbook.js";
import {
  updateObservationMetaLinks,
  updateSchoolViewOnlyUrl,
} from "./supabaseHelpers.js";

const router = express.Router();

// Simple debug route to confirm mounting
router.get("/ping", (req, res) => {
  res.json({ ok: true, from: "mergeRoutes" });
});

// POST /api/merge-teacher  (mounted later at /api)
router.post("/merge-teacher", async (req, res) => {
  try {
    const { workbookUrl, sheetName, model, observationId } = req.body || {};

    if (!workbookUrl || !sheetName || !model || !observationId) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, model or observationId",
      });
    }

    console.log("[/api/merge-teacher] body:", {
      workbookUrl,
      sheetName,
      hasModel: !!model,
      observationId,
    });

    // 1) merge into teacher workbook (Graph)
    const sheetUrl = await mergeTeacherSheet({
      workbookUrl,
      sheetName,
      model,
    });

    // 2) store sheetUrl into observation.meta.teacherSheetUrl
    await updateObservationMetaLinks({
      id: observationId,
      teacherSheetUrl: sheetUrl,
    });

    return res.json({ ok: true, sheetUrl });
  } catch (err) {
    console.error("[route] /api/merge-teacher error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/merge-admin  (mounted later at /api)
router.post("/merge-admin", async (req, res) => {
  try {
    const { workbookUrl, sheetName, model, observationId, schoolId } =
      req.body || {};

    if (!workbookUrl || !sheetName || !model || !observationId || !schoolId) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing workbookUrl, sheetName, model, observationId or schoolId",
      });
    }

    console.log("[/api/merge-admin] body:", {
      workbookUrl,
      sheetName,
      hasModel: !!model,
      observationId,
      schoolId,
    });

    // 1) merge into admin workbook (Graph)
    const { sheetUrl, viewOnlyWorkbookUrl } = await mergeAdminSheet({
      workbookUrl,
      sheetName,
      model,
    });

    // 2) update observation.meta.adminSheetUrl
    await updateObservationMetaLinks({
      id: observationId,
      adminSheetUrl: sheetUrl,
    });

    // 3) update schools.admin_view_only_workbook_url
    if (viewOnlyWorkbookUrl) {
      await updateSchoolViewOnlyUrl({
        id: schoolId,
        viewOnlyWorkbookUrl,
      });
    }

    return res.json({ ok: true, sheetUrl, viewOnlyWorkbookUrl });
  } catch (err) {
    console.error("[route] /api/merge-admin error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;