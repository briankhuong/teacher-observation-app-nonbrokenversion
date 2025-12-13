// src/utils/sheetNaming.ts

function safeDate(dateISO: string | null | undefined): Date | null {
  if (!dateISO) return null;
  const d = new Date(dateISO);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildTeacherSheetName(dateISO: string | null | undefined): string {
  const d = safeDate(dateISO);
  if (!d) return "Teacher Report";

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}.${year}`; // "MM.YYYY"
}

function sanitizeSheetName(name: string): string {
  // Excel invalid: : \ / ? * [ ]
  // Also avoid leading/trailing apostrophes
  return (name || "")
    .replace(/[:\\\/\?\*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "");
}

export function buildAdminSheetName(
  teacherName: string | null | undefined,
  dateISO: string | null | undefined,
  supportType: string | null | undefined
): string {
  const tName = sanitizeSheetName(teacherName || "Teacher");
  const sType = sanitizeSheetName(supportType || "Visit");

  const d = safeDate(dateISO);
  if (!d) return `${tName} Unknown ${sType}`;

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  // "TeacherName MM.YYYY SupportType"
  return `${tName} ${month}.${year} ${sType}`.trim();
}