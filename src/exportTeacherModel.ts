// src/exportTeacherModel.ts

// 1. Helper: build sheet name
export function buildMonthYearSheetName(dateString?: string): string {
  let d: Date | null = null;
  if (dateString) {
    const parsed = new Date(dateString);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}.${year}`;
}

// 2. Helper: build file date label
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
  return `${year}.${month}.${day}`;
}

// -----------------------------------------------------------------
// 3. Type Definitions
// -----------------------------------------------------------------

export type SupportType = "Training" | "LVA" | "Visit";

export interface ObservationMetaForExport {
  teacherName: string;
  schoolName: string;
  campus: string;
  unit: string;
  lesson: string;
  supportType: SupportType;
  date?: string;
}

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

export type TeacherArea = "LEARNING_ENVIRONMENT" | "PREPARATION_AND_REFLECTION";

export interface TeacherRowConfig {
  rowIndex: number; 
  area: TeacherArea;
}

export interface TeacherExportRow {
  rowIndex: number;
  area: string;
  indicatorLabel: string;
  description: string;
  checklist: string;
  matchKey: string;
  status: "Done" | "Pending" | "";
  strengths: string;
  growths: string;
  goodFlag?: boolean;
  growthFlag?: boolean;
}

export interface TeacherExportModel {
  sheetName: string;
  headerBlock: string;
  rows: TeacherExportRow[];
  teacherName: string;
  schoolName: string;
  fileDate: string;
}

interface TeacherLayoutEntry {
  indicatorNumber: string;
  rowIndex: number;
  area: "LE" | "PR";
  indicatorLabel: string;
  excelDescription: string;
}

// -----------------------------------------------------------------
// 4. Layout Configuration
// -----------------------------------------------------------------

const TEACHER_LAYOUT: TeacherLayoutEntry[] = [
  { 
    indicatorNumber: "1.1", 
    rowIndex: 4, 
    area: "LE", 
    indicatorLabel: "1.1. Organized Teaching Area", 
    excelDescription: "- Teaching area is highly organized; materials, props, and technology are easily accessible. Students can see the teaching materials well." 
  },
  { 
    indicatorNumber: "1.2", 
    rowIndex: 5, 
    area: "LE", 
    indicatorLabel: "1.2. Safe teaching environment", 
    excelDescription: "Teaching environment is completely safe for all activities. Classroom space is effectively organized for easy movement during AAs and transitions." 
  },
  { 
    indicatorNumber: "1.3", 
    rowIndex: 6, 
    area: "LE", 
    indicatorLabel: "1.3. Visually stimulating environment", 
    excelDescription: "Classroom visuals fully reinforce lesson content and engage students." 
  },
  { 
    indicatorNumber: "2.1.– 2.2", 
    rowIndex: 7, 
    area: "PR", 
    indicatorLabel: "2.1.+ 2.2. Classroom Routines  & Management Strategies", 
    excelDescription: "- Routines are well-planned, effectively taught/modeled, and consistently reinforced.\n- Effective strategies create a productive and positive environment." 
  },
  { 
    indicatorNumber: "2.3", 
    rowIndex: 8, 
    area: "PR", 
    indicatorLabel: "2.3. Problem-Solving Tech Issues", 
    excelDescription: "Proactively resolves tech issues without interrupting lessons." 
  },
  { 
    indicatorNumber: "3.1", 
    rowIndex: 9, 
    area: "PR", 
    indicatorLabel: "3.1. Utilizing Lession Plans", 
    excelDescription: "Follows lesson plans with precision and adapts effectively." 
  },
  { 
    indicatorNumber: "3.5", 
    rowIndex: 10, 
    area: "PR", 
    indicatorLabel: "3.5. Using Memory Mode", 
    excelDescription: "Effectively delivers lessons using Memory Mode, allowing smooth and engaging instruction." 
  },
  { 
    indicatorNumber: "3.4 – 5.1", 
    rowIndex: 11, 
    area: "PR", 
    indicatorLabel: "3.4 + 5.1 Using Materials Effectively", 
    excelDescription: "Fully utilizes GrapeSEED materials as outlined in the Lesson Plans and manuals." 
  },
  { 
    indicatorNumber: "3.3 – 6.1 – 7.2", 
    rowIndex: 12, 
    area: "PR", 
    indicatorLabel: "3.3 + 6.1 + 7.2 Actively Monitoring Student Progress", 
    excelDescription: "- Prepares for diverse student responses and uses them to enrich lessons. Use the Lesson Plan, Learning Objectives, and components to create follow-up prompts and questions.\n- Consistently monitors and adjusts teaching based on students’ responses and behavior to enhance learning.\n- Listens for correct pronunciation, enunciation, and use of words related to the Learning Objectives.\n- Provides timely, specific, and constructive feedback to help students improve accuracy and pronunciation." 
  },
  { 
    indicatorNumber: "7.1", 
    rowIndex: 13, 
    area: "PR", 
    indicatorLabel: "7.1. Asking targeted Questions", 
    excelDescription: "Consistently asks purposeful questions that align with lesson objectives and engage all students." 
  },
  { 
    indicatorNumber: "7.3", 
    rowIndex: 14, 
    area: "PR", 
    indicatorLabel: "7.3. Using Effective Transitions", 
    excelDescription: "Uses transitions in the Lesson Plans or smoothly connects lesson components with purposeful transitions that reinforce objectives." 
  },
  { 
    indicatorNumber: "7.4 – 8.1", 
    rowIndex: 15, 
    area: "PR", 
    indicatorLabel: "7.4 + 8.1. Positive Presence and Participation", 
    excelDescription: "- Utilizes gestures, expressions, and prompts to actively engage all students in lessons.\n- Builds on student responses.\n- Uses props students are interested in that relate to the target words and expressions.\n- Maintains a positive demeanor with engaging facial expressions, body language, and voice that foster a joyful classroom." 
  },
  { 
    indicatorNumber: "7.5", 
    rowIndex: 16, 
    area: "PR", 
    indicatorLabel: "7.5. Allowing Time for Student Responses", 
    excelDescription: "Consistently provides appropriate wait time for students to think and respond using English." 
  },
  { 
    indicatorNumber: "7.6", 
    rowIndex: 17, 
    area: "PR", 
    indicatorLabel: "7.6. Facilitatiing Peer Practice", 
    excelDescription: "Regularly creates opportunities for students to practice speaking in pairs or small groups, fostering confidence and language use." 
  },
  { 
    indicatorNumber: "8.2", 
    rowIndex: 18, 
    area: "PR", 
    indicatorLabel: "8.2. Using Gestures and Props", 
    excelDescription: "- Purposefully integrates gestures and props to enhance comprehension and retention.\n- Points at the pictures while saying the target word, purposefully connecting the word with the image." 
  },
  { 
    indicatorNumber: "8.3", 
    rowIndex: 19, 
    area: "PR", 
    indicatorLabel: "8.3. Emphasizing Learning Objectives", 
    excelDescription: "Consistently uses visual cues to reinforce lesson objectives (e.g., phonograms) and key vocabulary." 
  },
  { 
    indicatorNumber: "8.4", 
    rowIndex: 20, 
    area: "PR", 
    indicatorLabel: "8.4. Modeling Proper Speech", 
    excelDescription: "- Clearly models speech with correct grammar, intonation, and pronunciation, serving as an effective language role model." 
  },
  { 
    indicatorNumber: "8.5", 
    rowIndex: 21, 
    area: "PR", 
    indicatorLabel: "8.5. Modeling Actions", 
    excelDescription: "- Accurately models actions and movements that align with lesson content, enhancing comprehension and engagement." 
  },
];

export const TEACHER_ROW_MAP: Record<string, TeacherRowConfig> = {
  "1.1": { rowIndex: 4, area: "LEARNING_ENVIRONMENT" },
  "1.2": { rowIndex: 5, area: "LEARNING_ENVIRONMENT" },
  "1.3": { rowIndex: 6, area: "LEARNING_ENVIRONMENT" },
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

// -----------------------------------------------------------------
// 5. Main Export Function (Revised for Keyword Anchors)
// -----------------------------------------------------------------

// export function buildTeacherExportModel(
//   meta: ObservationMetaForExport,
//   indicators: IndicatorStateForExport[]
// ): TeacherExportModel {
//   const byNumber = new Map(indicators.map((i) => [i.number, i]));
//   const TRAINER_NAME = "Brian"; 
//   const displayDate = meta.date ?? "(not set in app yet)";

//   const rows: TeacherExportRow[] = TEACHER_LAYOUT.map((layout) => {
//     const src = byNumber.get(layout.indicatorNumber);

//     const good = src?.good ?? false;
//     const growth = src?.growth ?? false;
//     let comment = src?.commentText ?? "";

//     // ---------------------------------------------------------
//     // 🟢 SANITIZER (Fixed to preserve newlines)
//     // ---------------------------------------------------------
//     // Remove [OCR], [AD], [Hints], or any content in square brackets.
//     comment = comment.replace(/\[.*?\]/g, "").trim();
    
//     // ⚠️ CRITICAL FIX: Only replace spaces/tabs, NOT newlines. 
//     // Old code (/\s\s+/g) was deleting line breaks.
//     comment = comment.replace(/[ \t]+/g, " "); 
//     // ---------------------------------------------------------

//     // 🟢 DEDUPLICATION
//     const strengthSet = new Set<string>();
//     const growthSet = new Set<string>();

//     // Split by newlines (now preserved correctly)
//     const lines = comment.split("\n").map(l => l.trim()).filter(Boolean);

//     lines.forEach(line => {
//       // 🟢 HYBRID LOGIC

//       // Rule A: Check for (GA) - Priority 1 (ANYWHERE in the line)
//       // Matches "Some text (GA)" or "(GA) Some text"
//       const gaRegex = /\(\s*GA\s*\)/i;
      
//       if (gaRegex.test(line)) {
//         // Found (GA) -> It is definitely GROWTH
//         // Remove the (GA) marker, trim whitespace/hyphens, and save
//         const content = line.replace(gaRegex, "").replace(/^[\s\-\•]+/, "").trim();
//         if (content) growthSet.add(content);
//         return; // Line handled
//       } 

//       // Rule B: Check for Hyphen or Bullet - Priority 2
//       // Must be at the very start of the line
//       if (line.startsWith("-") || line.startsWith("•")) {
//         // Found Hyphen -> It is definitely STRENGTH
//         const content = line.replace(/^[\s\-\•]+/, "").trim();
//         if (content) strengthSet.add(content);
//         return; // Line handled
//       }

//       // Rule C: No Markers? Fallback to Checkboxes
//       if (!good && growth) {
//         // Only "Growth" is checked -> Unlabeled text goes to GROWTH
//         growthSet.add(line);
//       } else {
//         // "Good" is checked OR "Both" checked OR "Neither" -> Unlabeled text goes to STRENGTH
//         strengthSet.add(line);
//       }
//     });

//     const strengthItems = Array.from(strengthSet);
//     const growthItems = Array.from(growthSet);

//     // 🟢 FORMATTING: Join with Hyphens
//     let strengths = strengthItems.map(s => `- ${s}`).join("\n");
//     let growths = growthItems.map(g => `- ${g}`).join("\n");

//     if (!strengthItems.length && !growthItems.length) {
//         strengths = "";
//         growths = "";
//     }

//     // Dropdown Logic (Column D)
//     let checklist: string;
//     if (!good && !growth) {
//       checklist = "Not applicable";
//     } else if (good) {
//       checklist = "Good";
//     } else {
//       checklist = "Need some work";
//     }

//     const status: "" | "Done" | "Pending" =
//       !good && !growth
//         ? ""
//         : good && !growth
//         ? "Done"
//         : !good && growth
//         ? "Pending"
//         : "Done";

//     return {
//       rowIndex: layout.rowIndex,
//       area: layout.area,
//       indicatorLabel: layout.indicatorLabel,
//       description: layout.excelDescription,
//       checklist,
//       status,
//       strengths, 
//       growths,   
//       goodFlag: good,
//       growthFlag: growth,
//     };
//   });

//   const sheetName = buildMonthYearSheetName(meta.date);
//   const fileDate = buildFileDateLabel(meta.date);

//   const headerBlock = [
//     `GrapeSEED Trainer: ${TRAINER_NAME}`,
//     `School: ${meta.schoolName} – ${meta.campus}`,
//     `Support type: ${meta.supportType}`,
//     `Unit ${meta.unit} – Lesson ${meta.lesson}`,
//     `Teacher: ${meta.teacherName}`,
//     `Date: ${displayDate}`,
//   ].join("\n");

//   return {
//     sheetName,
//     headerBlock,
//     rows,
//     teacherName: meta.teacherName,
//     schoolName: meta.schoolName,
//     fileDate,
//   };
// }


export function buildTeacherExportModel(
  meta: ObservationMetaForExport,
  indicators: IndicatorStateForExport[],
  trainerName: string
): TeacherExportModel {
  const byNumber = new Map(indicators.map((i) => [i.number, i]));
  const displayDate = meta.date ?? "(not set in app yet)";

  const rows: TeacherExportRow[] = TEACHER_LAYOUT.map((layout) => {
    const src = byNumber.get(layout.indicatorNumber);

    const good = src?.good ?? false;
    const growth = src?.growth ?? false;
    let comment = src?.commentText ?? "";

    // ---------------------------------------------------------
    // 1. SANITIZER: Remove [OCR], [Hints], [Admin Cues]
    // ---------------------------------------------------------
    comment = comment.replace(/\[.*?\]/g, "").trim();
    comment = comment.replace(/[ \t]+/g, " ");

    // ---------------------------------------------------------
    // 2. PARSER: Strict Start-of-Line Logic
    // ---------------------------------------------------------
    const strengthSet = new Set<string>();
    const growthSet = new Set<string>();

    const lines = comment.split("\n").map(l => l.trim()).filter(Boolean);

// Proposed update for the parser section in src/exportTeacherModel.ts

lines.forEach(line => {
  const gaRegex = /^\(\s*GA\s*\)/i;
  const hyphenRegex = /^[\s]*[-•]/;

  // 1. (GA) marker → GROWTH
  if (gaRegex.test(line)) {
    const cleanText = line
        .replace(gaRegex, "")
        .replace(/^[\s\-\•]+/, "")
        .trim();
    if (cleanText) growthSet.add(cleanText);
  }
  // 2. Hyphen/bullet at start → STRENGTH (even if Growth is checked)
  else if (hyphenRegex.test(line)) {
    const cleanText = line.replace(/^[\s\-\•]+/, "").trim();
    if (cleanText) strengthSet.add(cleanText);
  }
  // 3. Only Growth checkbox active (Good is false) → GROWTH
  else if (!good && growth) {
    const cleanText = line.replace(/^[\s\-\•]+/, "").trim();
    if (cleanText) growthSet.add(cleanText);
  }
  // 4. Fallback → STRENGTH
  else {
    const cleanText = line.replace(/^[\s\-\•]+/, "").trim();
    if (cleanText) strengthSet.add(cleanText);
  }
});

    const strengthItems = Array.from(strengthSet);
    const growthItems = Array.from(growthSet);

    // ---------------------------------------------------------
    // 🟢 3. FORMATTING: Bare Paragraphs + Double Spacing
    // ---------------------------------------------------------
    // CHANGED: Removed the hyphen prefix logic.
    // We join with "\n\n" to create the empty line between paragraphs.
    
    let strengths = strengthItems.join("\n\n");
    let growths = growthItems.join("\n\n");

    // Dropdown Logic (Column D)
    let checklist: string;
    if (!good && !growth) {
      checklist = "Not applicable";
    } else if (good) {
      checklist = "Good";
    } else {
      checklist = "Need some work";
    }

    const status: "" | "Done" | "Pending" =
      !good && !growth
        ? ""
        : good && !growth
        ? "Done"
        : !good && growth
        ? "Pending"
        : "Done";

    return {
      rowIndex: layout.rowIndex,
      area: layout.area,
      indicatorLabel: layout.indicatorLabel,
      description: layout.excelDescription,
      checklist,
      matchKey: layout.indicatorNumber,
      status,
      strengths, 
      growths,   
      goodFlag: good,
      growthFlag: growth,
    };
  });

  const sheetName = buildMonthYearSheetName(meta.date);
  const fileDate = buildFileDateLabel(meta.date);

  const headerBlock = [
    `GrapeSEED Trainer: ${trainerName}`,
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