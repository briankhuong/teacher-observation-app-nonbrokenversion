// server/msGraphWorkbook.js
import ExcelJS from "exceljs";
// Uncomment the next line if you are on Node < 18 and installed node-fetch
// import fetch from "node-fetch"; 

// ------------------------------
// HELPERS
// ------------------------------
function toBase64Url(str) {
  return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function shareIdFromUrl(url) {
  return `u!${toBase64Url(url)}`;
}
function excelSafeSheetName(input) {
  const cleaned = String(input || "").replace(/[:\\\/\?\*\[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned.length > 0 ? cleaned : "Sheet").slice(0, 31);
}

// ------------------------------
// GRAPH API (Download / Upload Only)
// ------------------------------
async function getDriveItemInfo(workbookUrl, token) {
  const shareId = shareIdFromUrl(workbookUrl);
  // Resolve the sharing URL to a real File ID
  const resp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to resolve workbook URL: ${resp.status} ${text}`);
  }
  
  const json = await resp.json();
  return { driveId: json.parentReference.driveId, itemId: json.id };
}

async function downloadWorkbook(driveId, itemId, token) {
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Download failed: ${resp.statusText}`);
  return await resp.arrayBuffer();
}

// server/msGraphWorkbook.js

// ... keep imports and other helpers ...

// In server/msGraphWorkbook.js

async function uploadWorkbook(driveId, itemId, token, buffer) {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;

  // Try 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(url, {
      method: "PUT",
      headers: { 
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: Buffer.from(buffer)
    });

    if (resp.ok) {
      console.log("[Upload] Success!");
      return; 
    }

    // 423 = Locked, 409 = Conflict
    if (resp.status === 423 || resp.status === 409 || resp.status === 503) {
      console.warn(`[Upload] File locked. Attempt ${attempt}/3. Waiting 3s...`);
      await new Promise(r => setTimeout(r, 3000)); // Wait 3 seconds
      continue;
    }

    // Fatal error
    const text = await resp.text();
    throw new Error(`Upload failed: ${resp.statusText} (${resp.status})`);
  }

  // If we get here, it failed 3 times
  throw new Error("LOCKED: The file is open. Please close Excel Online and try again.");
}

// ... keep the rest of the file (duplicateSheet, mergeTeacherSheet, etc.) ...

// ------------------------------
// EXCELJS HELPER: The "Perfect Clone"
// ------------------------------
// ------------------------------
// NEW HELPER: Copy Conditional Formatting
// ------------------------------
function copyConditionalFormatting(sourceSheet, targetSheet) {
  // ExcelJS exposes conditional formatting via `sheet.conditionalFormattings`
  // We need to read them from Source and apply them to Target.
  
  // Safety check: ensure the source has rules to copy
  if (!sourceSheet.conditionalFormattings) return;

  sourceSheet.conditionalFormattings.forEach((cf) => {
    // The 'ref' is the range (e.g., "D4:D200"). 
    // Since our new sheet has the exact same layout, we can just re-use the rule.
    targetSheet.addConditionalFormatting({
      ref: cf.ref,
      rules: cf.rules,
    });
  });
}

// ------------------------------
// EXCELJS HELPER: The "Perfect Clone"
// ------------------------------
function duplicateSheet(workbook, templateName, newName) {
  const source = workbook.getWorksheet(templateName);
  if (!source) throw new Error(`Template sheet "${templateName}" not found in this workbook.`);

  // Create the new sheet
  const target = workbook.addWorksheet(newName);

  // 1. Copy Column Configuration (Widths, Hidden, Styles)
  if (source.columns) {
    target.columns = source.columns.map(col => ({
      key: col.key, 
      width: col.width,
      style: col.style,
      hidden: col.hidden
    }));
  }

  // 2. Copy Rows (Height, Values, Styles, Merges)
  source.eachRow((sourceRow, rowNum) => {
    const targetRow = target.getRow(rowNum);
    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;

    sourceRow.eachCell({ includeEmpty: true }, (sourceCell, colNum) => {
      const targetCell = targetRow.getCell(colNum);
      targetCell.value = sourceCell.value;
      targetCell.style = sourceCell.style; // Crucial: Copies fonts, fills, borders, alignment
      
      // Copy Data Validation (Dropdowns)
      if (sourceCell.dataValidation) {
        targetCell.dataValidation = sourceCell.dataValidation;
      }
    });
    targetRow.commit();
  });

  // 3. Copy Merged Cells (Crucial for Admin layout)
  const merges = source.model.merges || [];
  merges.forEach(range => {
    target.mergeCells(range);
  });
  
  // 4. Page Setup (Margins, Print settings)
  if (source.pageSetup) target.pageSetup = source.pageSetup;

  // ✅ 5. NEW: Copy Conditional Formatting
  copyConditionalFormatting(source, target);

  return target;
}

