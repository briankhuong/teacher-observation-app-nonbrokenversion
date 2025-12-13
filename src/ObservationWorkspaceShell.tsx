import { exportTeacherExcel } from "./exportTeacherExcel";
import { CanvasPad } from "./CanvasPad";
import React, { useEffect, useRef,useState } from "react";
import { exportAdminExcel } from "./exportAdminExcel"; // ← NEW
//import { buildAdminExportModel, type AdminExportModel } from "./exportAdminModel";
import { emailTeacherReport } from "./emailTeacherReport";

import {
  loadObservationFromDb,
  saveObservationToDb,
} from "./db/observations";

import type {
  ObservationMetaForExport,
  IndicatorStateForExport,
  TeacherExportModel,
} from "./exportTeacherModel";

import { buildTeacherExportModel } from "./exportTeacherModel";
import { buildAdminExportModel } from "./exportAdminModel";
import type { AdminExportModel, AdminExportRow } from "./exportAdminModel";

interface ObservationWorkspaceProps {
  observationMeta: {
    id: string;
    teacherName: string;
    schoolName: string;
    campus: string;
    unit: string;
    lesson: string;
    supportType: "Training" | "LVA" | "Visit";
     date: string; // NEW: actual observation date "YYYY-MM-DD"
  };
  onBack: () => void;
}

// OCR result from handwriting conversionfv
interface OcrResult {
  text: string;
  confidence: number;
}

// One point in a stroke
interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

// One stroke drawn on canvas
interface Stroke {
  color: string;
  size: number;
  points: StrokePoint[];
  mode: "pen" | "eraser";
}

// For future OCR integration
// One stroke drawn on canvas
interface Stroke {
  color: string;
  size: number;
  points: StrokePoint[];
  mode: "pen" | "eraser";
}

interface OcrResult {
  text: string;
  confidence: number;
}

// One indicator's state in the workspace
interface IndicatorState {
  id: string;
  number: string;
  title: string;
  description: string;
  hasPreComment: boolean;
  preComment?: string;
  good: boolean;
  growth: boolean;
  favorite: boolean;
  commentText: string;
  strokes: Stroke[];

  // 🔍 OCR metadata
  ocrUsed?: boolean;
  ocrLastRunAt?: number | null;
  ocrLastConfidence?: number | null; // later when we have real OCR
  ocrPendingReview?: boolean;        // true = show yellow highlight
  includeInTrainerSummary?: boolean;  // true = include this indicator in trainer summary
}

// interface SavedObservationPayload {
//   id: string;
//   meta: {
//     teacherName: string;
//     schoolName: string;
//     campus: string;
//     unit: string;
//     lesson: string;
//     supportType: "Training" | "LVA" | "Visit";
//     date: string; // NEW
//   };
//   indicators: IndicatorState[];
//   status: "draft" | "saved";
//   updatedAt: number;
//   scratchpadText?: string; // 🆕 optional for old records
// }

interface SavedObservationPayload {
  id: string;
  meta: {
    teacherName: string;
    schoolName: string;
    campus: string;
    unit: string;
    lesson: string;
    supportType: "Training" | "LVA" | "Visit";
    date: string;

    // ✅ keep stable links (optional)
    teacherWorkbookUrl?: string | null;
    adminWorkbookUrl?: string | null;
    adminWorkbookViewUrl?: string | null;

    // ✅ keep merge results (optional)
    mergedTeacher?: { url: string; sheetName?: string; mergedAt?: string } | null;
    mergedAdmin?: { url: string; sheetName?: string; mergedAt?: string } | null;
  };
  indicators: IndicatorState[];
  status: "draft" | "saved";
  updatedAt: number;
  scratchpadText?: string;
}

const STORAGE_PREFIX = "obs-v1-";


// TEMP: a small subset of indicators just so Phase 2 works.
// Later we’ll replace this with your full cleaned list.
const INITIAL_INDICATORS: IndicatorState[] = [
  {
    id: "ind-1",
    number: "1.1",
    title: "Organized Teaching Area",
    description: "Teaching area is highly organized; materials, props, and technology are easily accessible. Students can see the teaching materials well.",
    hasPreComment: true,
    preComment: "The classroom was spacious, which is ideal for students to learn English with GrapeSEED.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  

  },
  {
    id: "ind-2",
    number: "1.2",
    title: "Safe teaching environment",
    description: "Teaching environment is completely safe for all activities. Classroom space is effectively organized for easy movement during AAs and transitions.",
    hasPreComment: true,
    preComment: "The classroom was spacious, which is ideal for students to learn English with GrapeSEED.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  

  },
  {
    id: "ind-3",
    favorite: false,  
    number: "1.3",
    title: "Visually stimulating environment",
    description: "Classroom visuals fully reinforce lesson content and engage students.",
    hasPreComment: true,
    preComment: "The classroom was spacious, which is ideal for students to learn English with GrapeSEED.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],

  },
  {
    id: "ind-4",
    number: "2.1.– 2.2",
    title: "Classroom Routines  & Management Strategies",
    description: "- Routines are well-planned, effectively taught/modeled, and consistently reinforced. - Effective strategies create a predictable, positive learning environment.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-5",
    number: "2.3",
    title: "Problem-Solving Tech Issues",
    description: "Proactively resolves tech issues without interrupting lessons.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-6",
    number: "3.1",
    title: "Utilizing Lession Plans",
    description: "Follows lesson plans with precision and adapts only when needed to support learning.",
    hasPreComment: true,
    preComment: "You managed to follow all instructions in the lesson plan.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-7",
    number: "3.5",
    title: "Using Memory Mode",
    description: "Effectively delivers lessons using Memory Mode to maximize student recall.",
    hasPreComment: true,
    preComment: "You have memorized all the materials.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-8",
    number: "3.4 – 5.1",
    title: "Using Materials Effectively",
    description: "Fully utilizes GrapeSEED materials as outlined in the lesson plans.",
    hasPreComment: true,
    preComment: "You delivered all materials accurately.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-9",
    number: "3.3 – 6.1 – 7.2",
    title: "Actively Monitoring Student Progress",
    description: "- Prepares for diverse student responses and uses them to gauge understanding. - Regularly checks student progress and adjusts instruction as needed.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-10",
    number: "7.1",
    title: "Asking targeted Questions",
    description: "Consistently asks purposeful questions that allow students to demonstrate understanding.",
    hasPreComment: true,
    preComment: "You asked all questions in the lesson plan.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-11",
    number: "7.3",
    title: "Using Effective Transitions",
    description: "Uses transitions in the lesson plans or smoothly connects activities to maintain lesson flow.",
    hasPreComment: true,
    preComment: "You conducted engaging transitions.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-12",
    number: "7.4 – 8.1",
    title: "Positive Presence and Participation",
    description: "- Utilizes gestures, expressions, and prompts to encourage active student participation. - Builds a positive atmosphere that supports confident language use.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-13",
    number: "7.5",
    title: "Allowing Time for Student Responses",
    description: "Consistently provides appropriate wait time for student responses.",
    hasPreComment: true,
    preComment: "You gave students enough time to think before inviting them to answer questions.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-14",
    number: "7.6",
    title: "Facilitatiing Peer Practice",
    description: "Regularly creates opportunities for students to practice speaking in pairs or small groups, fostering confidence and language use.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-15",
    number: "8.2",
    title: "Using Gestures and Props",
    description: "- Purposefully integrates gestures and props to enhance comprehension and retention. - Points at the pictures while saying the corresponding words.",
    hasPreComment: true,
    preComment: "You used gestures and props effectively, pointing precisely at the pictures and helping students understand the content better.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-16",
    number: "8.3",
    title: "Emphasizing Learning Objectives",
    description: "Consistently uses visual cues to reinforce lesson objectives (e.g., phonograms) and key vocabulary.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-17",
    number: "8.4",
    title: "Modeling Proper Speech",
    description: "- Clearly models speech with correct grammar, intonation, and pronunciation, serving as an effective language role model.",
    hasPreComment: true,
    preComment: "All instructions and sample sentences were said accurately, making them great models for the students to learn from.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-18",
    number: "8.5",
    title: "Modeling Actions",
    description: "- Accurately models actions and movements that align with lesson content, enhancing comprehension and engagement.",
    hasPreComment: true,
    preComment: "All actions were modeled clearly, allowing students to understand and follow easily.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
];

// Helper: convert strokes → PNG → base64 string
async function strokesToPngBase64(strokes: Stroke[]): Promise<string> {
  if (!strokes.length) {
    throw new Error("No strokes to convert");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas not supported");
  }

  // Compute bounds so we don’t create a huge blank image
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    throw new Error("Invalid stroke bounds");
  }

  const margin = 20;
  const width = Math.max(1, Math.round(maxX - minX + margin * 2));
  const height = Math.max(1, Math.round(maxY - minY + margin * 2));

  canvas.width = width;
  canvas.height = height;

  // Dark-ish background, white lines (similar to your UI)
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, width, height);

  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    const first = stroke.points[0];
    ctx.moveTo(first.x - minX + margin, first.y - minY + margin);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      ctx.lineTo(p.x - minX + margin, p.y - minY + margin);
    }
    ctx.lineWidth = stroke.size || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color || "#ffffff";
    ctx.stroke();
  }

  // Canvas → blob → base64
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) return reject(new Error("Failed to create PNG blob"));
      resolve(b);
    }, "image/png");
  });

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64;
}

