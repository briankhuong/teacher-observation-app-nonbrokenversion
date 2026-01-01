// server/msGraphWorkbook.js
import ExcelJS from "exceljs";
import fetch from "node-fetch"; 

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
// GRAPH API CORE
// ------------------------------
async function getDriveItemInfo(workbookUrl, token) {
  const shareId = shareIdFromUrl(workbookUrl);
  const resp = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to resolve workbook URL: ${resp.status} ${text}`);
  }
  
  const json = await resp.json();
  return { driveId: json.parentReference.driveId, itemId: json.id, name: json.name };
}

async function downloadWorkbook(driveId, itemId, token) {
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Download failed: ${resp.statusText}`);
  return await resp.arrayBuffer();
}

export async function createViewOnlyLink(driveId, itemId, token) {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`;
  
  const tryScope = async (scope) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type: "view", scope: scope }) 
    });
    if (resp.ok) return await resp.json();
    return null;
  };

  try {
    let result = await tryScope("anonymous");
    if (!result) result = await tryScope("organization");
    if (result) return result.link.webUrl;
    return null;
  } catch (err) {
    console.error("[Graph] Link creation error:", err);
    return null;
  }
}

async function uploadWorkbook(driveId, itemId, token, buffer, originalName) {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;

  // Attempt 1: Overwrite
  const resp = await fetch(url, {
    method: "PUT",
    headers: { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    body: Buffer.from(buffer)
  });

  if (resp.ok) {
    console.log("[Upload] Overwrite success!");
    const data = await resp.json(); 
    return { name: data.name, id: data.id };
  }

  // Handle Locked File (Save Copy)
  if (resp.status === 423 || resp.status === 409 || resp.status === 503) {
    console.warn(`[Upload] File locked (${resp.status}). Saving as COPY...`);
    const time = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const newName = originalName.replace(".xlsx", `_conflict_${time}.xlsx`);
    
    const parentUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/parent/children/${newName}/content`;
    const copyResp = await fetch(parentUrl, {
      method: "PUT",
      headers: { 
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: Buffer.from(buffer)
    });

    if (!copyResp.ok) throw new Error(`Locked & Failed copy: ${copyResp.statusText}`);
    
    const copyData = await copyResp.json();
    console.log(`[Upload] Saved as copy: ${newName}`);
    return { name: copyData.name, id: copyData.id, warning: "File was locked. Saved as new copy." };
  }

  throw new Error(`Upload failed: ${resp.statusText}`);
}

// ------------------------------
// EXCELJS LOGIC
// ------------------------------
function cleanWorksheet(worksheet) {
  let realLastRow = 1;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (row.hasValues) {
      realLastRow = rowNumber;
    }
  });
  const rowCount = worksheet.rowCount;
  if (rowCount > realLastRow + 5) {
    const rowsToDelete = rowCount - (realLastRow + 5);
    worksheet.spliceRows(realLastRow + 5, rowsToDelete);
  }
}

function copyConditionalFormatting(sourceSheet, targetSheet) {
  if (!sourceSheet.conditionalFormattings) return;
  sourceSheet.conditionalFormattings.forEach((cf) => {
    targetSheet.addConditionalFormatting({ ref: cf.ref, rules: cf.rules });
  });
}

