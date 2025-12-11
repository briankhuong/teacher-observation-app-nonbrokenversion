// src/exportTeacherModel.ts

// Helper: build sheet name like "11.2025"
export function buildMonthYearSheetName(dateString?: string): string {
  let d: Date | null = null;
  if (dateString) {
    const parsed = new Date(dateString);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) d = new Date();

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}.${year}`; // e.g. 11.2025
}

// Helper: build file date label like "2025.11.27"
export function buildFileDateLabel(dateString?: string): string {
  let d: Date | null = null;
  if (dateString) {
    const parsed = new Date(dateString);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) d = new Date();

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`; // 2025.11.27
}

interface TeacherLayoutEntry {
  indicatorNumber: string;   // must match .number in your app
  rowIndex: number;          // 4–21
  area: "LE" | "PR";         // Learning Env / Prep+Reflection
  indicatorLabel: string;    // text that goes into column B
  excelDescription: string;  // full long description for column C
}

const TEACHER_LAYOUT: TeacherLayoutEntry[] = [
  {
    indicatorNumber: "1.1",
    rowIndex: 4,
    area: "LE",
    indicatorLabel: "1.1. Organized Teaching Area",
    excelDescription:
      "- Teaching area is highly organized; materials, props, and technology are easily accessible. Students can see the teaching materials well.",
  },
  {
    indicatorNumber: "1.2",
    rowIndex: 5,
    area: "LE",
    indicatorLabel: "1.2. Safe teaching environment",
    excelDescription:
      "Teaching environment is completely safe for all activities. Classroom space is effectively organized for easy movement during AAs and transitions.",
  },
  {
    indicatorNumber: "1.3",
    rowIndex: 6,
    area: "LE",
    indicatorLabel: "1.3. Visually stimulating environment",
    excelDescription:
      "Classroom visuals fully reinforce lesson content and engage students.",
  },
  {
    indicatorNumber: "2.1.– 2.2",
    rowIndex: 7,
    area: "PR",
    indicatorLabel: "2.1.+ 2.2. Classroom Routines  & Management Strategies",
    excelDescription:
      "- Routines are well-planned, effectively taught/modeled, and consistently reinforced.\n" +
      "- Effective strategies create a productive and positive environment.",
  },
  {
    indicatorNumber: "2.3",
    rowIndex: 8,
    area: "PR",
    indicatorLabel: "2.3. Problem-Solving Tech Issues",
    excelDescription:
      "Proactively resolves tech issues without interrupting lessons.",
  },
  {
    indicatorNumber: "3.1",
    rowIndex: 9,
    area: "PR",
    indicatorLabel: "3.1. Utilizing Lession Plans",
    excelDescription:
      "Follows lesson plans with precision and adapts effectively.",
  },
  {
    indicatorNumber: "3.5",
    rowIndex: 10,
    area: "PR",
    indicatorLabel: "3.5. Using Memory Mode",
    excelDescription:
      "Effectively delivers lessons using Memory Mode, allowing smooth and engaging instruction.",
  },
  {
    indicatorNumber: "3.4 – 5.1",
    rowIndex: 11,
    area: "PR",
    indicatorLabel: "3.4 + 5.1 Using Materials Effectively",
    excelDescription:
      "Fully utilizes GrapeSEED materials as outlined in the Lesson Plans and manuals.",
  },
  {
    indicatorNumber: "3.3 – 6.1 – 7.2",
    rowIndex: 12,
    area: "PR",
    indicatorLabel: "3.3 + 6.1 + 7.2 Actively Monitoring Student Progress",
    excelDescription:
      "- Prepares for diverse student responses and uses them to enrich lessons. Use the Lesson Plan, Learning Objectives, and components to create follow-up prompts and questions.\n" +
      "- Consistently monitors and adjusts teaching based on students’ responses and behavior to enhance learning.\n" +
      "- Listens for correct pronunciation, enunciation, and use of words related to the Learning Objectives.\n" +
      "- Provides timely, specific, and constructive feedback to help students improve accuracy and pronunciation.",
  },
  {
    indicatorNumber: "7.1",
    rowIndex: 13,
    area: "PR",
    indicatorLabel: "7.1. Asking targeted Questions",
    excelDescription:
      "Consistently asks purposeful questions that align with lesson objectives and engage all students.",
  },
  {
    indicatorNumber: "7.3",
    rowIndex: 14,
    area: "PR",
    indicatorLabel: "7.3. Using Effective Transitions",
    excelDescription:
      "Uses transitions in the Lesson Plans or smoothly connects lesson components with purposeful transitions that reinforce objectives.",
  },
  {
    indicatorNumber: "7.4 – 8.1",
    rowIndex: 15,
    area: "PR",
    indicatorLabel: "7.4 + 8.1. Positive Presence and Participation",
    excelDescription:
      "- Utilizes gestures, expressions, and prompts to actively engage all students in lessons.\n" +
      "- Builds on student responses.\n" +
      "- Uses props students are interested in that relate to the target words and expressions.\n" +
      "- Maintains a positive demeanor with engaging facial expressions, body language, and voice that foster a joyful classroom.",
  },
  {
    indicatorNumber: "7.5",
    rowIndex: 16,
    area: "PR",
    indicatorLabel: "7.5. Allowing Time for Student Responses",
    excelDescription:
      "Consistently provides appropriate wait time for students to think and respond using English.",
  },
  {
    indicatorNumber: "7.6",
    rowIndex: 17,
    area: "PR",
    indicatorLabel: "7.6. Facilitatiing Peer Practice",
    excelDescription:
      "Regularly creates opportunities for students to practice speaking in pairs or small groups, fostering confidence and language use.",
  },
  {
    indicatorNumber: "8.2",
    rowIndex: 18,
    area: "PR",
    indicatorLabel: "8.2. Using Gestures and Props",
    excelDescription:
      "- Purposefully integrates gestures and props to enhance comprehension and retention.\n" +
      "- Points at the pictures while saying the target word, purposefully connecting the word with the image.",
  },
  {
    indicatorNumber: "8.3",
    rowIndex: 19,
    area: "PR",
    indicatorLabel: "8.3. Emphasizing Learning Objectives",
    excelDescription:
      "Consistently uses visual cues to reinforce lesson objectives (e.g., phonograms) and key vocabulary.",
  },
  {
    indicatorNumber: "8.4",
    rowIndex: 20,
    area: "PR",
    indicatorLabel: "8.4. Modeling Proper Speech",
    excelDescription:
      "- Clearly models speech with correct grammar, intonation, and pronunciation, serving as an effective language role model.",
  },
  {
    indicatorNumber: "8.5",
    rowIndex: 21,
    area: "PR",
    indicatorLabel: "8.5. Modeling Actions",
    excelDescription:
      "- Accurately models actions and movements that align with lesson content, enhancing comprehension and engagement.",
  },
];

