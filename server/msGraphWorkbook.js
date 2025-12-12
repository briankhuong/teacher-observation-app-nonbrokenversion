// server/msGraphWorkbook.js

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
    // Bubble the real Graph message
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

  return created?.worksheet || created;
}

async function writeRangeValues({ driveId, itemId, token, sheetName, address, values }) {
  return await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}` +
      `/workbook/worksheets/${encodeURIComponent(sheetName)}` +
      `/range(address='${address}')`,
    {
      token,
      method: "PATCH",
      body: { values },
    }
  );
}

async function createViewOnlyWorkbookLink({ driveId, itemId, token }) {
  // Safer default: organization-scoped view link (not public)
  // If you truly need anonymous links, switch scope to "anonymous".
  const body = { type: "view", scope: "organization" };

  const result = await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`,
    { token, method: "POST", body }
  );

  const webUrl = result?.link?.webUrl;
  if (!webUrl) return null;
  return webUrl;
}

// ------------------------------------------------------------
// TEACHER MERGE (REAL WRITES with delegated token)
// ------------------------------------------------------------
export async function mergeTeacherSheet({ token, workbookUrl, sheetName, model }) {
  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);
  await ensureWorksheet({ driveId, itemId, token, sheetName });

  // ✅ Proof writes — change these addresses to match your template mapping
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

  // Optional table write
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

  return `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
}

// ------------------------------------------------------------
// ADMIN MERGE (REAL WRITES + view-only workbook link)
// ------------------------------------------------------------
export async function mergeAdminSheet({ token, workbookUrl, sheetName, model }) {
  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);
  await ensureWorksheet({ driveId, itemId, token, sheetName });

  // Headers (adjust to your admin template mapping)
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

  // Table rows: A5:E18 default mapping
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

  // Trainer summary (put into F5 by default; you can remap later)
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

  const viewOnlyWorkbookUrl = await createViewOnlyWorkbookLink({ driveId, itemId, token });
  const sheetUrl = `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;

  return { sheetUrl, viewOnlyWorkbookUrl };
}