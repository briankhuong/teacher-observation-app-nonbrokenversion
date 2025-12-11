// server/msGraphWorkbook.js

// Later this file will contain real Graph calls.
// For now we return fake URLs so you can test the flow end-to-end.

/**
 * Merge teacher export into workbook, return direct sheet URL.
 */
export async function mergeTeacherSheet({ workbookUrl, sheetName, model }) {
  console.log("[mergeTeacherSheet] called", { workbookUrl, sheetName });
  // TODO: use Graph to create/find worksheet and write `model` rows
  const sheetUrl = `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
  return { sheetUrl };
}

/**
 * Merge admin export into workbook, return sheet URL + view-only workbook URL.
 */
export async function mergeAdminSheet({ workbookUrl, sheetName, model }) {
  console.log("[mergeAdminSheet] called", { workbookUrl, sheetName });
  // TODO: real Graph logic
  const sheetUrl = `${workbookUrl}#sheet=${encodeURIComponent(sheetName)}`;
  const viewOnlyWorkbookUrl = `${workbookUrl}?view=readonly`;
  return { sheetUrl, viewOnlyWorkbookUrl };
}