// Support type is same as in your app
export type SupportType = "Training" | "LVA" | "Visit";

/** Meta info for one observation used for export */
export interface ObservationMetaForExport {
  teacherName: string;
  schoolName: string;
  campus: string;
  unit: string;
  lesson: string;
  supportType: SupportType;
  /** Optional for now – we will wire this once date is stored in meta */
  date?: string;
}

/** Minimal per-indicator state we need for teacher export */
export interface IndicatorStateForExport {
  id: string;
  number: string;
  title: string;
  description: string;
  good: boolean;
  growth: boolean;
  commentText: string;
  includeInTrainerSummary?: boolean;
}

/** Two big areas in the teacher template */
export type TeacherArea =
  | "LEARNING_ENVIRONMENT"
  | "PREPARATION_AND_REFLECTION";

/** Where each indicator should appear in the teacher sheet */
export interface TeacherRowConfig {
  rowIndex: number; // Excel row number (4–21 in your template)
  area: TeacherArea;
}

/** One resolved row of the teacher export table (row 4–21) */
export interface TeacherExportRow {
  rowIndex: number;
  area: string;
  indicatorLabel: string;
  description: string;
  checklist: string; // now: "Good" | "Need some work" | "Not applicable"
  status: "Done" | "Pending" | "";
  strengths: string;
  growths: string;

  // used only for preview UI
  goodFlag?: boolean;
  growthFlag?: boolean;
}

export interface TeacherExportModel {
  sheetName: string;
  headerBlock: string;
  rows: TeacherExportRow[];
  teacherName: string;
  schoolName: string;
  fileDate: string; // "YYYY.MM.DD"
}

/**
 * Mapping from indicator.number => Excel row + area.
 */