// 🚀 Real OCR hook: strokes → PNG base64 → local Node server → Azure
async function runOcrOnStrokes(strokes: Stroke[]): Promise<OcrResult> {
  try {
    const imageBase64 = await strokesToPngBase64(strokes);

    const response = await fetch(
  `http://${window.location.hostname}:4000/api/ocr-azure`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 }),
  }
);

    if (!response.ok) {
      console.error("Azure OCR HTTP error", response.status);
      return { text: "", confidence: 0 };
    }

    const data: { text?: string; confidence?: number } = await response.json();

    return {
      text: data.text ?? "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0.7,
    };
  } catch (err) {
    console.error("Azure OCR request failed", err);
    return { text: "", confidence: 0 };
  }
}

// Normalize indicators coming from DB or localStorage so we always have an array
function normalizeIndicators(raw: any): any[] {
  if (Array.isArray(raw)) return raw;

  // Some legacy shapes might be { indicators: [...] }
  if (raw && Array.isArray(raw.indicators)) return raw.indicators;

  // {} / null / undefined → start from empty
  return [];
}


export const ObservationWorkspaceShell: React.FC<
  ObservationWorkspaceProps
> = ({ observationMeta, onBack }) => {
  const { teacherName, schoolName, campus, unit, lesson, supportType, date } =
    observationMeta;

  const storageKey = `${STORAGE_PREFIX}${observationMeta.id}`;

  const [indicators, setIndicators] =
    useState<IndicatorState[]>(INITIAL_INDICATORS);
  const [activeIndex, setActiveIndex] = useState(0);
  // Observation-level status: "draft" (editable) or "saved" (completed/locked)
  const [observationStatus, setObservationStatus] = useState<"draft" | "saved">(
    "draft"
  );
  // For the little "saved at" label (existing behaviour)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const isLocked = observationStatus === "saved";


  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [filterMode, setFilterMode] = useState<"all" | "good" | "growth" | "favorites">(
  "all"
);


  // Track which indicator descriptions are expanded
  const [expandedDesc, setExpandedDesc] = useState<Record<string, boolean>>({});
  const [scratchpadText, setScratchpadText] = useState<string>("");
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [exportPreview, setExportPreview] = useState<TeacherExportModel | null>(null);
  //admin preview
  const [showAdminPreview, setShowAdminPreview] = useState(false);
  const [adminPreview, setAdminPreview] = useState<AdminExportModel | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);


  useEffect(() => {
      if (indicators.length === 0) return;

      if (activeIndex >= indicators.length) {
        setActiveIndex(0);
      }
    }, [indicators.length, activeIndex]);

  const active =
  indicators[activeIndex] ?? indicators[0] ?? INITIAL_INDICATORS[0];

    // Load from localStorage when opening this observation
  useEffect(() => {
  let cancelled = false;

  async function load() {
    // 1️⃣ Try localStorage first (fast / offline)
    // 1️⃣ Try localStorage first (fast / offline)
      try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed: SavedObservationPayload = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.indicators)) {
        if (cancelled) return;

        const normalized = normalizeIndicators(parsed.indicators);
        const finalIndicators =
          normalized.length > 0
            ? (normalized as IndicatorState[])
            : INITIAL_INDICATORS;

        setIndicators(finalIndicators);
        // 🔐 restore observation status (draft / saved)
        setObservationStatus(parsed.status ?? "draft");
        setSaveStatus(parsed.status === "saved" ? "saved" : "idle");
        setLastSavedAt(parsed.updatedAt ?? null);
        setScratchpadText(parsed.scratchpadText ?? "");
        return; // ✅ done, no need to hit Supabase
      }
    }
  } catch (err) {
    console.error("Failed to load observation from storage", err);
  }


    // 2️⃣ Nothing in localStorage → load from Supabase
    // 2️⃣ Nothing in localStorage → load from Supabase
      try {
        const row = await loadObservationFromDb(observationMeta.id);
    

        if (cancelled) return;

        const metaFromDb = (row.meta ?? {}) as any;

        // 1️⃣ Normalize DB indicators & fall back to INITIAL_INDICATORS if empty
        const normalizedFromDb = normalizeIndicators(row.indicators);
        const finalIndicators =
          normalizedFromDb.length > 0
            ? (normalizedFromDb as IndicatorState[])
            : INITIAL_INDICATORS;

        const payload: SavedObservationPayload = {
          id: row.id,
          meta: {
            teacherName: metaFromDb.teacherName ?? observationMeta.teacherName,
            schoolName: metaFromDb.schoolName ?? observationMeta.schoolName,
            campus: metaFromDb.campus ?? observationMeta.campus,
            unit: metaFromDb.unit ?? observationMeta.unit,
            lesson: metaFromDb.lesson ?? observationMeta.lesson,
            supportType: metaFromDb.supportType ?? observationMeta.supportType,
            date: metaFromDb.date ?? observationMeta.date,
          },
          indicators: finalIndicators,
          status: row.status ?? "draft",
          updatedAt: Date.now(),
          scratchpadText: "", // we don't store this in DB (yet)
        };

        // cache for next time
        try {
          localStorage.setItem(storageKey, JSON.stringify(payload));
        } catch (err) {
          console.error("Failed to cache observation to localStorage", err);
        }

        setIndicators(finalIndicators);
        // 🔐 restore observation status from DB
        setObservationStatus(payload.status ?? "draft");
        setSaveStatus(payload.status === "saved" ? "saved" : "idle");
        setLastSavedAt(payload.updatedAt);
        setScratchpadText(payload.scratchpadText ?? "");
      } catch (err) {
        console.error("[Workspace] Could not load observation from DB", err);

      if (!cancelled) {
        // fall back to fresh blank observation
        setIndicators(INITIAL_INDICATORS);
        setObservationStatus("draft");
        setSaveStatus("idle");
        setLastSavedAt(null);
        setScratchpadText("");
      }
    }
  }

  load();
  return () => {
    cancelled = true;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [storageKey, observationMeta.id]);

