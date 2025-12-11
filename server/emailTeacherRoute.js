// server/emailTeacherRoute.js
import express from "express";
import XLSX from "xlsx";
import { sendGraphMail } from "./msGraphEmail.js";

const router = express.Router();

/**
 * Body shape (from frontend):
 * {
 *   teacherEmail: string;
 *   teacherName: string;
 *   model: TeacherExportModel;
 * }
 *
 * TeacherExportModel is the same as in exportTeacherModel.ts:
 * {
 *   teacherName: string;
 *   schoolName: string;
 *   campus: string;
 *   unit: string;
 *   lesson: string;
 *   supportType: string;
 *   fileDate?: string;
 *   rows: {
 *     rowIndex: number;
 *     indicatorLabel: string;
 *     description: string;
 *     strengths: string;
 *     growths: string;
 *     status?: string;
 *   }[];
 * }
 */

// Build a simple one-sheet workbook from the existing TeacherExportModel
function buildTeacherWorkbook(model) {
  const wb = XLSX.utils.book_new();

  const metaSheetData = [
    ["Teacher", model.teacherName],
    ["School", model.schoolName],
    ["Campus", model.campus],
    ["Unit", model.unit],
    ["Lesson", model.lesson],
    ["Support type", model.supportType],
    ["Date", model.fileDate || ""],
    [],
  ];

  const headerRow = [
    "#",
    "Indicator",
    "Description",
    "Good points",
    "Growth areas",
    "Status",
  ];

  const rows = model.rows.map((row) => [
    row.indicatorLabel,
    "",
    row.description,
    row.strengths || "",
    row.growths || "",
    row.status || "",
  ]);

  const data = [...metaSheetData, headerRow, ...rows];

  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Teacher report");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buffer;
}

// POST /api/email/teacher-report
router.post("/teacher-report", async (req, res) => {
  try {
    const { teacherEmail, teacherName, model } = req.body || {};

    if (!teacherEmail || !model) {
      return res.status(400).json({
        error: "teacherEmail and model are required",
      });
    }

    const workbookBuffer = buildTeacherWorkbook(model);
    const base64 = workbookBuffer.toString("base64");

    const subject = `Observation report – ${teacherName || model.teacherName}`;
    const htmlBody = `
      <p>Dear ${teacherName || model.teacherName},</p>
      <p>Please find attached your observation report.</p>
      <p>Best regards,<br/>Your trainer</p>
    `;

    // This will NO-OP if env vars are missing (by design in msGraphEmail.js)
    await sendGraphMail({
      to: [teacherEmail],
      subject,
      htmlBody,
      attachments: [
        {
          name:
            `Teacher_Report_${(model.fileDate || "observation")
              .replace(/\//g, "-")
              .replace(/\s+/g, "_")}.xlsx`,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBytes: base64,
        },
      ],
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[emailTeacherRoute] Error", err);
    return res.status(500).json({ error: "Failed to email teacher report" });
  }
});

export default router;