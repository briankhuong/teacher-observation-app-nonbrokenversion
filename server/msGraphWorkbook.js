// server/msGraphWorkbook.js

// If you're on Node 18+, global fetch exists.
// If not, uncomment:
// import fetch from "node-fetch";

/**
 * IMPORTANT:
 * Replace this with YOUR real token getter (MSAL OBO, client credentials, etc.)
 */
// server/msGraphWorkbook.js

import dotenv from "dotenv";
dotenv.config({ path: ".env.azure" }); // safe even if already loaded in index.js

async function getGraphAccessToken() {
  // ✅ Use the env names you ACTUALLY have in .env.azure
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing MS_TENANT_ID, MS_CLIENT_ID, or MS_CLIENT_SECRET");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("grant_type", "client_credentials");
  // ✅ v2 endpoint uses scope
  params.set("scope", "https://graph.microsoft.com/.default");

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error_description || json?.error || JSON.stringify(json);
    throw new Error(`Token request failed: ${msg}`);
  }

  return json.access_token;
}

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

  // Create
  const created = await graphJson(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/add`,
    { token, method: "POST", body: { name: sheetName } }
  );

  // Response shape can be { worksheet: {...} } depending on Graph
  return created?.worksheet || created;
}

async function writeRangeValues({ driveId, itemId, token, sheetName, address, values }) {
  // address example: "A1:C2" or "A1"
  // values must be a 2D array
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

// ------------------------------------------------------------
// TEACHER MERGE (REAL WRITES)
// ------------------------------------------------------------

/**
 * You will likely adjust the mapping to match your TeacherTemplate.
 * This writes minimal “proof it works” fields first.
 */
export async function mergeTeacherSheet({ workbookUrl, sheetName, model }) {
  // ✅ Step 0: token
  const token = await getGraphAccessToken();
  console.log("[Graph] got token:", token ? "YES" : "NO");

  try {
    // ✅ Step 1: resolve drive + item from sharing URL
    console.log("[Graph] resolveWorkbookFromSharingUrl...");
    const { driveId, itemId } = await resolveWorkbookFromSharingUrl(
      workbookUrl,
      token
    );
    console.log("[Graph] resolved:", { driveId, itemId });

    // ✅ Step 2: ensure worksheet exists
    console.log("[Graph] ensureWorksheet...", sheetName);
    await ensureWorksheet({ driveId, itemId, token, sheetName });
    console.log("[Graph] worksheet ok");

    // ✅ Step 3: minimal proof writes (same as your existing code, but with logs)
    console.log("[Graph] write A1...");
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: "A1",
      values: [[model?.headerTitle || "Teacher Observation"]],
    });

    console.log("[Graph] write A2...");
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: "A2",
      values: [[`Teacher: ${model?.teacherName || ""}`]],
    });

    console.log("[Graph] write A3...");
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: "A3",
      values: [[`School: ${model?.schoolName || ""}`]],
    });

    console.log("[Graph] write A4...");
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: "A4",
      values: [[`Date: ${model?.date || ""}`]],
    });

    // ✅ Step 4: optional rows write (with logs)
    if (Array.isArray(model?.rows) && model.rows.length > 0) {
      const startRow = 6; // adjust to match template
      const values = model.rows.map((r) => [
        r.number ?? "",
        r.aspect ?? "",
        r.good ? "Good" : "",
        r.growth ? "Growth" : "",
        r.commentText ?? "",
      ]);

      const endRow = startRow + values.length - 1;

      console.log("[Graph] write rows...", { startRow, endRow, count: values.length });
      await writeRangeValues({
        driveId,
        itemId,
        token,
        sheetName,
        address: `A${startRow}:E${endRow}`,
        values,
      });
    } else {
      console.log("[Graph] no rows to write");
    }

    // ✅ Step 5: return sheet URL as before
    const sheetUrl = `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
    console.log("[Graph] mergeTeacherSheet done:", sheetUrl);
    return sheetUrl;
  } catch (err) {
    // ✅ This makes the server terminal show the REAL reason + where it failed
    console.error("[Graph] mergeTeacherSheet FAILED:", err);
    throw err;
  }
}

// ------------------------------------------------------------
// ADMIN MERGE (REAL WRITES)
// ------------------------------------------------------------

/**
 * Admin model is known:
 *  - headerLeft (multi-line)
 *  - headerRight (multi-line)
 *  - rows[] (14 items)
 *  - trainerSummary
 *
 * IMPORTANT: cell mapping depends on your Admin template.
 * I set a SAFE DEFAULT:
 *  - headerLeft -> A1
 *  - headerRight -> D1
 *  - rows -> A5:E18
 *  - trainerSummary -> F5:F18  (so it won't overwrite trainerNotes)
 *
 * If your template truly wants summary in E5–E18, change TRAINER_SUMMARY_RANGE.
 */
export async function mergeAdminSheet({ workbookUrl, sheetName, model }) {
  const token = await getGraphAccessToken();
  const { driveId, itemId } = await resolveWorkbookFromSharingUrl(workbookUrl, token);

  await ensureWorksheet({ driveId, itemId, token, sheetName });

  // Header blocks (adjust to template)
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

  // Rows table
  const TABLE_START_ROW = 5; // rowIndex 1 maps to row 5
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

  // Trainer summary
  const TRAINER_SUMMARY_RANGE = "F5:F18"; // change to "E5:E18" ONLY if it matches your template & you don't need trainerNotes column
  if (model?.trainerSummary) {
    // Put summary into top cell; Excel merge/formatting can be handled by template
    await writeRangeValues({
      driveId,
      itemId,
      token,
      sheetName,
      address: TRAINER_SUMMARY_RANGE,
      values: [[model.trainerSummary]],
    });
  }

  const sheetUrl = `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
  return sheetUrl;
}