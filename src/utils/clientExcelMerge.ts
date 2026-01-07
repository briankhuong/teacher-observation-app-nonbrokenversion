// src/utils/clientExcelMerge.ts
import ExcelJS from 'exceljs';

// =========================================================
// 🧹 HELPER 1: Remove "Ghost" Rows
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

// src/utils/clientExcelMerge.ts

function calculateAutoHeight(textA: string, textB: string, textC: string, minHeight = 45): number {
  // 🟢 FIX 1: Increase to 65. 
  // Since the Description column is wide, 35 was forcing it to calculate too many lines.
  const CHARS_PER_LINE = 65; 
  
  // 🟢 FIX 2: Decrease to 15.
  // 18pts was adding too much padding. 15pts is standard Excel height.
  const LINE_HEIGHT_PTS = 15; 
  
  const PADDING_PTS = 14;

  const countWrappedLines = (text: string) => {
    if (!text) return 0;
    const explicitLines = text.split('\n');
    
    return explicitLines.reduce((acc, line) => {
      const length = line.length;
      if (length === 0) return acc + 1; 
      // This will now calculate fewer lines for the same text
      return acc + Math.ceil(length / CHARS_PER_LINE);
    }, 0);
  };

  const linesA = countWrappedLines(textA);
  const linesB = countWrappedLines(textB);
  const linesC = countWrappedLines(textC);
  
  const maxLines = Math.max(linesA, linesB, linesC);

  if (maxLines === 0) return minHeight;

  const calculatedHeight = (maxLines * LINE_HEIGHT_PTS) + PADDING_PTS;
  
  return Math.max(calculatedHeight, minHeight);
}
// =========================================================
// 🎨 HELPER 2: Copy Conditional Formatting
// =========================================================
function copyConditionalFormatting(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet) {
  // @ts-ignore
  const cfs = source.conditionalFormattings; 
  if (!cfs || cfs.length === 0) return;

  cfs.forEach((cf: any) => {
    target.addConditionalFormatting({ ref: cf.ref, rules: cf.rules });
  });
}

// =========================================================
// 📋 HELPER 3: Duplicate Sheet
// =========================================================
function duplicateSheet(workbook: ExcelJS.Workbook, templateName: string, newName: string) {
  const source = workbook.getWorksheet(templateName);
  if (!source) throw new Error(`Template sheet "${templateName}" not found.`);

  const target = workbook.addWorksheet(newName);

  if (source.pageSetup) target.pageSetup = Object.assign({}, source.pageSetup);
  if (source.columns) {
    target.columns = source.columns.map(col => ({
      key: col.key, width: col.width, style: col.style, hidden: col.hidden
    }));
  }

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

  // @ts-ignore
  (source.model.merges || []).forEach((range: string) => target.mergeCells(range));
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

      if (resp.ok) {
        console.log("✅ Upload successful!");
        return; 
      }

      // ⚠️ LOCKED (423) or CONFLICT (409)
      if (resp.status === 423 || resp.status === 409) {
        console.warn(`⚠️ File Locked (423). Waiting to retry...`);
        if (attempt === MAX_RETRIES) throw new Error("File is strictly locked. Please close it in Excel Online and try again.");
        
        // Wait 2s, 4s, 6s...
        const delay = attempt * 2000; 
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; 
      }

      const txt = await resp.text();
      throw new Error(`Upload failed (${resp.status}): ${txt}`);

    } catch (err: any) {
      if (err.message.includes("strictly locked")) throw err;
      if (attempt === MAX_RETRIES) throw err;
    }
  }
}

// =========================================================
// 🔗 HELPER 5: Create/Get View Link (RESTORED)
// =========================================================
async function ensureViewLink(token: string, driveId: string, itemId: string) {
  try {
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      // "view" allows read-only. "organization" means anyone in your school/org.
      body: JSON.stringify({ type: "view", scope: "anonymous" })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.link?.webUrl || null;
  } catch (err) {
    console.warn("Could not create view link:", err);
    return null;
  }
}


// =========================================================
// 🚀 EXPORT 1: Teacher Merge Function
// =========================================================
export async function clientMergeTeacherSheet({ token, workbookUrl, sheetName, model }: any) {
  console.log("🚀 [Client] Starting Teacher Merge...");

  // 1. Resolve IDs
  const shareId = "u!" + btoa(workbookUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const itemResp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!itemResp.ok) throw new Error("Could not access Excel file.");
  const itemData = await itemResp.json();
  const driveId = itemData.parentReference?.driveId || itemData.remoteItem?.parentReference?.driveId;
  const itemId = itemData.id;
  if (!driveId) throw new Error("Drive ID not found.");

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

      // 🟢 NEW: Smart Height Adjustment
      // Get the existing height from the template (or default to 60 if missing)
      const currentHeight = row.height || 60;
      
     // 🟢 FIX: Pass r.description as the 3rd argument
      const neededHeight = calculateAutoHeight(
        r.strengths || "", 
        r.growths || "", 
        r.description || "", // <--- THIS IS THE FIX
        currentHeight
      );

      // Apply the larger of the two
      row.height = neededHeight;
    });
  }

  // 4. Upload (Wait & Retry)
  const newBuffer = await wb.xlsx.writeBuffer();
  await uploadBufferWithRetry(token, driveId, itemId, newBuffer);

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName
  };
}


// =========================================================
// 🚀 EXPORT 2: Admin Merge Function
// =========================================================
export async function clientMergeAdminSheet({ token, workbookUrl, sheetName, model }: any) {
  console.log("🚀 [Client] Starting Admin Merge...");

  // 1. Resolve IDs (omitted for brevity, assume helper functions are available)
  const shareId = "u!" + btoa(workbookUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const itemResp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!itemResp.ok) throw new Error("Could not access Excel file.");
  const itemData = await itemResp.json();
  const driveId = itemData.parentReference?.driveId || itemData.remoteItem?.parentReference?.driveId;
  const itemId = itemData.id;
  if (!driveId) throw new Error("Drive ID not found.");

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
  if (templateSheet) cleanWorksheet(templateSheet); // Assuming cleanWorksheet is defined

  let finalName = sheetName.replace(/[:\\\/\?\*\[\]]/g, " ").trim().slice(0, 31);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = `${sheetName.slice(0, 25)} (${counter++})`;
  }

  const ws = duplicateSheet(wb, "_ADMIN_TEMPLATE", finalName); // Assuming duplicateSheet is defined
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
    // Removed: if (i === 0 && r.trainerNotes) ws.getCell("E6").value = r.trainerNotes;
    // We now handle E6 placement separately below.
  });

  // -------------------------------------
  // 🔑 INSERT THE TRAINER SUMMARY (TRANSLATED TEXT) 🔑
  // -------------------------------------
  if (model.trainerSummary) {
    // The merged cell E6 is the starting point for the Trainer Notes/Summary column.
    const mergedSummaryCell = ws.getCell("E6");
    mergedSummaryCell.value = model.trainerSummary;
    mergedSummaryCell.alignment = {
        vertical: "top",
        horizontal: "left",
        wrapText: true,
    };
  }
  // -------------------------------------

  // 4. Upload (Wait & Retry) (Assuming uploadBufferWithRetry is defined)
  const newBuffer = await wb.xlsx.writeBuffer();
  await uploadBufferWithRetry(token, driveId, itemId, newBuffer);

  // 5. 🔗 NEW: Get View Link (Assuming ensureViewLink is defined)
  const viewUrl = await ensureViewLink(token, driveId, itemId);

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    viewUrl: viewUrl
  };
}