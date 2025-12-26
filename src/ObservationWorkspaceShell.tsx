// src/ObservationWorkspaceShell.tsx
import { exportTeacherExcel } from "./exportTeacherExcel";
import { CanvasPad } from "./CanvasPad";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { exportAdminExcel } from "./exportAdminExcel"; 
import { emailTeacherReport } from "./emailTeacherReport";

const CANVAS_HEIGHT_STORAGE_KEY = "canvas-pad-height";
const DEFAULT_CANVAS_HEIGHT = 300; 
const MIN_CANVAS_HEIGHT = 100; 

const TEXTAREA_HEIGHT_STORAGE_KEY = "textarea-height";
const DEFAULT_TEXTAREA_HEIGHT = 120;
const MIN_TEXTAREA_HEIGHT = 60;

function getPersistedCanvasHeight(): number {
  if (typeof window === "undefined") return DEFAULT_CANVAS_HEIGHT;
  try {
    const raw = localStorage.getItem(CANVAS_HEIGHT_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : DEFAULT_CANVAS_HEIGHT;
    return isNaN(parsed) ? DEFAULT_CANVAS_HEIGHT : Math.max(MIN_CANVAS_HEIGHT, parsed);
  } catch (error) {
    console.error("Failed to read persisted canvas height", error);
    return DEFAULT_CANVAS_HEIGHT;
  }
}

function setPersistedCanvasHeight(height: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CANVAS_HEIGHT_STORAGE_KEY, height.toString());
  } catch (error) {
    console.error("Failed to write persisted canvas height", error);
  }
}

function getPersistedTextareaHeight(): number {
  if (typeof window === "undefined") return DEFAULT_TEXTAREA_HEIGHT;
  try {
    const raw = localStorage.getItem(TEXTAREA_HEIGHT_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : DEFAULT_TEXTAREA_HEIGHT;
    return isNaN(parsed) ? DEFAULT_TEXTAREA_HEIGHT : Math.max(MIN_TEXTAREA_HEIGHT, parsed);
  } catch (error) {
    console.error("Failed to read persisted textarea height", error);
    return DEFAULT_TEXTAREA_HEIGHT;
  }
}

function setPersistedTextareaHeight(height: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TEXTAREA_HEIGHT_STORAGE_KEY, height.toString());
  } catch (error) {
    console.error("Failed to write persisted textarea height", error);
  }
}

const MERGE_SERVER_BASE = import.meta.env.VITE_MERGE_SERVER_BASE; 

import {
  loadObservationFromDb,
  saveObservationToDb,
  saveAdminSummaryToDb
} from "./db/observations";

import type {
  ObservationMetaForExport,
  IndicatorStateForExport,
  TeacherExportModel,
} from "./exportTeacherModel";

import { buildTeacherExportModel } from "./exportTeacherModel";
import { buildAdminExportModel } from "./exportAdminModel";
import type { AdminExportModel } from "./exportAdminModel";
import { polishTextWithGroq, polishBatchWithGroq } from "./utils/gemini";

interface ObservationWorkspaceProps {
  observationMeta: {
    id: string;
    teacherName: string;
    schoolName: string;
    campus: string;
    unit: string;
    lesson: string;
    supportType: "Training" | "LVA" | "Visit";
    date: string; 
  };
  onBack: () => void;
  isOnline: boolean;
  isSyncing: boolean;
  setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
}

interface OcrResult {
  text: string;
  confidence: number;
}

interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  color: string;
  size: number;
  points: StrokePoint[];
  mode: "pen" | "eraser";
}

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
  ocrUsed?: boolean;
  ocrLastRunAt?: number | null;
  ocrLastConfidence?: number | null; 
  ocrPendingReview?: boolean;        
  includeInTrainerSummary?: boolean;  
  aiPendingReview?: boolean;
}

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
    teacherWorkbookUrl?: string | null;
    adminWorkbookUrl?: string | null;
    adminWorkbookViewUrl?: string | null;
    mergedTeacher?: { url: string; sheetName?: string; mergedAt?: string } | null;
    mergedAdmin?: { url: string; sheetName?: string; mergedAt?: string } | null;
  };
  indicators: IndicatorState[];
  status: "draft" | "saved";
  updatedAt: number;
  scratchpadText?: string;
  isGood?: boolean;
  isBad?: boolean;
  isFavorite?: boolean;
}