const persistObservation = React.useCallback(
  async (payload: SavedObservationPayload) => {
    // 1️⃣ Local cache
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (err) {
      console.error("Failed to write observation to localStorage", err);
    }

    // 2️⃣ Supabase sync
    try {
      await saveObservationToDb({
        id: payload.id,
        status: payload.status,
        meta: payload.meta,
        indicators: payload.indicators,
      });
    } catch (err) {
      console.error(
        "[Workspace] Failed to sync observation to Supabase",
        err
      );
    }
  },
  [storageKey]
);

   useEffect(() => {
  if (!observationMeta.id) return;

  // Cancel any pending save
  if (saveTimeoutRef.current) {
    window.clearTimeout(saveTimeoutRef.current);
  }

  // Debounce: save ~800ms after the last change
  saveTimeoutRef.current = window.setTimeout(() => {
  const payload: SavedObservationPayload = {
    id: observationMeta.id,
    meta: {
      teacherName,
      schoolName,
      campus,
      unit,
      lesson,
      supportType,
      date,
    },
    indicators,
    status: observationStatus,       // 🔒 now respects lock status
    updatedAt: Date.now(),
    scratchpadText,
  };

  persistObservation(payload);

  setLastSavedAt(payload.updatedAt);
  setSaveStatus(
    observationStatus === "saved" ? "saved" : "idle"
  );

  setCanvasDirty(false);
}, 800);


  return () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  indicators,
  scratchpadText,
  observationMeta.id,
  teacherName,
  schoolName,
  campus,
  unit,
  lesson,
  supportType,
]);
  
  // How many indicators have any value (good/growth/comment/strokes)
    const progressCount = indicators.filter((ind) => {
    const hasMark = ind.good || ind.growth;
    const hasComment = ind.commentText.trim().length > 0;
    const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
    return hasMark || hasComment || hasInk;
  }).length;

  const handleManualSave = () => {
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  try {
    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: {
        teacherName,
        schoolName,
        campus,
        unit,
        lesson,
        supportType,
        date,
      },
      indicators,
      status: observationStatus,   // 🔒 important!
      updatedAt: Date.now(),
    };

    localStorage.setItem(storageKey, JSON.stringify(payload));
    setLastSavedAt(payload.updatedAt);
    setSaveStatus(
      observationStatus === "saved" ? "saved" : "idle"
    );
  } catch (err) {
    console.error("Manual save failed", err);
  }
};


const handleBackToDashboard = () => {
  try {
    if (canvasDirty) {
      handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
      setCanvasDirty(false);
    }

    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: {
        teacherName,
        schoolName,
        campus,
        unit,
        lesson,
        supportType,
        date,
      },
      indicators,
      status: observationStatus,     // 🔒 respect locked state
      updatedAt: Date.now(),
    };

    localStorage.setItem(storageKey, JSON.stringify(payload));
    setLastSavedAt(payload.updatedAt);
    setSaveStatus(
      observationStatus === "saved" ? "saved" : "idle"
    );
  } catch (err) {
    console.error("Back-to-dashboard save failed", err);
  }

  onBack();
};

const handleMarkCompleted = async () => {
  if (isLocked) return;

  // Flush unsaved strokes
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  const payload: SavedObservationPayload = {
    id: observationMeta.id,
    meta: {
      teacherName,
      schoolName,
      campus,
      unit,
      lesson,
      supportType,
      date,
    },
    indicators,
    status: "saved",
    updatedAt: Date.now(),
    scratchpadText,
  };

  setObservationStatus("saved");
  setSaveStatus("saved");
  setLastSavedAt(payload.updatedAt);
  await persistObservation(payload);
};

const handleReopenDraft = async () => {
  if (!isLocked) return;

  const payload: SavedObservationPayload = {
    id: observationMeta.id,
    meta: {
      teacherName,
      schoolName,
      campus,
      unit,
      lesson,
      supportType,
      date,
    },
    indicators,
    status: "draft",
    updatedAt: Date.now(),
    scratchpadText,
  };

  setObservationStatus("draft");
  setSaveStatus("saved");
  setLastSavedAt(payload.updatedAt);
  await persistObservation(payload);
};

