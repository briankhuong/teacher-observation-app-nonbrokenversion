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
  
  if (worksheet.rowCount > realLastRow + 5) {
    worksheet.spliceRows(realLastRow + 5, worksheet.rowCount - (realLastRow + 5));
  }
}

// =========================================================
// 🎨 HELPER 2: Copy Conditional Formatting (Colors, Data Bars)
// =========================================================
function copyConditionalFormatting(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet) {
  // @ts-ignore - accessing internal conditionalFormattings
  const cfs = source.conditionalFormattings; 
  if (!cfs || cfs.length === 0) return;

  cfs.forEach((cf: any) => {
    target.addConditionalFormatting({
      ref: cf.ref,
      rules: cf.rules,
    });
  });
}

// =========================================================
// 📋 HELPER 3: Duplicate Sheet (Browser Version)
// =========================================================
function duplicateSheet(workbook: ExcelJS.Workbook, templateName: string, newName: string) {
  const source = workbook.getWorksheet(templateName);
  if (!source) throw new Error(`Template sheet "${templateName}" not found.`);

  const target = workbook.addWorksheet(newName);

  // Copy Page Setup
  if (source.pageSetup) target.pageSetup = Object.assign({}, source.pageSetup);

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
  // @ts-ignore
  (source.model.merges || []).forEach((range: string) => target.mergeCells(range));

  // ✅ Apply Conditional Formatting
  copyConditionalFormatting(source, target);

  return target;
}

// =========================================================
// ⏳ HELPER 4: Smart Upload with "Wait & Retry" Logic
// =========================================================
async function uploadBufferWithRetry(
  token: string,
  driveId: string,
  itemId: string,
  buffer: ExcelJS.Buffer
) {
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Upload] Attempt ${attempt}/${MAX_RETRIES}...`);
      
      const resp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        },
        body: buffer
      });

      // ✅ Success
      if (resp.ok) {
        console.log("✅ Upload successful!");
        return; 
      }

      // ⚠️ LOCKED (423) or CONFLICT (409)
      if (resp.status === 423 || resp.status === 409) {
        console.warn(`⚠️ File Locked (423). Waiting to retry...`);
        
        if (attempt === MAX_RETRIES) {
            throw new Error("File is strictly locked. Please close it in Excel Online and try again.");
        }

        // ⏳ Wait: 2s, then 4s, then 6s
        const delay = attempt * 2000; 
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // Retry loop
      }

      // Other errors -> Fail immediately
      const txt = await resp.text();
      throw new Error(`Upload failed (${resp.status}): ${txt}`);

    } catch (err: any) {
      if (err.message.includes("strictly locked")) throw err;
      if (attempt === MAX_RETRIES) throw err;
    }
  }
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

  // 1. Get Drive & Item ID
  const shareId = "u!" + btoa(workbookUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const itemResp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!itemResp.ok) throw new Error("Could not access Excel file. Check permissions.");
  const itemData = await itemResp.json();
  
  // Robust ID Logic
  const driveId = itemData.parentReference?.driveId || itemData.remoteItem?.parentReference?.driveId;
  const itemId = itemData.id;

  if (!driveId) throw new Error("Could not find Drive ID.");

  // 2. Download
  const downloadResp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!downloadResp.ok) throw new Error("Failed to download workbook.");
  const fileArrayBuffer = await downloadResp.arrayBuffer(); 

  // 3. Process
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileArrayBuffer);

  const templateSheet = wb.getWorksheet("_TEMPLATE");
  if (templateSheet) cleanWorksheet(templateSheet);

  let finalName = sheetName.replace(/[:\\\/\?\*\[\]]/g, " ").trim().slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = `${sheetName.slice(0, 25)} (${counter++})`;
  }

  const ws = duplicateSheet(wb, "_TEMPLATE", finalName);
  ws.state = "visible";

  if (model.headerBlock) ws.getCell("A1").value = model.headerBlock;
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

  // 5. 🟢 Upload with Retry Logic
  await uploadBufferWithRetry(token, driveId, itemId, newBuffer);

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

  // 1. Get IDs
  const shareId = "u!" + btoa(workbookUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const itemResp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!itemResp.ok) throw new Error("Could not access Excel file.");
  const itemData = await itemResp.json();
  
  const driveId = itemData.parentReference?.driveId || itemData.remoteItem?.parentReference?.driveId;
  const itemId = itemData.id;

  if (!driveId) throw new Error("Could not find Drive ID.");

  // 2. Download
  const downloadResp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!downloadResp.ok) throw new Error("Failed to download workbook.");
  const fileArrayBuffer = await downloadResp.arrayBuffer();

  // 3. Process
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileArrayBuffer);

  const templateSheet = wb.getWorksheet("_ADMIN_TEMPLATE");
  if (templateSheet) cleanWorksheet(templateSheet);

  let finalName = sheetName.replace(/[:\\\/\?\*\[\]]/g, " ").trim().slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = `${sheetName.slice(0, 25)} (${counter++})`;
  }

  const ws = duplicateSheet(wb, "_ADMIN_TEMPLATE", finalName);
  ws.state = "visible";

  if (model.headerLeft) ws.getCell("A1").value = model.headerLeft;
  if (model.headerRight) ws.getCell("D1").value = model.headerRight;
  if (model.teacherName) ws.getCell("D4").value = `GV: ${model.teacherName}`;

  const dataRows = Array.isArray(model.rows) ? model.rows : [];
  dataRows.forEach((r: any, i: number) => {
    if (i >= 14) return;
    const rowIndex = 6 + i;
    if (r.mainCategory) ws.getCell(`A${rowIndex}`).value = r.mainCategory;
    if (r.aspect) ws.getCell(`B${rowIndex}`).value = r.aspect;
    if (r.classroomSigns) ws.getCell(`C${rowIndex}`).value = r.classroomSigns;
    if (r.trainerRating) ws.getCell(`D${rowIndex}`).value = r.trainerRating;
    if (i === 0 && r.trainerNotes) ws.getCell("E6").value = r.trainerNotes;
  });

  // 4. Write
  const newBuffer = await wb.xlsx.writeBuffer();
  
  // 5. 🟢 Upload with Retry Logic
  await uploadBufferWithRetry(token, driveId, itemId, newBuffer);

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName
  };
}