// server/msGraphWorkbook.js
// Robust merge that does NOT depend on worksheet copy being supported.
// If worksheet copy works -> use _TEMPLATE / _ADMIN_TEMPLATE.
// If not -> create new sheet + write values; formatting is best-effort (non-fatal).

// ------------------------------
// Helpers: ShareId + Graph
// ------------------------------
function toBase64Url(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function shareIdFromUrl(url) {
  return `u!${toBase64Url(url)}`;
}

// Excel worksheet name rules (important):
// - max length 31
// - cannot contain: : \ / ? * [ ]
// - cannot be empty
function excelSafeSheetName(input) {
  const cleaned = String(input || "")
    .replace(/[:\\\/\?\*\[\]]/g, " ") // illegal chars -> space
    .replace(/\s+/g, " ")
    .trim();

  const nonEmpty = cleaned.length > 0 ? cleaned : "Sheet";
  return nonEmpty.slice(0, 31);
}

async function graphJson(url, { method = "GET", token, body } = {}) {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      (typeof json?.raw === "string" ? json.raw : "") ||
      `Graph error ${resp.status}`;

    const err = new Error(msg);
    err.status = resp.status;
    err.raw = text;
    err.url = url;
    throw err;
  }

  return json;
}

async function resolveWorkbookFromSharingUrl(workbookUrl, token) {
  const shareId = shareIdFromUrl(workbookUrl);
  const item = await graphJson(
    `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`,
    { token }
  );

  return {
    driveId: item?.parentReference?.driveId,
    itemId: item?.id,
  };
}

function wsBase(driveId, itemId, sheetName) {
  return `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(
    sheetName
  )}`;
}

async function listSheets({ driveId, itemId, token }) {
  const res = await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`,
    { token }
  );
  return res.value || [];
}

async function uniqueSheetName({ driveId, itemId, token, base }) {
  // sanitize BEFORE checking + creating
  const safeBase = excelSafeSheetName(base);

  const sheets = await listSheets({ driveId, itemId, token });
  const names = new Set(sheets.map((s) => s.name));
  if (!names.has(safeBase)) return safeBase;

  let i = 2;
  while (i < 100) {
    const n = excelSafeSheetName(`${safeBase} (${i})`);
    if (!names.has(n)) return n;
    i++;
  }

  return excelSafeSheetName(`${safeBase}-${Date.now()}`);
}

async function ensureSheet({ driveId, itemId, token, name }) {
  const safeName = excelSafeSheetName(name);

  // POST /workbook/worksheets/add
  await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/add`,
    { token, method: "POST", body: { name: safeName } }
  );

  return safeName;
}

async function write({ driveId, itemId, token, sheetName, addr, values }) {
  await graphJson(
    `${wsBase(driveId, itemId, sheetName)}/range(address='${addr}')`,
    { token, method: "PATCH", body: { values } }
  );
}

// NOTE: Graph is picky about some format enums.
// Keep patches minimal + safe.
async function patchRangeFormat({
  driveId,
  itemId,
  token,
  sheetName,
  addr,
  formatPatch,
}) {
  await graphJson(
    `${wsBase(driveId, itemId, sheetName)}/range(address='${addr}')/format`,
    { token, method: "PATCH", body: formatPatch }
  );
}