const handleEmailTeacher = async () => {
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  // You probably already have teacher email in meta in a later phase.
  // For now we pull it from meta if present, or prompt as fallback.
  const emailFromMeta =
    (observationMeta as any).teacherEmail ||
    (observationMeta as any).email ||
    "";

  const teacherEmail =
    emailFromMeta ||
    window.prompt("Teacher email address?", "")?.trim() ||
    "";

  if (!teacherEmail) {
    alert("No teacher email provided.");
    return;
  }

  const metaForExport: ObservationMetaForExport = {
    teacherName,
    schoolName,
    campus,
    unit,
    lesson,
    supportType,
    date,
  };

  const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
    id: ind.id,
    number: ind.number,
    title: ind.title,
    description: ind.description,
    good: ind.good,
    growth: ind.growth,
    commentText: ind.commentText,
    includeInTrainerSummary: !!ind.includeInTrainerSummary,
  }));

  const model = buildTeacherExportModel(metaForExport, exportIndicators);

  try {
    await emailTeacherReport({
      teacherEmail,
      teacherName,
      model,
    });
    alert("Teacher report emailed successfully.");
  } catch (err) {
    console.error(err);
    alert("Could not email teacher report. Check console for details.");
  }
};


    const handleExportTeacher = async () => {
    if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
    }

    const metaForExport: ObservationMetaForExport = {
      teacherName,
      schoolName,
      campus,
      unit,
      lesson,
      supportType,
      // TODO: once the observation form includes a date in meta,
      // wire it here. For now this will show "(not set in app yet)".
      date,
    };

    const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
      id: ind.id,
      number: ind.number,
      title: ind.title,
      description: ind.description,
      good: ind.good,
      growth: ind.growth,
      commentText: ind.commentText,
    }));

    const model = buildTeacherExportModel(metaForExport, exportIndicators);

    // Optional: still log for debugging
    console.log("TEACHER_EXPORT_MODEL", model);

    await exportTeacherExcel(model);
  };

const handleExportAdmin = async () => {
  // 1️⃣ If there is unsaved ink on the active indicator, flush it first
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  // 2️⃣ Build meta for export (same as teacher export, but reused here)
  const metaForExport: ObservationMetaForExport = {
    teacherName,
    schoolName,
    campus,
    unit,
    lesson,
    supportType,
    date: observationMeta.date, // already wired
  };

  // 3️⃣ Flatten indicators into the generic export shape
  const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
    id: ind.id,
    number: ind.number,
    title: ind.title,
    description: ind.description,
    good: ind.good,
    growth: ind.growth,
    commentText: ind.commentText,
    // 🆕 make sure includeInTrainerSummary is passed through
    includeInTrainerSummary: ind.includeInTrainerSummary ?? false,
  }));

  // 4️⃣ Build base ADMIN model from current state
  const baseModel = buildAdminExportModel(metaForExport, exportIndicators);

  // 5️⃣ If the Admin preview has been opened/edited, prefer those values
  const modelToExport =
    adminPreview && showAdminPreview
      ? {
          ...baseModel,
          rows: adminPreview.rows,                 // use edited trainerNotes
          trainerSummary: adminPreview.trainerSummary, // use edited summary
        }
      : baseModel;

  // Optional: log for debugging
  console.log("ADMIN_EXPORT_MODEL", modelToExport);

  await exportAdminExcel(modelToExport);
};

  
const handleExportPreview = () => {
  // Flush unsaved canvas strokes first so the model is accurate
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  const metaForExport: ObservationMetaForExport = {
    teacherName,
    schoolName,
    campus,
    unit,
    lesson,
    supportType,
    // TODO: wire actual date from observation meta later
     date: observationMeta.date, // "YYYY-MM-DD"
  };

 const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
  id: ind.id,
  number: ind.number,
  title: ind.title,
  description: ind.description,
  good: ind.good,
  growth: ind.growth,
  commentText: ind.commentText,
  includeInTrainerSummary: !!ind.includeInTrainerSummary, // 🆕
}));

  const model = buildTeacherExportModel(metaForExport, exportIndicators);

  setExportPreview(model);
  setShowExportPreview(true);
};

//admin preview
// admin preview
const handleAdminPreview = () => {
  // flush canvas first
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  const metaForExport: ObservationMetaForExport = {
    teacherName,
    schoolName,
    campus,
    unit,
    lesson,
    supportType,
    date: observationMeta.date, // already wired
  };

  const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
    id: ind.id,
    number: ind.number,
    title: ind.title,
    description: ind.description,
    good: ind.good,
    growth: ind.growth,
    commentText: ind.commentText,
    // ✅ pass Trainer-summary flag through to the export model
    includeInTrainerSummary: !!ind.includeInTrainerSummary,
  }));

  const model = buildAdminExportModel(metaForExport, exportIndicators);
  setAdminPreview(model);
  setShowAdminPreview(true);
};


const [canvasDirty, setCanvasDirty] = useState(false);

useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!canvasDirty) return;

    e.preventDefault();
    // NOTE: returnValue is deprecated but still required
    // for Chrome/desktop Safari to actually show a dialog.
    // On iPad Safari this is ignored.
    // @ts-ignore
    e.returnValue = "";
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [canvasDirty]);


const handleStrokesChange = (index: number, newStrokes: Stroke[]) => {
  if (isLocked) return; // 🔒 prevent drawing when locked
  updateIndicator(index, { strokes: newStrokes });
  setCanvasDirty(true);  // 🟡 canvas has unsaved handwriting
};


const handleConvertHandwritingToText = async () => {
  setOcrError(null);

  // No ink, nothing to do
  if (!active.strokes || active.strokes.length === 0) {
    setOcrError("No handwriting found for this indicator.");
    return;
  }

  // Prevent double-click during an ongoing OCR run
  if (isOcrRunning) return;

  setIsOcrRunning(true);

  try {
    // 1️⃣ Call the OCR hook — later this will be real OCR
    const { text, confidence } = await runOcrOnStrokes(active.strokes);

    // 2️⃣ Merge into existing comment with [OCR] label
    const existing = active.commentText.trim();
    const combined = existing
      ? `${existing}\n\n[OCR]\n${text}`
      : `[OCR]\n${text}`;

    // 3️⃣ Update indicator state
    const now = Date.now();

    updateIndicator(activeIndex, {
      commentText: combined,
      ocrUsed: true,
      ocrLastRunAt: now,
      ocrLastConfidence: confidence,
      ocrPendingReview: true,
    });
  } catch (err) {
    console.error("OCR failed", err);
    setOcrError("Could not convert handwriting. Please try again.");
  } finally {
    setIsOcrRunning(false);
  }
};

const handleBulkOcrForMissing = async () => {
  setOcrError(null);

  // Flush unsaved strokes for the active indicator first
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  // Already running? Ignore
  if (isOcrRunning) return;

  // Find all indicators that have handwriting but OCR not run yet
  const targets = indicators
    .map((ind, index) => ({ ind, index }))
    .filter(({ ind }) => {
      const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
      return hasInk && !ind.ocrUsed;
    });

  if (targets.length === 0) {
    setOcrError("No indicators with handwriting needing OCR.");
    return;
  }

  setIsOcrRunning(true);

  try {
    for (const { ind, index } of targets) {
      // In case state changed while we were looping, re-check ink/OCR
      const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
      if (!hasInk || ind.ocrUsed) continue;

      const { text, confidence } = await runOcrOnStrokes(ind.strokes);

      const existing = ind.commentText.trim();
      const combined = existing
        ? `${existing}\n\n[OCR]\n${text}`
        : `[OCR]\n${text}`;

      const now = Date.now();

      updateIndicator(index, {
        commentText: combined,
        ocrUsed: true,
        ocrLastRunAt: now,
        ocrLastConfidence: confidence,
        ocrPendingReview: true,
      });
    }
  } catch (err) {
    console.error("Bulk OCR failed", err);
    setOcrError("Bulk OCR failed. Please try again.");
  } finally {
    setIsOcrRunning(false);
  }
};