const STORAGE_PREFIX = "obs-v1-";

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
    title: "Classroom Routines & Management Strategies",
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
    title: "Utilizing Lesson Plans",
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

// 🟢 UPDATED: Includes RESIZING to max 1024px width + JPEG Compression
async function strokesToPngBase64(strokes: Stroke[]): Promise<string> {
  if (!strokes.length) {
    throw new Error("No strokes to convert");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas not supported");
  }

  // 1. Calculate Bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

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
  const originalWidth = Math.max(1, Math.round(maxX - minX + margin * 2));
  const originalHeight = Math.max(1, Math.round(maxY - minY + margin * 2));

  // 2. Calculate Scale Factor (Downscale if width > 1024px)
  const MAX_WIDTH = 1024;
  let scale = 1;
  if (originalWidth > MAX_WIDTH) {
    scale = MAX_WIDTH / originalWidth;
  }

  // 3. Set Canvas Dimensions (Applied Scale)
  canvas.width = originalWidth * scale;
  canvas.height = originalHeight * scale;

  // 4. Draw Background (Solid Color for JPEG)
  // Use the exact dark color from the app theme so strokes look correct
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 5. Apply Scaling to the Context
  // This automatically shrinks all drawing operations below
  ctx.scale(scale, scale);

  // 6. Draw Strokes
  // We draw them as if they were the original size, shifted by minX/minY.
  // The ctx.scale() above handles the shrinking.
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    
    const first = stroke.points[0];
    ctx.moveTo(first.x - minX + margin, first.y - minY + margin);
    
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      ctx.lineTo(p.x - minX + margin, p.y - minY + margin);
    }
    
    // Scale line width too, otherwise thin lines might disappear when shrunk
    ctx.lineWidth = stroke.size || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color || "#ffffff";
    ctx.stroke();
  }

  // 7. Export Compressed JPEG
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  
  // Remove prefix
  const base64 = dataUrl.split(",")[1];
  
  return base64;
}

/**
 * runOcrOnStrokes with Automatic Retry logic
 */