function duplicateSheet(workbook, templateName, newName) {
  const source = workbook.getWorksheet(templateName);
  if (!source) throw new Error(`Template sheet "${templateName}" not found.`);

  const target = workbook.addWorksheet(newName);
  if (source.columns) {
    target.columns = source.columns.map(col => ({
      key: col.key, width: col.width, style: col.style, hidden: col.hidden
    }));
  }
  source.eachRow((sourceRow, rowNum) => {
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
  (source.model.merges || []).forEach(range => target.mergeCells(range));
  if (source.pageSetup) target.pageSetup = source.pageSetup;
  copyConditionalFormatting(source, target);
  return target;
}

// ======================================================
// TEACHER MERGE
// ======================================================
export async function mergeTeacherSheet({ workbookUrl, sheetName, model, token }) {
  if (!model) throw new Error("Missing model.");

  const { driveId, itemId, name: fileName } = await getDriveItemInfo(workbookUrl, token);
  const fileBuffer = await downloadWorkbook(driveId, itemId, token);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuffer);

  const templateSheet = wb.getWorksheet("_TEMPLATE");
  if (templateSheet) cleanWorksheet(templateSheet);

  let finalName = excelSafeSheetName(sheetName);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = excelSafeSheetName(`${sheetName} (${counter++})`);
  }

  const ws = duplicateSheet(wb, "_TEMPLATE", finalName);
  ws.state = "visible";

  if (model.headerBlock) ws.getCell("A1").value = model.headerBlock;
  if (Array.isArray(model.rows)) {
    model.rows.forEach(r => {
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

  const newBuffer = await wb.xlsx.writeBuffer();
  const uploadResult = await uploadWorkbook(driveId, itemId, token, newBuffer, fileName);

  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    usedCopy: true,
    formattingWarning: uploadResult.warning || null
  };
}

// ======================================================
// ADMIN MERGE
// ======================================================
export async function mergeAdminSheet({ workbookUrl, sheetName, model, token }) {
  if (!model) throw new Error("Missing model.");

  const { driveId, itemId, name: fileName } = await getDriveItemInfo(workbookUrl, token);
  const fileBuffer = await downloadWorkbook(driveId, itemId, token);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuffer);

  const adminTemplate = wb.getWorksheet("_ADMIN_TEMPLATE");
  if (adminTemplate) cleanWorksheet(adminTemplate);

  let finalName = excelSafeSheetName(sheetName);
  let counter = 2;
  while (wb.getWorksheet(finalName)) {
    finalName = excelSafeSheetName(`${sheetName} (${counter++})`);
  }

  const ws = duplicateSheet(wb, "_ADMIN_TEMPLATE", finalName);
  ws.state = "visible";

  if (model.headerLeft) ws.getCell("A1").value = model.headerLeft;
  if (model.headerRight) ws.getCell("D1").value = model.headerRight;
  if (model.teacherName) ws.getCell("D4").value = `GV: ${model.teacherName}`;

  const dataRows = Array.isArray(model.rows) ? model.rows : [];
  dataRows.forEach((r, i) => {
    if (i >= 14) return; 
    const rowIndex = 6 + i;
    if (r.mainCategory) ws.getCell(`A${rowIndex}`).value = r.mainCategory;
    if (r.aspect) ws.getCell(`B${rowIndex}`).value = r.aspect;
    if (r.classroomSigns) ws.getCell(`C${rowIndex}`).value = r.classroomSigns;
    if (r.trainerRating) ws.getCell(`D${rowIndex}`).value = r.trainerRating;
    if (i === 0 && r.trainerNotes) ws.getCell("E6").value = r.trainerNotes;
  });

  const newBuffer = await wb.xlsx.writeBuffer();
  const uploadResult = await uploadWorkbook(driveId, itemId, token, newBuffer, fileName);
  
  return {
    sheetUrl: `${workbookUrl}#sheet=${encodeURIComponent(finalName)}`,
    sheetName: finalName,
    usedCopy: true,
    driveId: driveId,
    itemId: uploadResult.id,
    formattingWarning: uploadResult.warning || null
  };
}

// ========================================================
// ⚡ PROVISIONING FUNCTIONS (Required for "Auto-create")
// ========================================================

export async function ensureFolderExists(driveId, parentId, folderName, token) {
  // 1. Check if it already exists
  const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}/children?filter=name eq '${encodeURIComponent(folderName)}'`;
  const checkResp = await fetch(childrenUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (checkResp.ok) {
    const data = await checkResp.json();
    if (data.value && data.value.length > 0) {
      return data.value[0].id; // Found it!
    }
  }

  // 2. If not, create it
  const createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}/children`;
  const createResp = await fetch(createUrl, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: folderName,
      folder: {}, 
      "@microsoft.graph.conflictBehavior": "rename"
    })
  });

  if (!createResp.ok) {
    const txt = await createResp.text();
    throw new Error(`Failed to create folder: ${txt}`);
  }

  const created = await createResp.json();
  return created.id;
}

export async function copyFile(driveId, itemId, targetDriveId, targetParentId, newName, token) {
  const copyUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/copy`;
  
  const payload = {
    parentReference: {
      driveId: targetDriveId,
      id: targetParentId
    },
    name: newName
  };

  const resp = await fetch(copyUrl, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (resp.status !== 202) {
    const txt = await resp.text();
    throw new Error(`Copy failed (Status ${resp.status}): ${txt}`);
  }

  const monitorUrl = resp.headers.get("Location");
  if (!monitorUrl) throw new Error("Copy started but no monitor URL returned.");

  // Poll for completion (Wait up to 30 seconds)
  let resourceId = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000)); // Wait 2s
    
    const statusResp = await fetch(monitorUrl);
    const statusData = await statusResp.json();

    if (statusData.status === "completed") {
      resourceId = statusData.resourceId; 
      break;
    }
    if (statusData.status === "failed") {
      throw new Error("Copy operation failed on Microsoft server.");
    }
  }

  if (!resourceId) throw new Error("Copy timed out.");
  return resourceId;
}