const toggleFavorite = (index: number) => {
  const target = indicators[index];
  updateIndicator(index, { favorite: !target.favorite });
};

const toggleIncludeInTrainerSummary = (index: number) => {
  const target = indicators[index];
  updateIndicator(index, {
    includeInTrainerSummary: !target.includeInTrainerSummary,
  });
};

  const updateIndicator = (index: number, patch: Partial<IndicatorState>) => {
    setIndicators((prev) =>
      prev.map((ind, i) => (i === index ? { ...ind, ...patch } : ind))
    );
  };

  // Toggle expanded/collapsed description for one indicator
    const toggleDescription = (id: string) => {
    setExpandedDesc((prev) => ({
        ...prev,
        [id]: !prev[id],
    }));
    };


  const toggleGood = (index: number) => {
    const target = indicators[index];
    updateIndicator(index, { good: !target.good });
  };

  const toggleGrowth = (index: number) => {
    const target = indicators[index];
    updateIndicator(index, { growth: !target.growth });
  };

  const insertPreComment = (index: number) => {
    const target = indicators[index];
    if (!target.hasPreComment || !target.preComment) return;
    const newText = target.commentText
      ? target.commentText + "\n" + target.preComment
      : target.preComment;
    updateIndicator(index, { commentText: newText });
  };

  // Auto-insert default comments for Good items that have a template but empty text
  const insertDefaultCommentsForGood = () => {
    setIndicators((prev) =>
      prev.map((ind) => {
        const hasTemplate = !!ind.preComment;
        const emptyComment =
          !ind.commentText || ind.commentText.trim().length === 0;

        if (ind.good && hasTemplate && emptyComment) {
          return {
            ...ind,
            commentText: ind.preComment!, // use the template text
          };
        }

        return ind;
      })
    );
  };

    // Make the indicator numbers in the warning banner clickable
  const renderClickableList = (items: IndicatorState[]) => {
    return items.map((ind, idx) => {
      const globalIndex = indicators.findIndex((x) => x.id === ind.id);
      const isLast = idx === items.length - 1;

      const handleClick = () => {
        if (globalIndex < 0) return;

        // Open sidebar so you can see the list
        setSidebarCollapsed(false);
        window.dispatchEvent(new Event("resize"));

        // Jump to that indicator
        setActiveIndex(globalIndex);

        const row = document.querySelector(
          `[data-indicator-id="${ind.id}"]`
        ) as HTMLElement | null;

        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };

      return (
        <span
          key={ind.id}
          className="export-warning-link"
          onClick={handleClick}
        >
          {ind.number}
          {!isLast && ", "}
        </span>
      );
    });
  };

  const handleMarkOcrReviewed = () => {
    // Clear the yellow highlight / pending flag for the active indicator
    updateIndicator(activeIndex, {
      ocrPendingReview: false,
    });
  };

  const handleCommentChange = (index: number, value: string) => {
  if (isLocked) return;
  const ind = indicators[index];

  // Check if the user has removed ALL OCR content
  const hadOcr = ind.ocrUsed;
  const ocrStillExists = value.includes("[OCR]");

  let patch: Partial<IndicatorState> = {
    commentText: value,
    ocrPendingReview: false, // user edited → no yellow highlight
  };

  // If OCR was previously used but no [OCR] tag remains → reset OCR state
  if (hadOcr && !ocrStillExists) {
    patch = {
      ...patch,
      ocrUsed: false,
      ocrLastRunAt: null,
      ocrLastConfidence: null,
      ocrPendingReview: false,
    };
  }

  updateIndicator(index, patch);
};

    // 🔎 Helper: jump to an indicator from preview warnings
  const jumpToIndicator = (indicatorNumber: string) => {
    const idx = indicators.findIndex((ind) => ind.number === indicatorNumber);
    if (idx === -1) return;

    // open sidebar if collapsed
    if (sidebarCollapsed) {
      setSidebarCollapsed(() => {
        // force CanvasPad resize after sidebar opens
        window.dispatchEvent(new Event("resize"));
        return false;
      });
    }

    setActiveIndex(idx);

    // scroll that indicator row into view
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-indicator-number="${indicatorNumber}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  };

  const renderIndicatorLinks = (numbers: string[]) => (
    <>
      {numbers.map((num, i) => (
        <button
          key={num + i}
          type="button"
          className="preview-indicator-link"
          onClick={() => jumpToIndicator(num)}
        >
          {num}
          {i < numbers.length - 1 ? ", " : ""}
        </button>
      ))}
    </>
  );
const handleToggleLock = async () => {
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  const nextStatus: "draft" | "saved" =
    observationStatus === "draft" ? "saved" : "draft";

  const payload: SavedObservationPayload = {
    id: observationMeta.id,
    meta: {
      teacherName,
      schoolName,
      campus,
      unit,
      lesson,
      supportType,
      date,
    },
    indicators,
    status: nextStatus,
    updatedAt: Date.now(),
    scratchpadText,
  };

  await persistObservation(payload);

  setObservationStatus(nextStatus);
  setLastSavedAt(payload.updatedAt);
  setSaveStatus(nextStatus === "saved" ? "saved" : "idle");
};


  return (
    <div className="workspace-root">
      <div className="workspace-top-bar">
        <div className="workspace-top-meta">
          <div className="workspace-top-line">
            <button className="btn" onClick={handleBackToDashboard} type="button">
              ← Back to Dashboard
            </button>
          </div>
          <div className="workspace-top-line">
            <strong>{teacherName}</strong> • {schoolName} – {campus}
          </div>
          <div className="workspace-top-sub">
            Unit {unit} – Lesson {lesson} • Support type: {supportType}
          </div>
        </div>
        <div className="workspace-btn-group">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn"
                type="button"
                onClick={handleManualSave}
                disabled={isLocked}
              >
                Save
              </button>

              <button
                className="btn"
                type="button"
                onClick={handleToggleLock}
                style={{ fontWeight: 600 }}
              >
                {isLocked ? "Reopen as Draft" : "Mark Completed / Lock"}
              </button>

              {/* 🔍 PREVIEWS */}
              <button className="btn" type="button" onClick={handleExportPreview}>
                Preview (teacher)
              </button>

              <button className="btn" type="button" onClick={handleAdminPreview}>
                Preview (admin)
              </button>

              {/* EXPORT */}
              <button className="btn" type="button" onClick={handleExportTeacher}>
                Export (teacher)
              </button>

              <button className="btn" type="button" onClick={handleExportAdmin}>
                Export (admin)
              </button>

              {/* SCRATCHPAD */}
              <button
                className="btn"
                type="button"
                onClick={() => setShowScratchpad(true)}
              >
                Scratchpad
              </button>
            </div>

            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                textAlign: "right",
              }}
            >
              {lastSavedAt
                ? saveStatus === "saved"
                  ? `Saved ✔ at ${new Date(lastSavedAt).toLocaleTimeString()}`
                  : `Auto-saved at ${new Date(lastSavedAt).toLocaleTimeString()}`
                : "Auto-save enabled"}
            </div>
          </div>
        </div>

      </div>

      <section className="main-layout">
        {/* LEFT: indicators list OR collapsed toggle */}
        {sidebarCollapsed ? (
          <div className="indicator-collapse-toggle">
            <button
              type="button"
              onClick={() => {
                setSidebarCollapsed(false);
                // Again, force a resize so canvas recomputes width/height
                window.dispatchEvent(new Event("resize"));
              }}
              title="Expand indicators"
            >
              Indicators ▸
            </button>
          </div>
        ) : (
          <div className="indicator-panel">
            <div className="indicator-panel-header">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Indicators</div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  Tap to switch, mark Good / Growth, or insert a comment.
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  className="select"
                  value={filterMode}
                  onChange={(e) =>
                    setFilterMode(e.target.value as "all" | "good" | "growth")
                  }
                >
                  <option value="all">All</option>
                  <option value="good">Good points</option>
                  <option value="growth">Growth areas</option>
                  <option value="favorites">Favorites ⭐</option>
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSidebarCollapsed(true);
                    // Tell CanvasPad its container size changed
                    window.dispatchEvent(new Event("resize"));
                  }}
                  title="Collapse indicators"
                >
                  ⮜
                </button>
              </div>
            </div>

            <div className="indicator-list">
              {indicators.map((ind, idx) => {
                // Apply filter
                if (filterMode === "good" && !ind.good) return null;
                if (filterMode === "growth" && !ind.growth) return null;
                if (filterMode === "favorites" && !ind.favorite) return null;

                const hasInk = ind.strokes?.some((s) => s.points && s.points.length > 0);
                const hasOcr = !!ind.ocrUsed;
                const hasComment = ind.commentText.trim().length > 0;

                return (
                  <div
                    key={ind.id}
                    data-indicator-id={ind.id}
                    className={`indicator-row ${idx === activeIndex ? "active" : ""}`}
                    onClick={() => {
                      if (canvasDirty) {
                        handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
                        setCanvasDirty(false);
                      }
                      setActiveIndex(idx);
                    }}
                  >
                    <div>
                      <div className="indicator-title">
                        <strong>{ind.number}</strong> — {ind.title}
                      </div>
                      <div
                        className={
                          expandedDesc[ind.id]
                            ? "indicator-desc expanded"
                            : "indicator-desc collapsed"
                        }
                      >
                        {ind.description}
                      </div>

                      <button
                        type="button"
                        className="desc-toggle-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDescription(ind.id);
                        }}
                      >
                        {expandedDesc[ind.id] ? "Show less" : "Show more"}
                      </button>
                    </div>

                   <div className="indicator-actions">
                    {/* status dots: ink / text / OCR */}
                    <div className="indicator-status-dots"
                        onClick={(e) => e.stopPropagation()}
                        title={[
                          (ind.strokes && ind.strokes.length > 0) ? "Has handwriting" : "",
                          ind.commentText?.trim().length > 0 ? "Has comment" : "",
                          ind.ocrUsed ? "OCR has been run" : "",
                        ].filter(Boolean).join(" • ")}
                    >
                      {ind.strokes && ind.strokes.length > 0 && (
                        <span className="indicator-dot indicator-dot-ink" />
                      )}
                      {ind.commentText && ind.commentText.trim().length > 0 && (
                        <span className="indicator-dot indicator-dot-comment" />
                      )}
                      {ind.ocrUsed && (
                        <span className="indicator-dot indicator-dot-ocr" />
                      )}
                    </div>

                    {/* Favorite toggle */}
                    <button
                      type="button"
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(idx);
                      }}
                      title={ind.favorite ? "Unfavorite" : "Mark as favorite"}
                    >
                      {ind.favorite ? "⭐" : "☆"}
                    </button>

                    <button
                      type="button"
                      className={`btn rating-btn rating-good ${
                        ind.good ? "rating-selected" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGood(idx);
                      }}
                      title="Mark as Good point"
                    >
                      ✓
                    </button>

                    <button
                      type="button"
                      className={`btn rating-btn rating-growth ${
                        ind.growth ? "rating-selected" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGrowth(idx);
                      }}
                      title="Mark as Growth area"
                    >
                      ✕
                    </button>

                    {ind.hasPreComment && (
                      <button
                        type="button"
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertPreComment(idx);
                        }}
                        title="Insert pre-created comment"
                      >
                        💬
                      </button>
                    )}

                    {/* 🆕 Trainer summary checkbox */}
                    <label
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginLeft: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        color: "var(--text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!ind.includeInTrainerSummary}
                        onChange={() => toggleIncludeInTrainerSummary(idx)}
                        style={{ width: 12, height: 12 }}
                      />
                      <span>Trainer summary</span>
                    </label>
                  </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* RIGHT: active indicator + comments (canvas placeholder for now) */}
        <div className="workspace-container">
          <div className="canvas-card">
            <div className="canvas-header">
              <div>
                <div className="canvas-indicator-title">
                  {active.number} — {active.title}
                </div>
                <div
                  className={
                    expandedDesc[active.id]
                      ? "canvas-indicator-desc expanded"
                      : "canvas-indicator-desc collapsed"
                  }
                >
                  {active.description}
                </div>

                <button
                  type="button"
                  className="desc-toggle-btn"
                  onClick={() => toggleDescription(active.id)}
                >
                  {expandedDesc[active.id] ? "Show less" : "Show more"}
                </button>
              </div>
            </div>

            {/* QUICK JUMP DROPDOWN */}
            <div className="quick-jump">
              <label className="quick-jump-label">Jump to:</label>
              <select
                className="quick-jump-select"
                value={activeIndex}
                onChange={(e) => setActiveIndex(Number(e.target.value))}
              >
                {indicators.map((i, idx) => (
                  <option key={i.id} value={idx}>
                    {i.number} — {i.title}
                  </option>
                ))}
              </select>
            </div>

            <CanvasPad
            strokes={active.strokes}
            onChange={(s) => handleStrokesChange(activeIndex, s)}
            readOnly={isLocked}
          />


            {/* 🔤 Manual OCR button */}
            <div
              style={{
                marginTop: 8,
                marginBottom: 8,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  marginTop: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleConvertHandwritingToText}
                    disabled={
  isOcrRunning ||
  !active.strokes ||
  !active.strokes.some(s => s.points && s.points.length > 0)
}
                  >
                    {isOcrRunning
                      ? "Converting…"
                      : "Convert handwriting to text (OCR)"}
                  </button>

                  {active.ocrPendingReview && (
                    <span className="ocr-pill ocr-pill-pending">Needs review</span>
                  )}

                  {typeof active.ocrLastConfidence === "number" &&
                    active.ocrLastConfidence < 0.8 && (
                      <span className="ocr-pill ocr-pill-low">
                        Low-confidence OCR
                      </span>
                    )}
                </div>

                {ocrError && <div className="ocr-error">{ocrError}</div>}
              </div>

              {active.ocrUsed && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    alignSelf: "center",
                    textAlign: "right",
                  }}
                >
                  OCR triggered on this indicator
                </div>
              )}
            </div>

                      <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 12,
                marginBottom: 4,
                color: active.ocrPendingReview ? "#facc15" : "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              {active.ocrPendingReview ? (
                <>
                  <span>
                    OCR text added – please review. Yellow highlight will disappear
                    once you confirm it looks good.
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      lineHeight: 1.4,
                    }}
                    onClick={handleMarkOcrReviewed}
                  >
                    ✅ Mark as reviewed
                  </button>
                </>
              ) : (
                "Comments for this indicator"
              )}
            </div>

            <textarea
              value={active.commentText}
              onChange={(e) => handleCommentChange(activeIndex, e.target.value)}
              rows={5}
              readOnly={isLocked}
              style={{
                width: "100%",
                resize: "vertical",
                borderRadius: 10,
                border: active.ocrPendingReview
                  ? "1px solid rgba(250, 204, 21, 0.9)"
                  : "1px solid rgba(51,65,85,0.9)",
                background: active.ocrPendingReview ? "#3b3a1a" : "#020617",
                boxShadow: active.ocrPendingReview
                  ? "0 0 0 1px rgba(250, 204, 21, 0.4)"
                  : "none",
                color: "var(--text)",
                padding: 8,
                fontSize: 13,
              }}
            />
          </div>

            {showExportPreview &&
              exportPreview &&
              (() => {
                // 1️⃣ Detect if this preview has any *unreviewed* OCR text.
              // We look at live indicator state, not just "[OCR]" tags in the model.
              // 1️⃣ Collect indicators that have *unreviewed* OCR text.
            const unreviewedOcrIndicators = indicators.filter(
              (ind) => ind.ocrUsed && ind.ocrPendingReview
            );
            const hasUnreviewedOcr = unreviewedOcrIndicators.length > 0;

                // 2️⃣ Build warning buckets from the live indicators state
                const growthWithoutComment = indicators.filter((ind) => {
                  const hasComment = ind.commentText.trim().length > 0;
                  return ind.growth && !hasComment;
                });

                const goodTemplateOnly = indicators.filter((ind) => {
                  const hasComment = ind.commentText.trim().length > 0;
                  const hasTemplate = !!ind.preComment;
                  return ind.good && !hasComment && hasTemplate;
                });

                const uncheckedIndicators = indicators.filter(
                  (ind) => !ind.good && !ind.growth
                );

                const inkNotChecked = indicators.filter((ind) => {
                const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
                return hasInk && !ind.good && !ind.growth;
              });

                const inkNotConverted = indicators.filter((ind) => {
                const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
                return hasInk && !ind.ocrUsed; // ❗ no good/growth requirement
              });

              // 🔢 Fast lookup sets by indicator number
              const growthNoCommentNums = new Set(
                growthWithoutComment.map((ind) => ind.number)
              );
              const goodTemplateOnlyNums = new Set(
                goodTemplateOnly.map((ind) => ind.number)
              );
              const inkNotConvertedNums = new Set(
                inkNotConverted.map((ind) => ind.number)
              );

                const anyWarnings =
                  growthWithoutComment.length > 0 ||
                  goodTemplateOnly.length > 0 ||
                  uncheckedIndicators.length > 0 ||
                  inkNotChecked.length > 0 ||
                  inkNotConverted.length > 0;

                return (
                  <div className="export-preview-panel">
                    {/* 🔤 OCR banner – only if some OCR is still pending review */}
                    {hasUnreviewedOcr && (
                    <div className="export-ocr-banner">
                      ⚠ This preview includes OCR text that hasn&apos;t been marked as reviewed yet in:{" "}
                      {renderIndicatorLinks(unreviewedOcrIndicators.map((ind) => ind.number))}
                      . Please double-check those comments before sending to the teacher.
                    </div>
                  )}

                    {/* ⚠️ NEW: high-level preview warnings */}
                    {anyWarnings && (
                      <div className="export-warning-banner">
                        {growthWithoutComment.length > 0 && (
                          <div className="export-warning-line">
                            ⚠ Growth marked but no written comment:{" "}
                            {renderIndicatorLinks(
                              growthWithoutComment.map((ind) => ind.number)
                            )}
                          </div>
                        )}

                        {goodTemplateOnly.length > 0 && (
                          <div className="export-warning-line">
                            ℹ Good points using only pre-created comments (template only):
                            {" "}
                            <strong>{renderClickableList(goodTemplateOnly)}</strong>
                            <button
                              type="button"
                              className="btn"
                              style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11 }}
                              onClick={insertDefaultCommentsForGood}
                            >
                              Insert default comments
                            </button>
                          </div>
                        )}

                        {uncheckedIndicators.length > 0 && (
                          <div className="export-warning-line">
                            ⚠ Indicators not marked Good or Growth:{" "}
                            {renderIndicatorLinks(
                              uncheckedIndicators.map((ind) => ind.number)
                            )}
                          </div>
                        )}

                        {inkNotChecked.length > 0 && (
                          <div className="export-warning-line">
                            ⚠ Indicators have handwriting but no Good/Growth
                            selected:{" "}
                            {renderIndicatorLinks(
                              inkNotChecked.map((ind) => ind.number)
                            )}
                          </div>
                        )}

                        {inkNotConverted.length > 0 && (
                        <div className="export-warning-line">
                          ⚠ Indicators have handwriting, but OCR not run yet:{" "}
                          {renderIndicatorLinks(
                            inkNotConverted.map((ind) => ind.number)
                          )}

                          <button
                            type="button"
                            className="btn"
                            style={{
                              marginLeft: 8,
                              padding: "2px 6px",
                              fontSize: 11,
                              lineHeight: 1.3,
                            }}
                            onClick={handleBulkOcrForMissing}
                          >
                            Convert all ↓
                          </button>
                        </div>
                      )}
                      </div>
                    )}

                    {/* 👇 original Teacher preview content */}
                    <div className="export-preview-header">
                      <div>
                        <div className="export-preview-title">
                          Teacher export preview
                        </div>
                        <div className="export-preview-sub">
                          {exportPreview.teacherName} •{" "}
                          {exportPreview.schoolName}{" "}
                          {exportPreview.fileDate
                            ? `• ${exportPreview.fileDate}`
                            : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setShowExportPreview(false)}
                      >
                        Close
                      </button>
                    </div>

                    <div className="export-preview-table">
                    {exportPreview.rows.map((row) => {
                      const indicatorNum = row.indicatorLabel;

                      const isGrowthNoComment = growthNoCommentNums.has(indicatorNum);
                      const isTemplateOnly = goodTemplateOnlyNums.has(indicatorNum);
                      const isInkNotConverted = inkNotConvertedNums.has(indicatorNum);

                      const rowClassName = [
                        "export-preview-row",
                        (isGrowthNoComment || isTemplateOnly || isInkNotConverted)
                          ? "export-preview-row-flagged"
                          : "",
                        isGrowthNoComment ? "export-preview-row-flagged-growth" : "",
                        isTemplateOnly ? "export-preview-row-flagged-template" : "",
                        isInkNotConverted ? "export-preview-row-flagged-ocr" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <div key={row.rowIndex} className={rowClassName}>
                          {/* LEFT COLUMN: indicator + description */}
                          <div className="export-preview-left">
                            <div className="export-preview-indicator">
                              <strong>{row.indicatorLabel}</strong>
                            </div>
                            <div className="export-preview-description">
                              {row.description}
                            </div>
                          </div>

                          {/* RIGHT COLUMN: status + strengths + growths */}
                          <div className="export-preview-right">
                            {(row.status || row.strengths || row.growths) && (
                              <div className="export-preview-status-line">
                                {row.status && (
                                  <span
                                    className={
                                      "export-status-pill " +
                                      (row.status === "Done"
                                        ? "export-status-done"
                                        : row.status === "Pending"
                                        ? "export-status-pending"
                                        : "")
                                    }
                                  >
                                    {row.status}
                                  </span>
                                )}

                                <div className="export-preview-tags">
                                  {row.strengths && row.strengths.trim().length > 0 && (
                                    <span className="export-tag-good">✓ Good</span>
                                  )}
                                  {row.growths && row.growths.trim().length > 0 && (
                                    <span className="export-tag-growth">✕ Growth</span>
                                  )}
                                </div>
                              </div>
                            )}

                            {row.strengths && row.strengths.trim().length > 0 && (
                              <div className="export-preview-block">
                                <div className="export-preview-label export-label-good">
                                  Teacher&apos;s Strengths
                                </div>
                                <div className="export-preview-text">{row.strengths}</div>
                              </div>
                            )}

                            {row.growths && row.growths.trim().length > 0 && (
                              <div className="export-preview-block">
                                <div className="export-preview-label export-label-growth">
                                  Teacher&apos;s Growth Areas
                                </div>
                                <div className="export-preview-text">{row.growths}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                );
              })()}

            {showAdminPreview && adminPreview && (
              <div className="export-preview-panel admin-preview">
                <div className="export-preview-header">
                  <div>
                    <div className="export-preview-title">
                      Admin export preview
                    </div>
                    <div className="export-preview-sub">
                      {adminPreview.schoolName} • {adminPreview.teacherName}
                      {adminPreview.fileDate
                        ? ` • ${adminPreview.fileDate}`
                        : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAdminPreview(false)}
                  >
                    Close
                  </button>
                </div>
                {/* 🆕 Trainer summary section (mapped to merged cell E5–E18) */}
                <div
                  style={{
                    marginBottom: 16,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    background: "rgba(15, 23, 42, 0.9)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Trainer summary (Admin sheet – merged cell E5–E18)
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginBottom: 6,
                    }}
                  >
                    Built automatically from indicators you checked as{" "}
                    <em>Trainer summary</em>. You can edit / translate it here before
                    exporting.
                  </div>
                  <textarea
                    value={adminPreview.trainerSummary ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAdminPreview((prev) =>
                        prev ? { ...prev, trainerSummary: value } : prev
                      );
                    }}
                    rows={4}
                    style={{
                      width: "100%",
                      resize: "vertical",
                      borderRadius: 8,
                      border: "1px solid rgba(51,65,85,0.9)",
                      background: "#020617",
                      color: "var(--text)",
                      padding: 8,
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  />
                </div>            
                <div className="export-preview-table">
                  {adminPreview.rows.map((row) => (
                    <div
                      key={row.rowIndex}
                      className="export-preview-row admin-row"
                    >
                      {/* Left: category + aspect */}
                      <div className="export-preview-indicator">
                        <div className="admin-main-category">
                          {row.mainCategory}
                        </div>
                        <div className="admin-aspect">{row.aspect}</div>
                      </div>

                      {/* Middle: VN classroom signs (read-only) */}
                      <div className="export-preview-description">
                        {row.classroomSigns}
                      </div>

                      {/* Rating (still read-only for now, coming from export model) */}
                      <div className="export-preview-status">
                        {row.trainerRating || "\u00A0"}
                      </div>

                      {/* 🆕 Trainer notes: editable textarea */}
                      <div className="export-preview-notes">
                        <textarea
                          value={row.trainerNotes}
                          onChange={(e) => {
                            const value = e.target.value;
                            setAdminPreview((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                rows: prev.rows.map((r) =>
                                  r.rowIndex === row.rowIndex
                                    ? { ...r, trainerNotes: value }
                                    : r
                                ),
                              };
                            });
                          }}
                          rows={3}
                          style={{
                            width: "100%",
                            resize: "vertical",
                            borderRadius: 8,
                            border: "1px solid rgba(51,65,85,0.9)",
                            background: "#020617",
                            color: "var(--text)",
                            padding: 6,
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {showScratchpad && (
        <div className="scratchpad-backdrop">
          <div className="scratchpad-modal">
            <div className="scratchpad-header">
              <div>
                <div className="scratchpad-title">Scratchpad</div>
                <div className="scratchpad-sub">
                  Free notes – not exported, just for you.
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setShowScratchpad(false)}
              >
                Close
              </button>
            </div>

            <textarea
              value={scratchpadText}
              onChange={(e) => setScratchpadText(e.target.value)}
              rows={10}
              style={{
                width: "100%",
                resize: "vertical",
                borderRadius: 10,
                border: "1px solid rgba(51,65,85,0.9)",
                background: "#020617",
                color: "var(--text)",
                padding: 10,
                fontSize: 13,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};