async function runOcrOnStrokes(strokes: Stroke[]): Promise<OcrResult> {
  if (!MERGE_SERVER_BASE) {
    console.error("VITE_MERGE_SERVER_BASE is missing. Cannot perform OCR.");
    return { text: "Error: Server base URL is not configured.", confidence: 0 };
  }

  const MAX_RETRIES = 2;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutDuration = attempt === 1 ? 15000 : 20000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

    try {
      console.log(`OCR Attempt ${attempt}/${MAX_RETRIES}...`);
      
      // 🟢 The optimization happens here inside strokesToPngBase64
      const imageBase64 = await strokesToPngBase64(strokes);

      const response = await fetch(`${MERGE_SERVER_BASE}/api/ocr-gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data: { text?: string; confidence?: number } = await response.json();
      return {
        text: data.text ?? "",
        confidence: typeof data.confidence === "number" ? data.confidence : 0.7,
      };

    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err.name === 'AbortError' ? "Network Timeout" : err.message;
      
      console.warn(`OCR Attempt ${attempt} failed: ${lastError}`);
      
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  return { 
    text: `Error: OCR failed after ${MAX_RETRIES} attempts. (${lastError})`, 
    confidence: 0 
  };
}

function normalizeIndicators(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.indicators)) return raw.indicators;
  return [];
}

function hasUserProgress(indicators: IndicatorState[]): boolean {
  return indicators.some(ind => {
    const hasMark = ind.good || ind.growth || ind.favorite;
    const hasComment = ind.commentText.trim().length > 0;
    const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
    return hasMark || hasComment || hasInk;
  });
}

export const ObservationWorkspaceShell: React.FC<
  ObservationWorkspaceProps
> = ({ observationMeta, onBack, isOnline, isSyncing, setIsSyncing }) => {
  const { teacherName, schoolName, campus, unit, lesson, supportType, date } =
    observationMeta;

const [showBatchModal, setShowBatchModal] = useState(false);
const [batchCandidates, setBatchCandidates] = useState<{id: string, number: string, title: string, text: string}[]>([]);
const [isAiPolishing, setIsAiPolishing] = useState(false);
const storageKey = `${STORAGE_PREFIX}${observationMeta.id}`;

const [isCanvasVisible, setIsCanvasVisible] = useState(true); 
const [textAreaHeight, setTextAreaHeight] = useState(getPersistedTextareaHeight);
const [isTextareaResizing, setIsTextareaResizing] = useState(false);
const textareaRef = useRef<HTMLTextAreaElement>(null);

const [canvasHeight, setCanvasHeight] = useState(getPersistedCanvasHeight);
const [isResizing, setIsResizing] = useState(false);
const canvasWrapperRef = useRef<HTMLDivElement>(null);
const startYRef = useRef(0);
const startHeightRef = useRef(0);

const doCanvasResize = useCallback(
  (e: MouseEvent | TouchEvent) => {
    if (!isResizing || !canvasWrapperRef.current) return;
    const currentY =
      (e as MouseEvent).clientY ?? (e as TouchEvent).touches[0].clientY;
    
    const rect = canvasWrapperRef.current.getBoundingClientRect();
    let newHeight = currentY - rect.top;
    newHeight = Math.max(MIN_CANVAS_HEIGHT, newHeight);

    setCanvasHeight(newHeight);
  },
  [isResizing]
);

const stopCanvasResize = useCallback(() => {
  if (isResizing) {
    setIsResizing(false);
    setPersistedCanvasHeight(canvasHeight);
    window.dispatchEvent(new Event("resize"));
  }
}, [isResizing, canvasHeight]);

const startCanvasResize = useCallback(
  (e: React.MouseEvent | React.TouchEvent) => {
    const isMouseEvent = (e as React.MouseEvent).button !== undefined;
    if (isMouseEvent && (e as React.MouseEvent).button !== 0) return;
    
    if ((e as React.TouchEvent).touches) {
      e.preventDefault();
    }
    
    const currentY =
      (e as React.MouseEvent).clientY ?? (e as React.TouchEvent).touches[0].clientY;

    startYRef.current = currentY;
    startHeightRef.current = canvasHeight; 
    setIsResizing(true);
  },
  [canvasHeight]
);

const doTextareaResize = useCallback(
  (e: MouseEvent | TouchEvent) => {
    if (!isTextareaResizing || !textareaRef.current) return;

    const currentY =
      (e as MouseEvent).clientY ?? (e as TouchEvent).touches[0].clientY;

    const rect = textareaRef.current.getBoundingClientRect();
    let newHeight = currentY - rect.top;

    newHeight = Math.max(MIN_TEXTAREA_HEIGHT, newHeight);

    setTextAreaHeight(newHeight);
  },
  [isTextareaResizing]
);

const stopTextareaResize = useCallback(() => {
  if (isTextareaResizing) {
    setIsTextareaResizing(false);
    setPersistedTextareaHeight(textAreaHeight);
  }
}, [isTextareaResizing, textAreaHeight]);

const startTextareaResize = useCallback(
  (e: React.MouseEvent | React.TouchEvent) => {
    const isMouseEvent = (e as React.MouseEvent).button !== undefined;
    if (isMouseEvent && (e as React.MouseEvent).button !== 0) return;

    if ((e as React.TouchEvent).touches) {
      e.preventDefault();
    }

    setIsTextareaResizing(true);
  },
  []
);

useEffect(() => {
  if (isResizing) {
    window.addEventListener("mousemove", doCanvasResize);
    window.addEventListener("mouseup", stopCanvasResize);
    window.addEventListener("touchmove", doCanvasResize);
    window.addEventListener("touchend", stopCanvasResize);
  }

  if (isTextareaResizing) {
    window.addEventListener("mousemove", doTextareaResize);
    window.addEventListener("mouseup", stopTextareaResize);
    window.addEventListener("touchmove", doTextareaResize);
    window.addEventListener("touchend", stopTextareaResize);
  }

  return () => {
    window.removeEventListener("mousemove", doCanvasResize);
    window.removeEventListener("mouseup", stopCanvasResize);
    window.removeEventListener("touchmove", doCanvasResize);
    window.removeEventListener("touchend", stopCanvasResize);
    window.removeEventListener("mousemove", doTextareaResize);
    window.removeEventListener("mouseup", stopTextareaResize);
    window.removeEventListener("touchmove", doTextareaResize);
    window.removeEventListener("touchend", stopTextareaResize);
  };
}, [
  isResizing, doCanvasResize, stopCanvasResize, 
  isTextareaResizing, doTextareaResize, stopTextareaResize
]);

const [indicators, setIndicators] =
  useState<IndicatorState[]>(INITIAL_INDICATORS);
const [activeIndex, setActiveIndex] = useState(0);
  const [observationStatus, setObservationStatus] = useState<"draft" | "saved">(
    "draft"
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const isLocked = observationStatus === "saved";
  const [isGood, setIsGood] = useState(false);
  const [isBad, setIsBad] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
const [adminSummaryVN, setAdminSummaryVN] = useState<string | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [filterMode, setFilterMode] = useState<"all" | "good" | "growth" | "favorites">(
  "all"
);


  const [expandedDesc, setExpandedDesc] = useState<Record<string, boolean>>({});
  const [scratchpadText, setScratchpadText] = useState<string>("");
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [exportPreview, setExportPreview] = useState<TeacherExportModel | null>(null);
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

useEffect(() => {
  let cancelled = false;

  async function load() {
    let localData: SavedObservationPayload | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) localData = JSON.parse(raw);
    } catch (err) { console.error("Local read error", err); }

    try {
      const row = await loadObservationFromDb(observationMeta.id);
      if (cancelled) return;

      const dbUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const localUpdatedAt = localData?.updatedAt ?? 0;

      if (localData && localUpdatedAt > dbUpdatedAt) {
        console.log("Using newer local data.");
        setIndicators(localData.indicators);
        setObservationStatus(localData.status ?? "draft");
        setIsGood(localData.isGood ?? false);
        setIsBad(localData.isBad ?? false);
        setIsFavorite(localData.isFavorite ?? false);
        setScratchpadText(localData.scratchpadText ?? "");
        return; 
      }

      const normalizedFromDb = normalizeIndicators(row.indicators);
      setIndicators(normalizedFromDb.length > 0 ? normalizedFromDb : INITIAL_INDICATORS);
      setObservationStatus(row.status ?? "draft");
      setAdminSummaryVN(row.admin_summary_vn ?? null);
      setIsGood(row.is_good ?? false);
      setIsBad(row.is_bad ?? false);
      setIsFavorite(row.is_favorite ?? false);

    } catch (err) {
      console.warn("Offline: Using local backup.");
      if (localData && !cancelled) {
        setIndicators(localData.indicators);
        setObservationStatus(localData.status ?? "draft");
        setIsGood(localData.isGood ?? false);
        setIsBad(localData.isBad ?? false);
        setIsFavorite(localData.isFavorite ?? false);
        setScratchpadText(localData.scratchpadText ?? "");
      } else if (!cancelled) {
        setIndicators(INITIAL_INDICATORS);
      }
    }
  }
  load();
  return () => { cancelled = true; };
}, [storageKey, observationMeta.id]);

useEffect(() => {
  if (isOnline && observationMeta.id) {
    const performSync = async () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return; 

        const localData: SavedObservationPayload = JSON.parse(raw);
        
        setIsSyncing(true); 
        
        await saveObservationToDb({
          id: localData.id,
          status: localData.status,
          meta: localData.meta,
          indicators: localData.indicators,
        });

        console.log("✅ Auto-sync successful!");
        setSaveStatus("saved"); 
      } catch (err) {
        console.error("❌ Auto-sync failed", err);
      } finally {
        setIsSyncing(false); 
      }
    };

    performSync();
  }
}, [isOnline, observationMeta.id, storageKey, setIsSyncing]);

const persistObservation = React.useCallback(
  async (payload: SavedObservationPayload) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setLastSavedAt(payload.updatedAt); 
    } catch (err) {
      console.error("Failed to write to localStorage", err);
    }

    try {
      await saveObservationToDb({
        id: payload.id,
        status: payload.status,
        meta: payload.meta,
        indicators: payload.indicators,
      });
      setSaveStatus("saved");
    } catch (err) {
      console.error("[Workspace] Sync failed", err);
    }
  },
  [storageKey]
);

useEffect(() => {
  if (!observationMeta.id) return;

  if (saveTimeoutRef.current) {
    window.clearTimeout(saveTimeoutRef.current);
  }

  saveTimeoutRef.current = window.setTimeout(() => {
    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: { teacherName, schoolName, campus, unit, lesson, supportType, date },
      indicators,
      status: observationStatus,
      updatedAt: Date.now(),
      scratchpadText,
      isGood, isBad, isFavorite,
    };

    persistObservation(payload);
    setCanvasDirty(false);
  }, 800);

  return () => {
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
  };
}, [
  indicators, scratchpadText, observationMeta, teacherName, schoolName, 
  campus, unit, lesson, supportType, observationStatus, 
  isGood, isBad, isFavorite, persistObservation
]);

  const handleBatchPolishClick = () => {
    const candidates = indicators
      .filter(
        (ind) =>
          ind.commentText.trim().length > 3 && 
          !ind.aiPendingReview &&             
          !ind.ocrPendingReview               
      )
      .map(ind => ({
        id: ind.id,
        number: ind.number,
        title: ind.title,
        text: ind.commentText
      }));

    if (candidates.length === 0) {
      alert("No unpolished comments found! (Already polished items are skipped)");
      return;
    }

    setBatchCandidates(candidates);
    setShowBatchModal(true);
  };

const executeBatchPolish = async () => {
  setIsAiPolishing(true);
  setShowBatchModal(false); 

  try {
    const batchItems = batchCandidates.map(c => ({
      id: c.id,
      text: c.text 
    }));

    const results = await polishBatchWithGroq(batchItems);

    setIndicators(prev => prev.map(ind => {
      const polishedText = results[ind.id];
      if (polishedText) {
        return {
          ...ind,
          commentText: polishedText,
          aiPendingReview: true 
        };
      }
      return ind;
    }));
    
  } catch (err: any) {
    console.error("Batch polish failed", err);
    alert("Batch polish failed. Please try doing them individually.");
  } finally {
    setIsAiPolishing(false);
  }
};
const handleManualSave = async () => { 
    if (canvasDirty) {
      handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
      setCanvasDirty(false);
    }

    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: { teacherName, schoolName, campus, unit, lesson, supportType, date },
      indicators,
      status: observationStatus,
      updatedAt: Date.now(),
      isGood, isBad, isFavorite,
    };

    persistObservation(payload); 
  };

const handleAdminReviewSave = async () => {
    if (!adminPreview) {
      console.warn("Cannot save admin review: Preview model is missing.");
      return;
    }

    const translatedSummary = adminPreview.trainerSummary;

    try {
      await saveAdminSummaryToDb(observationMeta.id, translatedSummary);

      if (typeof setAdminSummaryVN === 'function') {
          setAdminSummaryVN(translatedSummary);
      }

      alert("✅ Translated Summary Saved to Database!");
    } catch (err) {
      console.error("Admin Review Save failed", err);
      alert("❌ Save failed. Check console for details.");
    }
  };

const handleBackToDashboard = () => {
    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: { teacherName, schoolName, campus, unit, lesson, supportType, date },
      indicators,
      status: observationStatus,
      updatedAt: Date.now(),
      isGood, isBad, isFavorite,
      scratchpadText
    };

    persistObservation(payload);
    onBack();
};
const handleToggleLock = () => { 
    if (canvasDirty) {
      handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
      setCanvasDirty(false);
    }

    const nextStatus: "draft" | "saved" =
      observationStatus === "draft" ? "saved" : "draft";

    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: { teacherName, schoolName, campus, unit, lesson, supportType, date },
      indicators,
      status: nextStatus,
      updatedAt: Date.now(),
      scratchpadText,
      isGood, isBad, isFavorite,
    };

    persistObservation(payload);

    setObservationStatus(nextStatus);
  };

const handleEmailTeacher = async () => {
  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

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

    await exportTeacherExcel(model);
  };

const handleExportAdmin = async () => {
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
    date: observationMeta.date, 
  };

  const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
    id: ind.id,
    number: ind.number,
    title: ind.title,
    description: ind.description,
    good: ind.good,
    growth: ind.growth,
    commentText: ind.commentText,
    includeInTrainerSummary: ind.includeInTrainerSummary ?? false,
  }));

  const baseModel = buildAdminExportModel(metaForExport, exportIndicators);

  const modelToExport =
    adminPreview && showAdminPreview
      ? {
          ...baseModel,
          rows: adminPreview.rows,                  
          trainerSummary: adminPreview.trainerSummary, 
        }
      : baseModel;

  await exportAdminExcel(modelToExport);
};

  
const handleExportPreview = () => {
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
    date: observationMeta.date, 
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

  setExportPreview(model);
  setShowExportPreview(true);
};

const handleAdminPreview = () => {
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
    date: observationMeta.date, 
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

  const freshModel = buildAdminExportModel(metaForExport, exportIndicators);
  
  const savedVNSummary = adminSummaryVN; 

  const finalModel = {
      ...freshModel,
      trainerSummary: savedVNSummary || freshModel.trainerSummary, 
  };

  setAdminPreview(finalModel);
  setShowAdminPreview(true);
};


const [canvasDirty, setCanvasDirty] = useState(false);

useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!canvasDirty) return;
    e.preventDefault();
    // @ts-ignore
    e.returnValue = "";
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [canvasDirty]);


const handleStrokesChange = (index: number, newStrokes: Stroke[]) => {
  if (isLocked) return; 
  updateIndicator(index, { strokes: newStrokes });
  setCanvasDirty(true);  
};


const handlePolishWithAi = async () => {
  const currentText = active.commentText.trim();
  if (!currentText) return;
  if (isAiPolishing) return;

  setIsAiPolishing(true);

  try {
    const polished = await polishTextWithGroq(currentText);

    updateIndicator(activeIndex, {
      commentText: polished,
      aiPendingReview: true,
    });

  } catch (err: any) {
    console.error("Groq Single Polish failed", err);
    const errorMsg = err?.status === 429 
      ? "Groq is busy. Wait a few seconds." 
      : "Could not polish text.";
    alert(errorMsg);
  } finally {
    setIsAiPolishing(false);
  }
};

const handleConvertHandwritingToText = async () => {
  setOcrError(null);

  if (!active.strokes || active.strokes.length === 0) {
    setOcrError("No handwriting found for this indicator.");
    return;
  }

  if (isOcrRunning) return;

  setIsOcrRunning(true);

  try {
    const { text, confidence } = await runOcrOnStrokes(active.strokes);

    const existing = active.commentText.trim();
    const combined = existing
      ? `${existing}\n\n[OCR]\n${text}`
      : `[OCR]\n${text}`;

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

  if (canvasDirty) {
    handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
    setCanvasDirty(false);
  }

  if (isOcrRunning) return;

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

  const insertDefaultCommentsForGood = () => {
    setIndicators((prev) =>
      prev.map((ind) => {
        const hasTemplate = !!ind.preComment;
        const emptyComment =
          !ind.commentText || ind.commentText.trim().length === 0;

        if (ind.good && hasTemplate && emptyComment) {
          return {
            ...ind,
            commentText: ind.preComment!, 
          };
        }

        return ind;
      })
    );
  };

  const renderClickableList = (items: IndicatorState[]) => {
    return items.map((ind, idx) => {
      const globalIndex = indicators.findIndex((x) => x.id === ind.id);
      const isLast = idx === items.length - 1;

      const handleClick = () => {
        if (globalIndex < 0) return;

        setSidebarCollapsed(false);
        window.dispatchEvent(new Event("resize"));

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
    updateIndicator(activeIndex, {
      ocrPendingReview: false,
    });
  };

  const handleCommentChange = (index: number, value: string) => {
  if (isLocked) return;
  const ind = indicators[index];

  const hadOcr = ind.ocrUsed;
  const ocrStillExists = value.includes("[OCR]");

  let patch: Partial<IndicatorState> = {
    commentText: value,
    ocrPendingReview: false, 
    aiPendingReview: false, 
  };

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

  const jumpToIndicator = (indicatorNumber: string) => {
    const idx = indicators.findIndex((ind) => ind.number === indicatorNumber);
    if (idx === -1) return;

    if (sidebarCollapsed) {
      setSidebarCollapsed(() => {
        window.dispatchEvent(new Event("resize"));
        return false;
      });
    }

    setActiveIndex(idx);

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
                onClick={handleBatchPolishClick}
                disabled={isLocked || isAiPolishing}
                style={{
                  background: "linear-gradient(135deg, #6366f1, #a855f7)",
                  border: "none",
                  color: "white",
                  marginLeft: 8,
                  fontWeight: 500
                }}
              >
                {isAiPolishing ? "✨ Polishing..." : "✨ Polish All"}
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
                if (filterMode === "good" && !ind.good) return null;
                if (filterMode === "growth" && !ind.growth) return null;
                if (filterMode === "favorites" && !ind.favorite) return null;

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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button 
                  type="button" 
                  className="btn btn-ghost canvas-collapse-btn" 
                  onClick={() => setIsCanvasVisible(v => !v)}
                  title={isCanvasVisible ? "Collapse canvas and tools" : "Expand canvas and tools"}
                  style={{
                    width: 24,
                    height: 24,
                    padding: 0,
                    flexShrink: 0,
                    transform: isCanvasVisible ? "rotate(0deg)" : "rotate(180deg)",
                    transition: "transform 0.2s ease",
                    fontSize: 12,
                    lineHeight: 1,
                    border: '1px solid var(--accent)', 
                    color: 'var(--accent)', 
                    background: 'transparent'
                  }}
                >
                  {isCanvasVisible ? "▼" : "▲"}
                </button>
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

            <div
              className={`canvas-resizable-wrapper ${isCanvasVisible ? '' : 'collapsed'}`}
              ref={canvasWrapperRef}
              style={{ 
                height: isCanvasVisible ? `${canvasHeight}px` : '0px', 
                transition: 'height 0.2s ease-out',
                overflow: 'hidden'
              }}
            >
              <CanvasPad
                key={active.id}
                strokes={active.strokes}
                onChange={(s) => handleStrokesChange(activeIndex, s)}
                readOnly={isLocked || !isCanvasVisible} 
              />
            </div>
 
            {isCanvasVisible && (
              <div
                className="canvas-resize-handle"
                onMouseDown={startCanvasResize}
                onTouchStart={startCanvasResize}
              />
            )}

            {/* 🔤 Manual OCR button / AI Polish */}
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
                {isOcrRunning ? "Converting…" : "Convert handwriting to text (OCR)"}
              </button>
              {/* ✨ NEW: AI Polish Button */}
                  <button
                    type="button"
                    className="btn"
                    onClick={handlePolishWithAi}
                    disabled={isAiPolishing || active.commentText.trim().length < 5}
                    title="Polish grammar and tone with Gemini AI"
                    style={{ marginLeft: 8 }}
                  >
                    {isAiPolishing ? "✨ Polishing..." : "✨ AI Polish"}
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

            {/* 📝 Textarea and Handle */}
            <div 
              style={{ 
                marginTop: 10, 
                position: "relative", 
                zIndex: 10, 
                display: "flex", 
                flexDirection: "column",
                flexGrow: 1 
              }}
            >
            <div
              style={{
                fontSize: 12,
                marginBottom: 4,
                color: active.aiPendingReview 
                  ? "#c084fc" 
                  : active.ocrPendingReview 
                    ? "#facc15" 
                    : "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              {active.aiPendingReview ? (
                <>
                  <span>✨ AI polished this text. Please review.</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => updateIndicator(activeIndex, { aiPendingReview: false })}
                  >
                    ✅ Accept
                  </button>
                </>
              ) : active.ocrPendingReview ? (
                <>
                  <span>OCR text added – please review.</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "2px 8px", fontSize: 11 }}
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
              ref={textareaRef}
              value={active.commentText}
              onChange={(e) => handleCommentChange(activeIndex, e.target.value)}
              rows={5}
              readOnly={isLocked}
              style={{
                width: "100%",
                height: `${textAreaHeight}px`, 
                minHeight: `${MIN_TEXTAREA_HEIGHT}px`,
                resize: "none", 
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
                flexGrow: 1, 
              }}
            />
            <div
              className="textarea-resize-handle"
              onMouseDown={startTextareaResize}
              onTouchStart={startTextareaResize}
            />
          </div>

            {showExportPreview &&
              exportPreview &&
              (() => {
              const unreviewedOcrIndicators = indicators.filter(
                (ind) => ind.ocrUsed && ind.ocrPendingReview
              );

            const hasUnreviewedOcr = unreviewedOcrIndicators.length > 0;
            
                  const unreviewedAiIndicators = indicators.filter(
                    (ind) => ind.aiPendingReview
                  );
                  const hasUnreviewedAi = unreviewedAiIndicators.length > 0;
                
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
                return hasInk && !ind.ocrUsed; 
              });

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
                    {hasUnreviewedOcr && (
                    <div className="export-ocr-banner">
                      ⚠ This preview includes OCR text that hasn&apos;t been marked as reviewed yet in:{" "}
                      {renderIndicatorLinks(unreviewedOcrIndicators.map((ind) => ind.number))}
                      . Please double-check those comments before sending to the teacher.
                    </div>
                      )}
                      
                  {hasUnreviewedAi && (
                    <div className="export-ocr-banner" style={{ 
                      backgroundColor: "rgba(147, 51, 234, 0.2)", 
                      border: "1px solid rgba(147, 51, 234, 0.5)",
                      color: "#e9d5ff" 
                    }}>
                      ✨ This preview includes AI-polished text that hasn&apos;t been marked as accepted yet in:{" "}
                      {renderIndicatorLinks(unreviewedAiIndicators.map((ind) => ind.number))}
                      . Please review them.
                    </div>
                  )}

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
                          <div className="export-preview-left">
                            <div className="export-preview-indicator">
                              <strong>{row.indicatorLabel}</strong>
                            </div>
                            <div className="export-preview-description">
                              {row.description}
                            </div>
                          </div>

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
                  <div className="flex-grow"> 
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
                    className="btn btn-primary" 
                    onClick={handleAdminReviewSave} 
                    style={{ marginRight: 8, backgroundColor: 'var(--color-primary)' }} 
                  >
                    Save Translated Summary
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAdminPreview(false)}
                  >
                    Close
                  </button>
                </div>
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
                      <div className="export-preview-indicator">
                        <div className="admin-main-category">
                          {row.mainCategory}
                        </div>
                        <div className="admin-aspect">{row.aspect}</div>
                      </div>

                      <div className="export-preview-description">
                        {row.classroomSigns}
                      </div>

                      <div className="export-preview-status">
                        {row.trainerRating || "\u00A0"}
                      </div>

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
      {showBatchModal && (
        <div className="scratchpad-backdrop">
          <div className="scratchpad-modal" style={{ maxWidth: 500, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
            <div className="scratchpad-header">
              <div>
                <div className="scratchpad-title">Batch AI Polish</div>
                <div className="scratchpad-sub">
                  Found {batchCandidates.length} items to polish.
                </div>
              </div>
            </div>

            <div style={{ padding: 16, overflowY: "auto", flexGrow: 1 }}>
              <p style={{ fontSize: 13, marginBottom: 12, color: "var(--text-muted)" }}>
                The following indicators will be processed by Gemini AI to improve grammar and tone:
              </p>
              
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {batchCandidates.map(c => (
                  <div key={c.id} style={{ 
                    background: "#1e293b", 
                    padding: "4px 8px", 
                    borderRadius: 4, 
                    fontSize: 12,
                    border: "1px solid #334155"
                  }}>
                    <strong>{c.number}</strong>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20, fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
                Note: Only indicators with unpolished text are listed here. Empty or already polished items are skipped.
              </div>
            </div>

            <div style={{ 
              padding: 16, 
              borderTop: "1px solid rgba(51,65,85,0.5)", 
              display: "flex", 
              justifyContent: "flex-end", 
              gap: 8 
            }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowBatchModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={executeBatchPolish}
                style={{
                  background: "#a855f7",
                  color: "white",
                  border: "none"
                }}
              >
                ✨ Polish {batchCandidates.length} Items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};