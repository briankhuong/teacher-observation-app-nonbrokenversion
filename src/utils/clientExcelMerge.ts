// src/utils/clientExcelMerge.ts
import ExcelJS from 'exceljs';

// =========================================================
// 🧹 HELPER 1: Remove "Ghost" Rows (Vital for performance)
// =========================================================
function cleanWorksheet(worksheet: ExcelJS.Worksheet) {
  let realLastRow = 1;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (row.hasValues) realLastRow = rowNumber;
  });
  
  // If there are more than 5 empty rows at the end, cut them off
  if (worksheet.rowCount > realLastRow + 5) {
    worksheet.spliceRows(realLastRow + 5, worksheet.rowCount - (realLastRow + 5));
  }
}

// =========================================================
// 📋 HELPER 2: Duplicate Sheet (Browser Version)
// =========================================================
  // 🎨 HELPER 3: Copy Conditional Formatting (Colors, Data Bars, etc.)
function copyConditionalFormatting(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet) {
  // @ts-ignore - accessing internal conditionalFormattings
  const cfs = source.conditionalFormattings; 
  if (!cfs || cfs.length === 0) return;

  cfs.forEach((cf: any) => {
    // We must copy the rules to the new sheet
    target.addConditionalFormatting({
      ref: cf.ref,
      rules: cf.rules,
    });
  });
}

function duplicateSheet(workbook: ExcelJS.Workbook, templateName: string, newName: string) {
  const source = workbook.getWorksheet(templateName);
  if (!source) throw new Error(`Template sheet "${templateName}" not found.`);

  const target = workbook.addWorksheet(newName);

  // Copy Columns
  if (source.columns) {
    target.columns = source.columns.map(col => ({
      key: col.key, width: col.width, style: col.style, hidden: col.hidden
    }));
  }

  // Copy Rows & Styles
  source.eachRow({ includeEmpty: true }, (sourceRow, rowNum) => {
    const targetRow = target.getRow(rowNum);
    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;

    sourceRow.eachCell({ includeEmpty: true }, (sourceCell, colNum) => {
      const targetCell = targetRow.getCell(colNum);
      targetCell.value = sourceCell.value;
      targetCell.style = sourceCell.style;
      if (sourceCell.dataValidation) targetCell.dataValidation = sourceCell.dataValidation;
    });
    targetRow.commit();
  });

  // Copy Merged Cells
  // @ts-ignore (Accessing internal model for merges is safe here)
  (source.model.merges || []).forEach((range: string) => target.mergeCells(range));

  return target;
}

// =========================================================
// 🚀 EXPORT 1: Teacher Merge Function
// =========================================================
export async function clientMergeTeacherSheet({
  token,
  workbookUrl,
  sheetName,
  model
}: {
  token: string;
  workbookUrl: string;
  sheetName: string;
  model: any;
}) {
  console.log("🚀 [Client] Starting Teacher Merge on Device...");

  // 1. Get Drive & Item ID from the URL
  const shareId = "u!" + btoa(workbookUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const itemResp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!itemResp.ok) throw new Error("Could not access Excel file. Check permissions.");
  const itemData = await itemResp.json();
 // 🐛 FIX: Robustly find the Drive ID (Handle shared items vs direct items)
  const driveId = itemData.parentReference?.driveId || itemData.remoteItem?.parentReference?.driveId;
  const itemId = itemData.id;

  if (!driveId) {
    console.error("❌ Graph API Error: Drive ID missing", itemData);
    throw new Error("Could not find Drive ID. The file might be a shortcut or you lack permission.");
  }

  // 2. Download File (Directly to Browser RAM)
  const downloadResp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!downloadResp.ok) throw new Error("Failed to download workbook.");
  
  const fileArrayBuffer = await downloadResp.arrayBuffer(); 

  // 3. Load & Process with ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileArrayBuffer);

  // Clean Template
  const templateSheet = wb.getWorksheet("_TEMPLATE");
  if (templateSheet) cleanWorksheet(templateSheet);

  // Determine Unique Sheet Name
  let finalName = sheetName.replace(/[:\\\/\?\*\[\]]/g, " ").trim().slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = `${sheetName.slice(0, 25)} (${counter++})`;
  }


  // Duplicate & Fill
  const ws = duplicateSheet(wb, "_TEMPLATE", finalName);
  ws.state = "visible"; // Make it the active tab

  // Fill Header
  if (model.headerBlock) ws.getCell("A1").value = model.headerBlock;

  // Fill Rows
  if (Array.isArray(model.rows)) {
    model.rows.forEach((r: any) => {
      const rowIndex = Number(r.rowIndex);
      if (!rowIndex || rowIndex < 4) return;
      const row = ws.getRow(rowIndex);
      if (r.indicatorLabel) row.getCell("B").value = r.indicatorLabel;
      if (r.description) row.getCell("C").value = r.description;
      if (r.checklist) row.getCell("D").value = r.checklist;
      if (r.strengths) row.getCell("E").value = r.strengths;
      if (r.growths) row.getCell("F").value = r.growths;
    });
  }

  // 4. Write to Buffer
  const newBuffer = await wb.xlsx.writeBuffer();

  // 5. Upload Back to Graph (PUT)
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    body: newBuffer
  });

  if (!uploadResp.ok) {
     if (uploadResp.status === 423) throw new Error("File is LOCKED. Close it in Excel and try again.");
     throw new Error("Failed to upload new version.");
  }

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName
  };
}

