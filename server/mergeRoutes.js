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

function errPayload(err) {
  return {
    message: err?.message || "Server error",
    status: err?.status,
    url: err?.url,
    raw: err?.raw,
    stack: err?.stack, // DEV only
  };
}

router.post("/merge-teacher", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { workbookUrl, sheetName, model } = req.body || {};

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Missing Authorization Bearer token",
      });
    }

    if (!workbookUrl || !sheetName || !model) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, or model",
      });
    }

    const result = await mergeTeacherSheet({
      token,
      workbookUrl,
      sheetName,
      model,
    });

    // ✅ Teacher merge success even if formattingWarning exists
    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("[route] /api/merge-teacher error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      ...errPayload(err),
    });
  }
});

router.post("/merge-admin", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    const { workbookUrl, sheetName, model, schoolId } = req.body || {};

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Missing Authorization Bearer token",
      });
    }

    if (!workbookUrl || !sheetName || !model || !schoolId) {
      return res.status(400).json({
        ok: false,
        error: "Missing workbookUrl, sheetName, model, or schoolId",
      });
    }

    const result = await mergeAdminSheet({
      token,
      workbookUrl,
      sheetName,
      model,
    });

    // ✅ Store view-only url on school (optional)
    if (result?.viewOnlyWorkbookUrl) {
      await updateSchoolViewOnlyUrl({
        id: schoolId,
        viewOnlyUrl: result.viewOnlyWorkbookUrl,
      });
    }

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("[route] /api/merge-admin error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      ...errPayload(err),
    });
  }
});
export default router;