// ======================================================
// TEACHER MERGE
// ======================================================
export async function mergeTeacherSheet({ workbookUrl, sheetName, model, token }) {
  if (!model) throw new Error("Missing model.");

  // 1. Download
  console.log("[MergeTeacher] Resolving and downloading workbook...");
  const { driveId, itemId } = await getDriveItemInfo(workbookUrl, token);
  const fileBuffer = await downloadWorkbook(driveId, itemId, token);

  // 2. Load into ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuffer);

  // 3. Determine New Name
  let finalName = excelSafeSheetName(sheetName);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = excelSafeSheetName(`${sheetName} (${counter++})`);
  }

  // 4. Clone Template
  console.log(`[MergeTeacher] Cloning "_TEMPLATE" to "${finalName}"...`);
  const ws = duplicateSheet(wb, "_TEMPLATE", finalName);
  ws.state = "visible"; // Ensure new sheet is visible

  // 5. Fill Data
  if (model.headerBlock) ws.getCell("A1").value = model.headerBlock;

  if (Array.isArray(model.rows)) {
    model.rows.forEach(r => {
      const rowIndex = Number(r.rowIndex);
      // Valid rows start at 4 in your template
      if (!rowIndex || rowIndex < 4) return; 
      
      const row = ws.getRow(rowIndex);
      if (r.indicatorLabel) row.getCell("B").value = r.indicatorLabel;
      if (r.description) row.getCell("C").value = r.description;
      if (r.checklist) row.getCell("D").value = r.checklist;
      if (r.strengths) row.getCell("E").value = r.strengths;
      if (r.growths) row.getCell("F").value = r.growths;
    });
  }

  // 6. Upload
  console.log("[MergeTeacher] Uploading updated workbook...");
  const newBuffer = await wb.xlsx.writeBuffer();
  await uploadWorkbook(driveId, itemId, token, newBuffer);

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    usedCopy: true,
    formattingWarning: null
  };
}

// ======================================================
// ADMIN MERGE
// ======================================================
// ======================================================
// ADMIN MERGE
// ======================================================
export async function mergeAdminSheet({ workbookUrl, sheetName, model, token }) {
  if (!model) throw new Error("Missing model (admin export model).");

  // 1. Download Workbook
  console.log("[MergeAdmin] Resolving and downloading workbook...");
  const { driveId, itemId } = await getDriveItemInfo(workbookUrl, token);
  const fileBuffer = await downloadWorkbook(driveId, itemId, token);

  // 2. Load into ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuffer);

  // 3. Determine Unique Name
  let finalName = excelSafeSheetName(sheetName);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = excelSafeSheetName(`${sheetName} (${counter++})`);
  }

  // 4. Clone Template
  // Uses our updated duplicateSheet (which copies merges + conditional formatting)
  console.log(`[MergeAdmin] Cloning "_ADMIN_TEMPLATE" to "${finalName}"...`);
  const ws = duplicateSheet(wb, "_ADMIN_TEMPLATE", finalName);
  ws.state = "visible";

  // 5. Fill Data
  // Headers
  if (model.headerLeft) ws.getCell("A1").value = model.headerLeft;
  if (model.headerRight) ws.getCell("D1").value = model.headerRight;
  if (model.teacherName) ws.getCell("D4").value = `GV: ${model.teacherName}`;

  // Table Body (Rows 6-19)
  const dataRows = Array.isArray(model.rows) ? model.rows : [];
  
  dataRows.forEach((r, i) => {
    // The standard admin template has space for about 14 rows (Row 6 to 19).
    if (i >= 14) return; 
    
    const rowIndex = 6 + i;
    
    // Column A (Main Category): 
    // Even if A6:A9 are merged, writing to A6 updates the whole merged block text.
    if (r.mainCategory) ws.getCell(`A${rowIndex}`).value = r.mainCategory;
    
    // Columns B, C, D
    if (r.aspect) ws.getCell(`B${rowIndex}`).value = r.aspect;
    if (r.classroomSigns) ws.getCell(`C${rowIndex}`).value = r.classroomSigns;
    if (r.trainerRating) ws.getCell(`D${rowIndex}`).value = r.trainerRating;

    // Column E (Trainer Notes): 
    // Your template has ONE big merged cell E6:E19.
    // We only need to write to the top-left cell (E6) ONCE.
    if (i === 0 && r.trainerNotes) {
      ws.getCell("E6").value = r.trainerNotes;
    }
  });

  // 6. Upload
  console.log("[MergeAdmin] Uploading updated workbook...");
  const newBuffer = await wb.xlsx.writeBuffer();
  await uploadWorkbook(driveId, itemId, token, newBuffer);

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    usedCopy: true,
    viewOnlyWorkbookUrl: null, 
  };
}