// ------------------------------
// Try worksheet copy (may fail)
// ------------------------------
async function tryCopyWorksheet({ driveId, itemId, token, templateName, newName }) {
  const safeNewName = excelSafeSheetName(newName);

  // Validate template exists (better error)
  const sheets = await listSheets({ driveId, itemId, token });
  const found = sheets.find((s) => s.name === templateName);
  if (!found) {
    return {
      ok: false,
      error: `Template sheet "${templateName}" not found in workbook.`,
    };
  }

  try {
    // POST /workbook/worksheets/{id|name}/copy
    await graphJson(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}` +
        `/workbook/worksheets/${encodeURIComponent(templateName)}/copy`,
      { token, method: "POST", body: { name: safeNewName } }
    );

    return { ok: true, error: null, newName: safeNewName };
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
    };
  }
}

// ------------------------------
// Fallback formatting (non-fatal)
// Keep it MINIMAL. Add more later.
// ------------------------------
async function applyTeacherTemplateFallback({ driveId, itemId, token, sheetName }) {
  // Keep these VERY safe to avoid InvalidArgument.
  // (Graph sometimes rejects alignment enums; avoid fancy patches for now.)
  await patchRangeFormat({
    driveId,
    itemId,
    token,
    sheetName,
    addr: "A1:F3",
    formatPatch: { font: { bold: true } },
  });

  await patchRangeFormat({
    driveId,
    itemId,
    token,
    sheetName,
    addr: "A1:F200",
    formatPatch: { alignment: { wrapText: true } },
  });
}

async function applyAdminTemplateFallback({ driveId, itemId, token, sheetName }) {
  await patchRangeFormat({
    driveId,
    itemId,
    token,
    sheetName,
    addr: "A1:E4",
    formatPatch: { font: { bold: true } },
  });

  await patchRangeFormat({
    driveId,
    itemId,
    token,
    sheetName,
    addr: "A6:E19",
    formatPatch: { alignment: { wrapText: true } },
  });
}

// ======================================================
// TEACHER MERGE
// ======================================================
export async function mergeTeacherSheet({ workbookUrl, sheetName, model, token }) {
  if (!model) throw new Error("Missing model (teacher export model).");

  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);
  if (!driveId || !itemId) throw new Error("Could not resolve workbook driveId/itemId.");

  const finalName = await uniqueSheetName({ driveId, itemId, token, base: sheetName });

  // 1) Try copy from _TEMPLATE. If not supported, fallback to add+format.
  const copyAttempt = await tryCopyWorksheet({
    driveId,
    itemId,
    token,
    templateName: "_TEMPLATE",
    newName: finalName,
  });

  let formattingWarning = null;

  if (!copyAttempt.ok) {
    // Fallback: add sheet
    const createdName = await ensureSheet({
      driveId,
      itemId,
      token,
      name: finalName,
    });

    // Best-effort formatting (never throw)
    try {
      await applyTeacherTemplateFallback({
        driveId,
        itemId,
        token,
        sheetName: createdName,
      });
    } catch (e) {
      formattingWarning = `Teacher formatting failed (non-fatal): ${e?.message || e}`;
      console.warn("[mergeTeacherSheet] formattingWarning:", formattingWarning);
    }
  }

  // 2) Header block (A1)
  if (typeof model.headerBlock === "string") {
    await write({
      driveId,
      itemId,
      token,
      sheetName: finalName,
      addr: "A1",
      values: [[model.headerBlock]],
    });
  }

  // 3) Body mapping (rows 4–200; columns B..F)
  if (Array.isArray(model.rows) && model.rows.length > 0) {
    for (const r of model.rows) {
      const rowIndex = Number(r.rowIndex);
      if (!rowIndex || rowIndex < 4 || rowIndex > 200) continue;

      await write({
        driveId,
        itemId,
        token,
        sheetName: finalName,
        addr: `B${rowIndex}:F${rowIndex}`,
        values: [[
          r.indicatorLabel ?? "",
          r.description ?? "",
          r.checklist ?? "",
          r.strengths ?? "",
          r.growths ?? "",
        ]],
      });
    }
  }

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    usedCopy: copyAttempt.ok,
    copyError: copyAttempt.ok ? null : copyAttempt.error,
    formattingWarning, // 👈 show as warning in UI
  };
}

// ======================================================
// ADMIN MERGE
// ======================================================
export async function mergeAdminSheet({ workbookUrl, sheetName, model, token }) {
  if (!model) throw new Error("Missing model (admin export model).");

  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);
  if (!driveId || !itemId) throw new Error("Could not resolve workbook driveId/itemId.");

  const finalName = await uniqueSheetName({ driveId, itemId, token, base: sheetName });

  // 1) Try copy from _ADMIN_TEMPLATE. If not supported, fallback.
  const copyAttempt = await tryCopyWorksheet({
    driveId,
    itemId,
    token,
    templateName: "_ADMIN_TEMPLATE",
    newName: finalName,
  });

  let formattingWarning = null;

  if (!copyAttempt.ok) {
    const createdName = await ensureSheet({
      driveId,
      itemId,
      token,
      name: finalName,
    });

    try {
      await applyAdminTemplateFallback({
        driveId,
        itemId,
        token,
        sheetName: createdName,
      });
    } catch (e) {
      formattingWarning = `Admin formatting failed (non-fatal): ${e?.message || e}`;
      console.warn("[mergeAdminSheet] formattingWarning:", formattingWarning);
    }
  }

  // 2) Header writes
  await write({
    driveId,
    itemId,
    token,
    sheetName: finalName,
    addr: "A1",
    values: [[model.headerLeft ?? ""]],
  });

  await write({
    driveId,
    itemId,
    token,
    sheetName: finalName,
    addr: "D1",
    values: [[model.headerRight ?? ""]],
  });

  await write({
    driveId,
    itemId,
    token,
    sheetName: finalName,
    addr: "D4",
    values: [[`GV: ${model.teacherName ?? ""}`]],
  });

  // 3) Body rows MUST be A6:E19 (14 rows)
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const padded = [];
  for (let i = 0; i < 14; i++) {
    const r = rows[i] || {};
    padded.push([
      r.mainCategory ?? "",
      r.aspect ?? "",
      r.classroomSigns ?? "",
      r.trainerRating ?? "",
      r.trainerNotes ?? "",
    ]);
  }

  await write({
    driveId,
    itemId,
    token,
    sheetName: finalName,
    addr: "A6:E19",
    values: padded,
  });

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    usedCopy: copyAttempt.ok,
    copyError: copyAttempt.ok ? null : copyAttempt.error,
    formattingWarning,
    viewOnlyWorkbookUrl: null, // keep your later logic if you generate it elsewhere
  };
}