// =========================================================
// 🚀 EXPORT 2: Admin Merge Function
// =========================================================
export async function clientMergeAdminSheet({
  token,
  workbookUrl,
  sheetName,
  model
}: {
  token: string;
  workbookUrl: string;
  sheetName: string;
  model: any;
}) {
  console.log("🚀 [Client] Starting Admin Merge on Device...");

  // 1. Get Drive & Item ID
  const shareId = "u!" + btoa(workbookUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const itemResp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!itemResp.ok) throw new Error("Could not access Excel file. Check permissions.");
  const itemData = await itemResp.json();
 // 🐛 FIX: Robustly find the Drive ID
  const driveId = itemData.parentReference?.driveId || itemData.remoteItem?.parentReference?.driveId;
  const itemId = itemData.id;

  if (!driveId) {
    console.error("❌ Graph API Error: Drive ID missing", itemData);
    throw new Error("Could not find Drive ID. The file might be a shortcut or you lack permission.");
  }

  // 2. Download File
  const downloadResp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!downloadResp.ok) throw new Error("Failed to download workbook.");
  const fileArrayBuffer = await downloadResp.arrayBuffer();

  // 3. Load & Process with ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileArrayBuffer);

  // Clean Template
  const templateSheet = wb.getWorksheet("_ADMIN_TEMPLATE");
  if (templateSheet) cleanWorksheet(templateSheet);

  // Unique Sheet Name
  let finalName = sheetName.replace(/[:\\\/\?\*\[\]]/g, " ").trim().slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = `${sheetName.slice(0, 25)} (${counter++})`;
  }

  // Duplicate
  const ws = duplicateSheet(wb, "_ADMIN_TEMPLATE", finalName);
  ws.state = "visible";

  // 4. Fill Data (Admin Specific Logic)
  if (model.headerLeft) ws.getCell("A1").value = model.headerLeft;
  if (model.headerRight) ws.getCell("D1").value = model.headerRight;
  if (model.teacherName) ws.getCell("D4").value = `GV: ${model.teacherName}`;

  const dataRows = Array.isArray(model.rows) ? model.rows : [];
  dataRows.forEach((r: any, i: number) => {
    if (i >= 14) return; // Limit to 14 rows as per template
    const rowIndex = 6 + i;
    if (r.mainCategory) ws.getCell(`A${rowIndex}`).value = r.mainCategory;
    if (r.aspect) ws.getCell(`B${rowIndex}`).value = r.aspect;
    if (r.classroomSigns) ws.getCell(`C${rowIndex}`).value = r.classroomSigns;
    if (r.trainerRating) ws.getCell(`D${rowIndex}`).value = r.trainerRating;
    // Trainer notes only go in the first row's merged cell (usually)
    if (i === 0 && r.trainerNotes) ws.getCell("E6").value = r.trainerNotes;
  });

  // 5. Upload Back
  const newBuffer = await wb.xlsx.writeBuffer();
  
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    body: newBuffer
  });

  if (!uploadResp.ok) {
     if (uploadResp.status === 423) throw new Error("File is LOCKED. Close it in Excel and try again.");
     throw new Error("Failed to upload new version.");
  }

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName
  };
}