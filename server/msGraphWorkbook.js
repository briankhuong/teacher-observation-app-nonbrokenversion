// server/msGraphWorkbook.js
// Node 18+ has global fetch. If not:
// import fetch from "node-fetch";

function toBase64Url(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function shareIdFromUrl(url) {
  // Graph expects: u!{base64url(url)}
  return `u!${toBase64Url(url)}`;
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
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Graph HTTP ${resp.status}: ${text?.slice(0, 300)}`;
    throw new Error(msg);
  }
  return json;
}

async function resolveWorkbookFromSharingUrl(workbookUrl, token) {
  const shareId = shareIdFromUrl(workbookUrl);

  // IMPORTANT: sharing URL must be the full sharing link.
  const driveItem = await graphJson(
    `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`,
    { token }
  );

  const driveId = driveItem?.parentReference?.driveId;
  const itemId = driveItem?.id;

  if (!driveId || !itemId) {
    throw new Error("Could not resolve driveId/itemId from sharing URL.");
  }
  return { driveId, itemId, driveItem };
}

async function listWorksheets({ driveId, itemId, token }) {
  const data = await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`,
    { token }
  );
  return data?.value || [];
}

async function ensureWorksheet({ driveId, itemId, token, sheetName }) {
  const sheets = await listWorksheets({ driveId, itemId, token });
  const found = sheets.find((s) => s?.name === sheetName);
  if (found) return found;

  const created = await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/add`,
    { token, method: "POST", body: { name: sheetName } }
  );

  // sometimes returns { worksheet: {...} }
  return created?.worksheet || created;
}

async function writeRangeValues({
  driveId,
  itemId,
  token,
  sheetName,
  address,
  values,
}) {
  // values must be 2D array
  return await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(
      sheetName
    )}/range(address='${address}')`,
    {
      token,
      method: "PATCH",
      body: { values },
    }
  );
}

async function createViewOnlyLink({ driveId, itemId, token }) {
  // Many tenants allow either:
  // - scope: "anonymous" (best for sharing outside org)
  // - scope: "organization" (requires login)
  // We'll try anonymous first, then fall back.
  try {
    const resp = await graphJson(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`,
      {
        token,
        method: "POST",
        body: { type: "view", scope: "anonymous" },
      }
    );
    return resp?.link?.webUrl || null;
  } catch (e) {
    const resp = await graphJson(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`,
      {
        token,
        method: "POST",
        body: { type: "view", scope: "organization" },
      }
    );
    return resp?.link?.webUrl || null;
  }
}

// ------------------------------------------------------------
// TEACHER MERGE (REAL WRITES - minimal proof)
// ------------------------------------------------------------
export async function mergeTeacherSheet({ workbookUrl, sheetName, model, token }) {
  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);

  await ensureWorksheet({ driveId, itemId, token, sheetName });

  // Minimal proof writes (safe)
  await writeRangeValues({
    driveId,
    itemId,
    token,
    sheetName,
    address: "A1",
    values: [[model?.headerTitle || "Teacher Observation"]],
  });

  await writeRangeValues({
    driveId,
    itemId,
    token,
    sheetName,
    address: "A2",
    values: [[`Teacher: ${model?.teacherName || ""}`]],
  });

  await writeRangeValues({
    driveId,
    itemId,
    token,
    sheetName,
    address: "A3",
    values: [[`School: ${model?.schoolName || ""}`]],
  });

  await writeRangeValues({
    driveId,
    itemId,
    token,
    sheetName,
    address: "A4",
    values: [[`Date: ${model?.date || ""}`]],
  });

  // Optional rows table
  if (Array.isArray(model?.rows) && model.rows.length > 0) {
    const startRow = 6;
    const values = model.rows.map((r) => [
      r.number ?? "",
      r.aspect ?? "",
      r.good ? "Good" : "",
      r.growth ? "Growth" : "",
      r.commentText ?? "",
    ]);

    const endRow = startRow + values.length - 1;
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: `A${startRow}:E${endRow}`,
      values,
    });
  }

  // Return sheet deep link
  return `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
}

// ------------------------------------------------------------
// ADMIN MERGE (REAL WRITES + view-only link)
// ------------------------------------------------------------
export async function mergeAdminSheet({ workbookUrl, sheetName, model, token }) {
  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);

  await ensureWorksheet({ driveId, itemId, token, sheetName });

  // Header blocks (adjust to your template later)
  await writeRangeValues({
    driveId,
    itemId,
    token,
    sheetName,
    address: "A1",
    values: [[model?.headerLeft || ""]],
  });

  await writeRangeValues({
    driveId,
    itemId,
    token,
    sheetName,
    address: "D1",
    values: [[model?.headerRight || ""]],
  });

  // Table rows
  const TABLE_START_ROW = 5;
  if (Array.isArray(model?.rows) && model.rows.length > 0) {
    const values = model.rows.map((r) => [
      r.mainCategory ?? "",
      r.aspect ?? "",
      r.classroomSigns ?? "",
      r.trainerRating ?? "",
      r.trainerNotes ?? "",
    ]);

    const endRow = TABLE_START_ROW + values.length - 1;
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: `A${TABLE_START_ROW}:E${endRow}`,
      values,
    });
  }

  // Trainer summary (write into F5; your template can merge cells)
  if (model?.trainerSummary) {
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: "F5",
      values: [[model.trainerSummary]],
    });
  }

  const sheetUrl = `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
  const viewOnlyWorkbookUrl = await createViewOnlyLink({ driveId, itemId, token });

  return { sheetUrl, viewOnlyWorkbookUrl };
}