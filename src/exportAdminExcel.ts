// exportAdminExcel.ts
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import type { AdminExportModel } from "./exportAdminModel";

/**
 * ExcelJS-3.x compatible dropdown injector
 */
function addDropdown(ws: any, range: string, items: string[]) {
  const [start, end] = range.split(":");
  const s = ws.getCell(start);
  const e = ws.getCell(end);

  const formula = `"${items.join(",")}"`;

  for (let r = s.row; r <= e.row; r++) {
    for (let c = s.col; c <= e.col; c++) {
      const cell = ws.getCell(r, c);
      cell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [formula],
      };
    }
  }
}

export async function exportAdminExcel(model: AdminExportModel) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Admin");

  // -------------------------------------
  // Column widths
  // -------------------------------------
  ws.columns = [
    { key: "mainCategory", width: 18 },   // A
    { key: "aspect", width: 28 },         // B
    { key: "classroomSigns", width: 70 }, // C
    { key: "trainerRating", width: 14 },  // D
    { key: "trainerNotes", width: 70 },   // E
  ];

  // -------------------------------------
  // HEADER BLOCKS
  // -------------------------------------

  // A1:C2 → headerLeft
  ws.mergeCells("A1:C2");
  const left = ws.getCell("A1");
  left.value = model.headerLeft;
  left.font = { name: "Calibri", size: 11 };
  left.alignment = { vertical: "top", horizontal: "left", wrapText: true };

  // D1:E2 → headerRight (NO COLOR per your correction)
  ws.mergeCells("D1:E2");
  const right = ws.getCell("D1");
  right.value = model.headerRight;
  right.font = { name: "Calibri", size: 10 };
  right.alignment = { vertical: "top", horizontal: "left", wrapText: true };

  // -------------------------------------
  // TITLE AREA rows 3–4
  // -------------------------------------

  // A3:C4 merged – green
  ws.mergeCells("A3:C4");
  const title = ws.getCell("A3");
  title.value =
    "HƯỚNG DẪN CÁC KHÍA CẠNH GIẢNG DẠY GRAPESEED HIỆU QUẢ";
  title.font = { name: "Calibri", size: 11, bold: true };
  title.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFB5E6A2" },
  };

  // D3:E3 — NHẬN XÉT
  ws.mergeCells("D3:E3");
  const t1 = ws.getCell("D3");
  t1.value = "Nhận xét của Trainer";
  t1.font = { name: "Calibri", size: 11, bold: true };
  t1.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7C7AC" } };
  t1.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" }
  };

  // D4:E4 — GV name
  ws.mergeCells("D4:E4");
  const t2 = ws.getCell("D4");
  t2.value = `GV: ${model.teacherName}`;
  t2.font = { name: "Calibri", size: 11, bold: true };
  t2.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  t2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7C7AC" } };
  t2.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" }
  };

  // -------------------------------------
  // TABLE HEADER row 5
  // -------------------------------------
  const head = ws.getRow(5);
  head.values = [
    "Mục chính",
    "Khía cạnh",
    "Biểu hiện lớp học",
    "Đánh giá của Trainer",
    "Các điểm GV cần áp dụng / Lưu ý dành cho trường học/ trung tâm"
  ];
  head.font = { name: "Calibri", size: 10, bold: true };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

  // ✅ Color A5–C5 green
  ["A5", "B5", "C5"].forEach((addr) => {
    const cell = ws.getCell(addr);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFB5E6A2" },
    };
  });

  // ✅ Color D5–E5 peach
  ["D5", "E5"].forEach((addr) => {
    const cell = ws.getCell(addr);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF7C7AC" },
    };
  });

  // Borders for header row
  head.eachCell((c) => {
    c.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" }
    };
  });

  // -------------------------------------
  // BODY ROWS
  // -------------------------------------
  let rowIndex = 6;
  const categoryFirst: Record<string, number> = {};
  const categoryLast: Record<string, number> = {};

  for (const r of model.rows) {
    const row = ws.getRow(rowIndex);
    row.values = [
      r.mainCategory,
      r.aspect,
      r.classroomSigns,
      r.trainerRating,
      r.trainerNotes
    ];

    row.font = { name: "Calibri", size: 10 };
    row.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    row.eachCell((c) => {
      c.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" }
      };
    });

    if (!(r.mainCategory in categoryFirst)) {
      categoryFirst[r.mainCategory] = rowIndex;
    }
    categoryLast[r.mainCategory] = rowIndex;

    rowIndex++;
  }

  const lastRow = rowIndex - 1;

  // -------------------------------------
  // MERGE TRAINER NOTES E6:E19 (or up to last row)
  // -------------------------------------
  if (lastRow >= 6) {
    ws.mergeCells(`E6:E${lastRow}`);
    const mergedNotes = ws.getCell("E6");
    mergedNotes.alignment = {
      vertical: "top",
      horizontal: "left",
      wrapText: true,
    };
  }

  // -------------------------------------
  // CATEGORY COLOR MERGE (COLUMN A)
  // -------------------------------------
  const CAT_COLORS: Record<string, string> = {
    "Môi trường lớp học": "FFCAEDFB",
    "Phương pháp giảng dạy": "FFFFCCFF",
    "Tương tác & khuyến khích học sinh": "FFF7C7AC",
  };

  for (const cat of Object.keys(categoryFirst)) {
    const r1 = categoryFirst[cat];
    const r2 = categoryLast[cat];
    if (r1 > r2) continue;

    ws.mergeCells(r1, 1, r2, 1);
    const cell = ws.getCell(r1, 1);
    cell.value = cat;
    cell.font = { name: "Calibri", size: 11, bold: true };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      textRotation: 90,
      wrapText: true,
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: CAT_COLORS[cat] ?? "FFE5E5E5" },
    };
  }

  // -------------------------------------
  // DROPDOWN IN COLUMN D
  // -------------------------------------
  if (lastRow >= 6) {
    addDropdown(ws, `D6:D${lastRow}`, [
      "Không áp dụng",
      "Cần cải thiện",
      "Tốt",
      "Rất tốt",
    ]);
  }

  // -------------------------------------
  // SAVE EXCEL
  // -------------------------------------
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `Admin - ${model.schoolName} - ${model.fileDate}.xlsx`;
  saveAs(blob, filename);
}