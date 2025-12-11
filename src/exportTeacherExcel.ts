// src/exportTeacherExcel.ts
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import type { TeacherExportModel } from "./exportTeacherModel";

/** Ensure file name parts contain only safe characters. */
function sanitizeFilePart(part: string): string {
  return part.replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
}

/** Strip internal OCR markers like "[OCR]" before writing to Excel. */
function cleanOcrText(text?: string | null): string {
  if (!text) return "";
  let cleaned = text;
  cleaned = cleaned.replace(/\[OCR\]\s*/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

// URL where the template is served (public/TeacherTemplate.xlsx)
const TEMPLATE_URL = "/TeacherTemplate.xlsx";

/** Build and download the Teacher Excel workbook from the export model. */
export async function exportTeacherExcel(model: TeacherExportModel) {
  // 1) Load the template workbook instead of creating a new one
  const wb = new ExcelJS.Workbook();

  const resp = await fetch(TEMPLATE_URL);
  const arrayBuffer = await resp.arrayBuffer();
  await wb.xlsx.load(arrayBuffer);

  // 2) Get the first worksheet (your template only has one)
  const ws = wb.worksheets[0];

  // IMPORTANT:
  // We do NOT touch any dataValidations or conditional formatting here.
  // The template already has:
  //  - the dropdown on Rating column
  //  - CF rules that color the cell based on the selected value

  // ---- Header block (A1) ----
  // In your template, A1 is the big merged header "GrapeSEED Trainer …"
  ws.getCell("A1").value = model.headerBlock;

  // ---- Body rows (your model.rows already uses template row numbers) ----
  model.rows.forEach((row) => {
    const r = ws.getRow(row.rowIndex);

    // B: Indicator label (e.g. "1.1 — Organized Teaching Area")
    r.getCell("B").value = row.indicatorLabel;

    // C: Further explanation
    r.getCell("C").value = row.description;

    // D: Rating text ("Good" | "Need some work" | "Not applicable")
    // You already convert good/growth/blank into this in buildTeacherExportModel
    r.getCell("D").value = row.checklist;

    // E: Teacher's Strengths
    r.getCell("E").value = cleanOcrText(row.strengths) || "";

    // F: Teacher's Growth Areas
    r.getCell("F").value = cleanOcrText(row.growths) || "";

    // G (Next steps) stays as in the template – trainer can type later.

    // Alignment only – we don't set any fill, so we don't override template CF
    ["B", "C", "D", "E", "F"].forEach((col) => {
      const cell = r.getCell(col);
      cell.alignment = {
        vertical: "top",
        horizontal: col === "D" ? "center" : "left",
        wrapText: true,
      };
    });
  });

  // (Optional) row heights – if your template already has them set,
  // you can keep or remove this. It just enforces tall rows.
  for (let r = 4; r <= 21; r++) {
    ws.getRow(r).height = 110;
  }
  ws.getRow(12).height = 140; // long row

  // ---------------------------------------------------------
  // MERGE G2:G3 (Next Steps header should be one block)
  // ---------------------------------------------------------
  ws.mergeCells("G2:G3");

  // ---------------------------------------------------------
  // BORDERS for column G (header + body rows)
  // Make G2–G21 look like the rest of the table.
  // ---------------------------------------------------------
  const TABLE_BORDER: any = {
    top: { style: "thin", color: { argb: "FFBFBFBF" } },
    left: { style: "thin", color: { argb: "FFBFBFBF" } },
    bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
    right: { style: "thin", color: { argb: "FFBFBFBF" } },
  };

  for (let row = 2; row <= 21; row++) {
    const cell = ws.getCell(`G${row}`) as any;
    cell.border = TABLE_BORDER;
  }

  // 3) Generate file & download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const teacher = sanitizeFilePart(model.teacherName);
  const school = sanitizeFilePart(model.schoolName);
  const dateLabel = model.fileDate; // already "YYYY.MM.DD"
  const filename = `${teacher} - ${school} - ${dateLabel}.xlsx`;

  saveAs(blob, filename);
}