export const TEACHER_ROW_MAP: Record<string, TeacherRowConfig> = {
  // LEARNING ENVIRONMENT (rows 4–6)
  "1.1": { rowIndex: 4, area: "LEARNING_ENVIRONMENT" },
  "1.2": { rowIndex: 5, area: "LEARNING_ENVIRONMENT" },
  "1.3": { rowIndex: 6, area: "LEARNING_ENVIRONMENT" },

  // PREPARATION AND REFLECTION & INSTRUCTIONAL DELIVERY (rows 7–21)
  "2.1.– 2.2": { rowIndex: 7, area: "PREPARATION_AND_REFLECTION" },
  "2.3": { rowIndex: 8, area: "PREPARATION_AND_REFLECTION" },
  "3.1": { rowIndex: 9, area: "PREPARATION_AND_REFLECTION" },
  "3.5": { rowIndex: 10, area: "PREPARATION_AND_REFLECTION" },
  "3.4 – 5.1": { rowIndex: 11, area: "PREPARATION_AND_REFLECTION" },
  "3.3 – 6.1 – 7.2": { rowIndex: 12, area: "PREPARATION_AND_REFLECTION" },
  "7.1": { rowIndex: 13, area: "PREPARATION_AND_REFLECTION" },
  "7.3": { rowIndex: 14, area: "PREPARATION_AND_REFLECTION" },
  "7.4 – 8.1": { rowIndex: 15, area: "PREPARATION_AND_REFLECTION" },
  "7.5": { rowIndex: 16, area: "PREPARATION_AND_REFLECTION" },
  "7.6": { rowIndex: 17, area: "PREPARATION_AND_REFLECTION" },
  "8.2": { rowIndex: 18, area: "PREPARATION_AND_REFLECTION" },
  "8.3": { rowIndex: 19, area: "PREPARATION_AND_REFLECTION" },
  "8.4": { rowIndex: 20, area: "PREPARATION_AND_REFLECTION" },
  "8.5": { rowIndex: 21, area: "PREPARATION_AND_REFLECTION" },
};

/**
 * Builds the Teacher Export model (no Excel yet) from an observation meta + indicators.
 */
export function buildTeacherExportModel(
  meta: ObservationMetaForExport,
  indicators: IndicatorStateForExport[]
): TeacherExportModel {
  const byNumber = new Map(indicators.map((i) => [i.number, i]));
  const TRAINER_NAME = "Brian"; // fixed trainer name for now

  // Human-facing date for the header
  const displayDate = meta.date ?? "(not set in app yet)";

  const rows: TeacherExportRow[] = TEACHER_LAYOUT.map((layout) => {
    const src = byNumber.get(layout.indicatorNumber);

    const good = src?.good ?? false;
    const growth = src?.growth ?? false;
    const anyMark = good || growth;
    const comment = src?.commentText ?? "";

    // 🔽 Teacher column D dropdown value
    // - Good only        → "Good"
    // - Growth only      → "Need some work"
    // - Good + Growth    → "Good"  (follow Admin: this is "Rất tốt")
    // - No mark          → "Not applicable"
    let checklist: string;
    if (!anyMark) {
      checklist = "Not applicable";
    } else if (good) {
      checklist = "Good";
    } else {
      checklist = "Need some work";
    }

    // 🔽 Status used only in the preview UI
    // - no mark        → ""
    // - Growth only    → "Pending"
    // - Good only      → "Done"
    // - Good + Growth  → "Done" (overall very good)
    const status: "" | "Done" | "Pending" =
      !anyMark
        ? ""
        : good && !growth
        ? "Done"
        : !good && growth
        ? "Pending"
        : "Done"; // good && growth

    // 🔽 Decide where the comment goes:
    // - Good only        → Strengths
    // - Growth only      → Growths
    // - Good + Growth    → Strengths only (avoid duplicate text)
    let strengths = "";
    let growths = "";

    if (good && !growth) {
      strengths = comment;
    } else if (!good && growth) {
      growths = comment;
    } else if (good && growth) {
      // Admin: "Rất tốt" → treat as overall strength in Teacher export
      strengths = comment;
    }

    return {
      rowIndex: layout.rowIndex,
      area: layout.area,
      indicatorLabel: layout.indicatorLabel,
      description: layout.excelDescription,
      checklist,
      status,
      strengths,
      growths,

      // For preview-only UI
      goodFlag: good,
      growthFlag: growth,
    };
  });

  const sheetName = buildMonthYearSheetName(meta.date);
  const fileDate = buildFileDateLabel(meta.date);

  const headerBlock = [
    `GrapeSEED Trainer: ${TRAINER_NAME}`,
    `School: ${meta.schoolName} – ${meta.campus}`,
    `Support type: ${meta.supportType}`,
    `Unit ${meta.unit} – Lesson ${meta.lesson}`,
    `Teacher: ${meta.teacherName}`,
    `Date: ${displayDate}`,
  ].join("\n");

  return {
    sheetName,
    headerBlock,
    rows,
    teacherName: meta.teacherName,
    schoolName: meta.schoolName,
    fileDate,
  };
}