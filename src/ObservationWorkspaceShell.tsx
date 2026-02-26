// src/ObservationWorkspaceShell.tsx
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core'; // 🟢 FIXED: Separated as a type import
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { exportTeacherExcel } from "./exportTeacherExcel";
import { CanvasPad } from "./CanvasPad";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { exportAdminExcel } from "./exportAdminExcel"; 
import { emailTeacherReport } from "./emailTeacherReport";
import { generateAdminSummary } from "./utils/gemini";
import { getOptimizedInkImage } from "./utils/imageOptimizer"; // If you created this file
// Add these imports
import { get, set, del } from 'idb-keyval';
// 1. Import the constant (the data array) normally
import { INITIAL_INDICATORS } from "./constants";
import type { 
  PerformanceRating, 
  StrokePoint, 
  Stroke, 
  IndicatorState 
} from "./constants";
import { Pin, ArrowUpToLine } from 'lucide-react';

// Add to imports
import { stitchHandwritingBatches } from "./utils/imageStitcher";
import { transcribeWithGroq } from "./utils/transcribe";

const CANVAS_HEIGHT_STORAGE_KEY = "canvas-pad-height";
const DEFAULT_CANVAS_HEIGHT = 300; 
const MIN_CANVAS_HEIGHT = 100;
const TEXTAREA_HEIGHT_STORAGE_KEY = "textarea-height";
const DEFAULT_TEXTAREA_HEIGHT = 120;
const MIN_TEXTAREA_HEIGHT = 60;
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";
// 🟢 FIXED: Stricter constraints to prevent broken layout
const DEFAULT_SIDEBAR_WIDTH = 340;
const MIN_SIDEBAR_WIDTH = 300; // Increased from 220 to prevent button overlap
const MAX_SIDEBAR_WIDTH = 550; // Cap width so it doesn't take over screen

function getPersistedSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : DEFAULT_SIDEBAR_WIDTH;
    return isNaN(parsed) ? DEFAULT_SIDEBAR_WIDTH : Math.max(MIN_SIDEBAR_WIDTH, Math.min(parsed, MAX_SIDEBAR_WIDTH));
  } catch (error) {
    console.error("Failed to read persisted sidebar width", error);
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function setPersistedSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, width.toString());
  } catch (error) {
    console.error("Failed to write persisted sidebar width", error);
  }
}

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

function cleanupOldDrafts(currentId: string): boolean {
  console.log("🧹 Attempting to clean up old local drafts...");
  let clearedCount = 0;
  
  try {
    const keysToRemove: string[] = [];
    
    // 1. Scan for other drafts
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // If it looks like an observation BUT is not the current one
      if (key && key.startsWith("obs-v1-") && !key.includes(currentId)) {
        keysToRemove.push(key);
      }
    }

    // 2. Delete them
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      clearedCount++;
    });

    console.log(`🧹 Deleted ${clearedCount} old drafts to free space.`);
    return clearedCount > 0; // Return true if we actually deleted something
    
  } catch (e) {
    console.warn("Cleanup failed", e);
    return false;
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

// 🟢 UPDATED CLEANER: 
// 1. Removes [OCR]/[Hints]
// 2. Removes (GA) tags (so they don't show up in the text box)
// 3. KEEPS empty lines and hyphens
function cleanTextForPreview(text: string): string {
    if (!text) return "";
    return text
        .split('\n')
        .map(line => {
            // Remove [OCR], [Hints]
            let cleaned = line.replace(/\[(OCR|Hints)\]/gi, "");
            
            // Remove (GA) tags so they don't leak into the editor view
            cleaned = cleaned.replace(/\s*\(\s*GA\s*\)\s*$/i, "");

            return cleaned.trimEnd(); 
        })
        .join('\n'); // 🟢 KEEPS EMPTY LINES
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
import { useAuth } from "./auth/AuthContext";

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
    teacher_id?: string; 
    grapeseed_id?: string | null;
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



interface SavedObservationPayload {
  id: string;
  teacher_id?: string;
  grapeseed_id?: string | null;
  performance_rating?: PerformanceRating;
  meta: {
    teacherName: string;
    schoolName: string;
    campus: string;
    unit: string;
    lesson: string;
    supportType: "Training" | "LVA" | "Visit";
    date: string;
    teacher_id?: string; // 🟢 ADD THIS LINE HERE
    grapeseed_id?: string | null;
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
  adminSummaryVN?: string | null;
  lastSync?: number;
}

const STORAGE_PREFIX = "obs-v1-";

// (In ObservationWorkspaceShell.tsx - Replace existing strokesToPngBase64)

async function strokesToPngBase64(strokes: Stroke[]): Promise<string> {
  if (!strokes.length) throw new Error("No strokes to convert");

  // 1. Calculate Bounds (Crop Logic)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  // Add Padding
  const padding = 40; 
  const width = Math.max(1, (maxX - minX) + (padding * 2));
  const height = Math.max(1, (maxY - minY) + (padding * 2));

  // 2. Create Sized Canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas not supported");

  // 3. White Background (Better for OCR than dark)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  // 4. Draw Strokes (Shifted by minX/minY)
  ctx.translate(-minX + padding, -minY + padding);
  
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    ctx.lineWidth = stroke.size || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000"; // Force Black Ink for Contrast
    
    const first = stroke.points[0];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  // 5. Export Small JPEG
  const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
  return dataUrl.split(",")[1];
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

// Find your normalizeIndicators function or update the load logic:
function normalizeIndicators(raw: any): IndicatorState[] {
  const data = Array.isArray(raw) ? raw : (raw?.indicators || []);
  
  // 🟢 SEEDING: Ensure every item has a sortOrder
  return data.map((ind: any, index: number) => ({
    ...ind,
    sortOrder: typeof ind.sortOrder === 'number' ? ind.sortOrder : (index + 1) * 1000
  }));
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
const { user } = useAuth();
const [indicators, setIndicators] =
  useState<IndicatorState[]>(INITIAL_INDICATORS);
// Tracks which rows are currently open (Accordion state)
const [openRowIds, setOpenRowIds] = useState<Set<string>>(new Set([indicators[0]?.id]));
const [activeRowId, setActiveRowId] = useState<string | null>(indicators[0]?.id || null);
// Tracks which rows are "Locked" (Pinned state)
const [pinnedRowIds, setPinnedRowIds] = useState<Set<string>>(new Set());

// 🟢 FIXED: Unified Accordion Logic for BOTH PC and iPad modes
const handleRowToggle = (id: string) => {
  setOpenRowIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
      // If clicking an already open row, close it (unless it's pinned)
      if (!pinnedRowIds.has(id)) next.delete(id);
    } else {
      // 🟢 ACCORDION: Clear all other unpinned rows before opening the new one
      next.forEach(openId => {
        if (!pinnedRowIds.has(openId)) next.delete(openId);
      });
      next.add(id);
    }
    return next;
  });
  // Keep activeRowId in sync for highlighting
  setActiveRowId(id);
};

const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  setIndicators((items) => {
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const newArray = arrayMove(items, oldIndex, newIndex);

    // 🟢 FIXED: Cast to 'any' to bypass TS interface error locally
    const prevItem = newArray[newIndex - 1] as any;
    const nextItem = newArray[newIndex + 1] as any;
    
    let newOrder: number;
    if (!prevItem) newOrder = nextItem.sortOrder / 2;
    else if (!nextItem) newOrder = prevItem.sortOrder + 1000;
    else newOrder = (prevItem.sortOrder + nextItem.sortOrder) / 2;

    (newArray[newIndex] as any).sortOrder = newOrder;
    
    isDirtyRef.current = true; 
    return newArray;
  });
};

// 🟢 NEW: Send to Top Logic (PC Only)
const handleSendToTop = useCallback((id: string) => {
  setIndicators((prev) => {
    // 1. Find the current absolute minimum sortOrder in the list
    const currentMin = Math.min(...prev.map(i => (i as any).sortOrder || 0));
    
    // 2. Subtract 1000 to guarantee it rockets past the current #1 item
    const newTopOrder = currentMin - 1000;

    // 3. Apply it to the target indicator
    const nextArray = prev.map(ind => 
      ind.id === id ? { ...ind, sortOrder: newTopOrder } : ind
    );
    
    // 4. Trigger auto-save
    isDirtyRef.current = true;
    return nextArray;
  });
}, []);

// 🟢 FIXED: Master Command logic
const handleToggleAll = () => {
  const allIds = indicators.map(ind => ind.id);
  // Strictly check if EVERY row is open
  const isEverythingOpen = openRowIds.size === indicators.length;

  if (isEverythingOpen) {
    // If full, collapse everything
    setOpenRowIds(new Set());
    setPinnedRowIds(new Set()); 
    setActiveRowId(null);
  } else {
    // If NOT full (even if 1 is open), force everything to open
    setOpenRowIds(new Set(allIds));
  }
};

// 🟢 Helper to toggle a pin
const togglePin = (e: React.MouseEvent, id: string) => {
  e.stopPropagation(); // Prevents the row from toggling expansion
  setPinnedRowIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
};

const trainerName = 
    user?.user_metadata?.full_name || 
    user?.user_metadata?.name || 
    user?.user_metadata?.display_name || 
    (user?.email ? user.email.split('@')[0] : "GrapeSEED Trainer");
const { teacherName, schoolName, campus, unit, lesson, supportType, date, teacher_id, grapeseed_id} = observationMeta;
const [showBatchModal, setShowBatchModal] = useState(false);
const [batchCandidates, setBatchCandidates] = useState<{id: string, number: string, title: string, text: string}[]>([]);
const [isAiPolishing, setIsAiPolishing] = useState(false);
const storageKey = `${STORAGE_PREFIX}${observationMeta.id}`;

const [isCanvasVisible, setIsCanvasVisible] = useState(true); 
const [isDesktopMode, setIsDesktopMode] = useState(false);
const [textAreaHeight, setTextAreaHeight] = useState(getPersistedTextareaHeight);
const [isTextareaResizing, setIsTextareaResizing] = useState(false);
const textareaRef = useRef<HTMLTextAreaElement>(null);

const [canvasHeight, setCanvasHeight] = useState(getPersistedCanvasHeight);
const [isResizing, setIsResizing] = useState(false);
const canvasWrapperRef = useRef<HTMLDivElement>(null);
const startYRef = useRef(0);
const startHeightRef = useRef(0);
const [lastServerVersion, setLastServerVersion] = useState<number>(0);
// Add this near your other useState hooks
const lastServerVersionRef = useRef(lastServerVersion);

// Add this state
const [isResizerLocked, setIsResizerLocked] = useState(false);
const [isCanvasLocked, setIsCanvasLocked] = useState(false);
// Inside ObservationWorkspaceShell component
const [isBatchOcrRunning, setIsBatchOcrRunning] = useState(false);
const [batchOcrProgress, setBatchOcrProgress] = useState(""); // e.g., "Processing batch 1 of 3..."
const [rescuedIds, setRescuedIds] = useState<{ teacher_id?: string; grapeseed_id?: string | null }>({});
const [isMetadataReady, setIsMetadataReady] = useState(false);




// Helper to extract IDs like "1.1", "3.4" from any messy string
const extractIds = (text: string): string[] => {
  // Finds patterns like "1.1", "10.5", etc.
  // It ignores dashes, spaces, and text like "Task"
  const matches = text.match(/\d+\.\d+/g);
  return matches ? matches : [];
};

const handleConvertAllInk = async () => {
    setOcrError(null);
    if (isBatchOcrRunning) return;

    // 1. Identify Candidates
    const candidates = indicators.filter(ind => {
      const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
      return hasInk && !ind.ocrUsed;
    });

    if (candidates.length === 0) {
      alert("No new handwriting found to convert.");
      return;
    }

    if (!window.confirm(`Found ${candidates.length} items with handwriting. Convert them all?`)) {
      return;
    }

    setIsBatchOcrRunning(true);
    setBatchOcrProgress("Preparing images...");

    try {
      // 2. Prepare Data for Stitcher
      const stitchItems = candidates.map(ind => ({
        id: ind.number, 
        strokes: ind.strokes
      }));

      // 3. Generate Stitched Batches
      const batches = await stitchHandwritingBatches(stitchItems, 6);

      // 4. Process Batches
      let processedCount = 0;
      let successCount = 0;
      const newUpdates: Record<string, Partial<IndicatorState>> = {};

      for (let i = 0; i < batches.length; i++) {
        setBatchOcrProgress(`Processing batch ${i + 1} of ${batches.length}...`);
        
        const batch = batches[i];
        let attempts = 0;
        let success = false;
        let delay = 2000;

        // 🔄 RETRY LOOP
        while (attempts < 5 && !success) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000); 

                const response = await fetch(`${MERGE_SERVER_BASE}/api/ocr-gemini`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ 
                    imageBase64: batch.imageBase64,
                    isBatch: true 
                  }),
                  signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.status === 503) {
                    console.warn(`Batch ${i} - Server overloaded (503). Retrying...`);
                    await new Promise(r => setTimeout(r, delay));
                    delay *= 2; 
                    attempts++;
                    continue;
                }

                if (!response.ok) {
                   const errText = await response.text().catch(() => "Unknown error");
                   throw new Error(`HTTP ${response.status}: ${errText}`);
                }

                const data = await response.json();
                const resultsMap = data.results || {};
                
                // -----------------------------------------------------------
                // 5. "SET OVERLAP" MATCHING LOGIC (The Robust Fix)
                // -----------------------------------------------------------
                Object.entries(resultsMap).forEach(([key, text]) => {
                   const strText = text as string;
                   if (!strText) return;

                   // A. Extract clean IDs from the AI Key (e.g. "3.4 - 5.1" -> ["3.4", "5.1"])
                   const aiIds = extractIds(key);

                   // B. Find indicators whose Numbers overlap with these AI IDs
                   const targets = indicators.filter(ind => {
                       // Extract IDs from the Indicator Number (e.g. "3.4 – 5.1" -> ["3.4", "5.1"])
                       const indIds = extractIds(ind.number);
                       
                       // Check for intersection: Do they share ANY common ID?
                       return indIds.some(id => aiIds.includes(id));
                   });

                   if (targets.length === 0) {
                       console.warn(`FAILED MATCH: Key "${key}" (IDs: ${aiIds}) matched nothing.`);
                   }

                   // C. Apply Update
                   targets.forEach(originalInd => {
                       const existing = originalInd.commentText.trim();
                       
                       if (existing.includes(strText)) return;

                       const combined = existing 
                         ? `${existing}\n\n[OCR]\n${strText}`
                         : `[OCR]\n${strText}`;

                       newUpdates[originalInd.id] = {
                         commentText: combined,
                         ocrUsed: true,
                         ocrPendingReview: true,
                         ocrLastRunAt: Date.now()
                       };
                       successCount++;
                   });
                });
                
                success = true; 
                processedCount += batch.idsInBatch.length;

            } catch (err: any) {
                console.warn(`Batch ${i} attempt ${attempts + 1} failed:`, err);
                attempts++;
                await new Promise(r => setTimeout(r, 2000)); 
            }
        }
      }

      // 6. Bulk Update React State
      if (Object.keys(newUpdates).length > 0) {
        setIndicators(prev => prev.map(ind => {
           if (newUpdates[ind.id]) {
             return { ...ind, ...newUpdates[ind.id] };
           }
           return ind;
        }));
        
        isDirtyRef.current = true;
        alert(`Successfully converted ${successCount} items!`);
      } else {
         if (processedCount > 0) {
             alert(`OCR Finished. AI found text, but we couldn't match it to your indicators.\n\nCheck Console (F12) for details.`);
         } else {
             alert("OCR failed to process any items.");
         }
      }

    } catch (err) {
      console.error("Batch OCR System Failure", err);
      alert("An unexpected error occurred.");
    } finally {
      setIsBatchOcrRunning(false);
      setBatchOcrProgress("");
    }
};

// --- SIDEBAR RESIZE STATE ---
  const [sidebarWidth, setSidebarWidth] = useState(getPersistedSidebarWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
// Update the startSidebarResize function
const startSidebarResize = useCallback((e: React.MouseEvent | React.TouchEvent) => {
  // 🔒 STOP if locked
  if (isResizerLocked) return; 
  
  e.preventDefault(); 
  setIsSidebarResizing(true);
}, [isResizerLocked]);

  const doSidebarResize = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isSidebarResizing) return;
      
      const clientX = (e as MouseEvent).clientX ?? (e as TouchEvent).touches[0].clientX;
      
      // Calculate new width based on pointer position
      // Assuming sidebar is on the left, width is just clientX
      // If there is padding/margins on the left, you might need to adjust (e.g. clientX - 16)
      let newWidth = clientX; 
      
      // Constrain
      newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
      
      setSidebarWidth(newWidth);
    },
    [isSidebarResizing]
  );

  const stopSidebarResize = useCallback(() => {
    if (isSidebarResizing) {
      setIsSidebarResizing(false);
      setPersistedSidebarWidth(sidebarWidth);
      window.dispatchEvent(new Event("resize")); // Trigger resize for canvas/charts if needed
    }
  }, [isSidebarResizing, sidebarWidth]);

  // Attach Resize Listeners
  useEffect(() => {
    if (isSidebarResizing) {
      window.addEventListener("mousemove", doSidebarResize);
      window.addEventListener("mouseup", stopSidebarResize);
      window.addEventListener("touchmove", doSidebarResize);
      window.addEventListener("touchend", stopSidebarResize);
      document.body.style.cursor = "col-resize"; // Visual feedback
      document.body.style.userSelect = "none";   // Prevent selection
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    return () => {
      window.removeEventListener("mousemove", doSidebarResize);
      window.removeEventListener("mouseup", stopSidebarResize);
      window.removeEventListener("touchmove", doSidebarResize);
      window.removeEventListener("touchend", stopSidebarResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isSidebarResizing, doSidebarResize, stopSidebarResize]);

// Keep the Ref in sync with the State automatically
useEffect(() => {
  lastServerVersionRef.current = lastServerVersion;
}, [lastServerVersion]);


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
    if (isCanvasLocked) return;
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
  [canvasHeight, isCanvasLocked]
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



const [previewEdits, setPreviewEdits] = useState<Record<string, { strengths: string, growths: string }>>({});
const [activeIndex, setActiveIndex] = useState(0);
const [observationStatus, setObservationStatus] = useState<"draft" | "saved">(
    "draft"
  );

const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("saved");
  const isLocked = observationStatus === "saved";
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
  const [syncError, setSyncError] = useState<string | null>(null); // 👈 Add this state
  // 🟢 NEW: Track if user has actually made changes
// 1. Add these states near your other UI states
const [isRecording, setIsRecording] = useState(false);
const [isTranscribing, setIsTranscribing] = useState(false);
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const audioChunksRef = useRef<Blob[]>([]);


const transcriptionTargetRef = useRef<'indicator' | 'admin'>('indicator');



const isDirtyRef = useRef(false);
useEffect(() => {
      if (indicators.length === 0) return;

      if (activeIndex >= indicators.length) {
        setActiveIndex(0);
      }
    }, [indicators.length, activeIndex]);

  const active =
  indicators[activeIndex] ?? indicators[0] ?? INITIAL_INDICATORS[0];

useEffect(() => {
  async function hydrateIds() {
    try {
      const masterList = await get<any[]>("dashboard_backup_list");
      if (Array.isArray(masterList)) {
        const match = masterList.find((obs) => obs.id === observationMeta.id);
        if (match) {
          // 🟢 LOOK DEEPER: Check both top-level AND inside meta
          const tId = match.teacher_id || match.meta?.teacher_id;
          const gId = match.grapeseed_id || match.meta?.grapeseed_id;
          
          if (tId || gId) {
            console.log(`🎯 Hydrated IDs for ${observationMeta.id}:`, { tId, gId });
            setRescuedIds({
              teacher_id: tId,
              grapeseed_id: gId
            });
          }
        }
      }
    } catch (e) {
      console.warn("Hydration failed", e);
    } finally {
      setIsMetadataReady(true);
    }
  }
  hydrateIds();
}, [observationMeta.id]);



  useEffect(() => {
  let cancelled = false;

  async function load() {
    let localData: SavedObservationPayload | undefined;

    // 🟢 CHANGE: Load from IndexedDB first
    try {
      localData = await get<SavedObservationPayload>(storageKey);

      // 🛡️ MIGRATION: If nothing in IndexedDB, check localStorage
      // This ensures old drafts are not lost when you switch to this new code.
      if (!localData) {
         const rawLegacy = localStorage.getItem(storageKey);
         if (rawLegacy) {
             console.log("♻️ Migrating data from LocalStorage to IndexedDB...");
             try {
               localData = JSON.parse(rawLegacy);
               // Save it to IndexedDB immediately so next load is fast & modern
               if (localData) await set(storageKey, localData);
             } catch (e) {
               console.error("Legacy migration failed", e);
             }
         }
      }
    } catch (err) { 
      console.error("Local read error", err); 
    }

    try {
      const row = await loadObservationFromDb(observationMeta.id);
      if (cancelled) return;
      
      setLastServerVersion(new Date(row.updated_at).getTime());
      
      const dbUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const localUpdatedAt = localData?.updatedAt ?? 0;

      // Compare Local vs Server Time
      if (localData && localUpdatedAt > dbUpdatedAt) {
        console.log("Using newer local data.");
        setIndicators(localData.indicators);
        setObservationStatus(localData.status ?? "draft");
        setScratchpadText(localData.scratchpadText ?? "");
        setAdminSummaryVN(localData.adminSummaryVN ?? row.admin_summary_vn ?? null);
        
        // Restore the "Memory" of the last sync to prevent conflicts
        if (localData.lastSync) {
           setLastServerVersion(localData.lastSync);
        }
        return; 
      }

      // If Server is newer (or no local data), use Server data
      const normalizedFromDb = normalizeIndicators(row.indicators);
      setIndicators(normalizedFromDb.length > 0 ? normalizedFromDb : INITIAL_INDICATORS);
      setObservationStatus(row.status ?? "draft");
      setAdminSummaryVN(row.admin_summary_vn ?? null);

    } catch (err) {
      console.warn("Offline: Using local backup.");
      if (localData && !cancelled) {
        setIndicators(localData.indicators);
        setObservationStatus(localData.status ?? "draft");
        setScratchpadText(localData.scratchpadText ?? "");
        
        // Restore "Memory" for offline functionality
        if (localData.lastSync) {
           setLastServerVersion(localData.lastSync);
        }

      } else if (!cancelled) {
        setIndicators(INITIAL_INDICATORS);
      }
    }
  }
  
  load();
  return () => { cancelled = true; };
}, [storageKey, observationMeta.id]);

const persistObservation = React.useCallback(
  async (payload: SavedObservationPayload) => {
    if (!isMetadataReady) return; 
    setSyncError(null);

    try {
      const existingOnDisk = await get<SavedObservationPayload>(storageKey);

      // 🛡️ THE TRIPLE THREAT RESCUE
      // We look in the payload, the rescued state, and finally the existing disk file.
      const safeTeacherId = payload.teacher_id || rescuedIds.teacher_id || existingOnDisk?.teacher_id || existingOnDisk?.meta?.teacher_id;
      const safeGrapeSeedId = payload.grapeseed_id || rescuedIds.grapeseed_id || existingOnDisk?.grapeseed_id || existingOnDisk?.meta?.grapeseed_id;

      const safePayload: SavedObservationPayload = {
        ...payload,
        teacher_id: safeTeacherId,
        grapeseed_id: safeGrapeSeedId, // 🟢 Now valid because of the interface update
        meta: {
          ...payload.meta,
          teacher_id: safeTeacherId, 
          grapeseed_id: safeGrapeSeedId
        },
        updatedAt: Date.now()
      };

      await set(storageKey, safePayload);
      setLastSavedAt(safePayload.updatedAt);
      setSaveStatus("saved");
      isDirtyRef.current = false;
      
      // Log for your peace of mind
      if (safeTeacherId && !payload.teacher_id) {
        console.log("🩹 ID Rescued during save:", safeTeacherId);
      }
    } catch (err: any) {
      console.error("Failed to write to IndexedDB", err);
      setSyncError("Disk Full");
    }
  },
  [storageKey, rescuedIds, isMetadataReady] 
);

const isFirstRun = useRef(true);


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
      // 🟢 Explicit ID Rescue
      teacher_id: rescuedIds.teacher_id || teacher_id,
      grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id,
      meta: { 
        ...observationMeta,
        teacher_id: rescuedIds.teacher_id || teacher_id,
        grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id 
      },
      indicators,
      performance_rating: indicators[0]?.performance_rating || null,
      status: observationStatus,
      updatedAt: Date.now(),
      scratchpadText, 
      adminSummaryVN, 
      lastSync: lastServerVersionRef.current, 
    };

    persistObservation(payload); 
};

const handleAdminReviewSave = async () => {
    if (!adminPreview) return;
    const translatedSummary = adminPreview.trainerSummary;

    try {
      await saveAdminSummaryToDb(observationMeta.id, translatedSummary);
      setAdminSummaryVN(translatedSummary);

      const payload: SavedObservationPayload = {
        id: observationMeta.id,
        // 🟢 Explicit ID Rescue
        teacher_id: rescuedIds.teacher_id || teacher_id,
        grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id,
        meta: { 
          ...observationMeta,
          teacher_id: rescuedIds.teacher_id || teacher_id,
          grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id 
        },
        indicators,
        status: observationStatus,
        updatedAt: Date.now(),
        scratchpadText,
        adminSummaryVN: translatedSummary, 
        lastSync: lastServerVersionRef.current,
      };
      persistObservation(payload);

      alert("✅ Translated Summary Saved!");
    } catch (err) {
      console.error("Admin Review Save failed", err);
      alert("❌ Save failed. Check console for details.");
    }
};

const handleBackToDashboard = () => {
    if (isDirtyRef.current || canvasDirty) {
        const payload: SavedObservationPayload = {
          id: observationMeta.id,
          // 🟢 Explicit ID Rescue
          teacher_id: rescuedIds.teacher_id || teacher_id,
          grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id,
          meta: { 
            ...observationMeta,
            teacher_id: rescuedIds.teacher_id || teacher_id,
            grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id 
          },
          indicators,
          performance_rating: indicators[0]?.performance_rating || null,
          status: observationStatus,
          updatedAt: Date.now(),
          scratchpadText,
          adminSummaryVN,
          lastSync: lastServerVersionRef.current,
        };
    
        persistObservation(payload);
    }
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
      // 🟢 Explicit ID Rescue
      teacher_id: rescuedIds.teacher_id || teacher_id,
      grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id,
      meta: { 
        ...observationMeta,
        teacher_id: rescuedIds.teacher_id || teacher_id,
        grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id 
      },
      indicators,
      performance_rating: indicators[0]?.performance_rating || null,
      status: nextStatus,
      updatedAt: Date.now(),
      scratchpadText,
      adminSummaryVN,
      lastSync: lastServerVersionRef.current,
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

  const model = buildTeacherExportModel(metaForExport, exportIndicators, trainerName);

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

  const model = buildTeacherExportModel(metaForExport, exportIndicators, trainerName);

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

const baseModel = buildAdminExportModel(metaForExport, exportIndicators, trainerName);

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

  
// 🟢 FIXED: Type definition added for newEdits
const handleExportPreview = () => {
    if (canvasDirty) {
      handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
      setCanvasDirty(false);
    }

    const metaForExport: ObservationMetaForExport = {
      teacherName, schoolName, campus, unit, lesson, supportType, date: observationMeta.date,
    };

    const exportIndicators: IndicatorStateForExport[] = indicators.map((ind) => ({
      id: ind.id, number: ind.number, title: ind.title, description: ind.description,
      good: ind.good, growth: ind.growth, commentText: ind.commentText,
      includeInTrainerSummary: !!ind.includeInTrainerSummary,
    }));

  const model = buildTeacherExportModel(metaForExport, exportIndicators, trainerName);

    // 🟢 FIX: Explicitly type this object to satisfy TypeScript
    const newEdits: Record<string, { strengths: string; growths: string }> = {};

    indicators.forEach(ind => {
        if (!ind.commentText) {
            newEdits[ind.id] = { strengths: "", growths: "" };
            return;
        }

        const lines = ind.commentText.split('\n');
        const sLines: string[] = [];
        const gLines: string[] = [];

        lines.forEach(line => {
            const safeLine = line || "";
            // 1. Check for explicit (GA) marker
            const hasGaMarker = safeLine.includes('(GA)');
            
            // 2. NEW RULE: Fallback to checkbox state if no marker is present
            // It goes to Growth if: marker is present OR (Growth is checked AND Good is NOT)
            const shouldBeGrowth = hasGaMarker || (!ind.good && ind.growth);

            let clean = safeLine
                .replace(/\[.*?\]/g, '') 
                .replace(/\(GA\)/g, '')  
                .replace(/^\s*-\s*/, '')    
                .trim();

            if (!clean) return;

            if (shouldBeGrowth) {
                gLines.push(clean);
            } else {
                sLines.push(clean);
            }
        });
        newEdits[ind.id] = {
            strengths: sLines.join('\n\n'),
            growths: gLines.join('\n\n')
        };
    });

    setPreviewEdits(newEdits);
    setExportPreview(model);
    setShowExportPreview(true);
};

// 🟢 UPDATED: Handles Saving AND Jumping
const handleSavePreview = (targetIndex?: any) => {
    console.log("🔒 Starting Strict Save...");

    // 1. Determine if we are jumping (Check if arg is a number, not an Event object)
    const jumpTo = (typeof targetIndex === 'number') ? targetIndex : null;

    const newIndicators = indicators.map(ind => {
        const edit = previewEdits[ind.id];
        if (!edit) return ind; 

        // --- STEP 1: PARSE ORIGINAL ---
        const originalLines = ind.commentText ? ind.commentText.split('\n') : [];
        
        const originalContentMap = originalLines.reduce((acc, line) => {
            const lineWithoutSystemTags = line.replace(/\[(OCR|Hints)\]/gi, '').trim();
            if (lineWithoutSystemTags.length === 0) return acc;

            const cuesMatch = line.match(/\[(?!OCR|Hints).*?\]/g);
            const extractedCues = cuesMatch ? cuesMatch.join(' ') : '';

            acc.push({ cues: extractedCues });
            return acc;
        }, [] as { cues: string }[]);

        // --- STEP 2: PARSE EDITS ---
        const cleanSplit = (text: string) => 
            text.split('\n').map(t => t.trim()).filter(t => t.length > 0);

        const newStrengthLines = cleanSplit(edit.strengths);
        const newGrowthLines = cleanSplit(edit.growths);

        const allNewLines = [
            ...newStrengthLines.map(t => ({ text: t, type: 'strength' })),
            ...newGrowthLines.map(t => ({ text: t, type: 'growth' }))
        ];

        // --- STEP 3: STITCH ---
        const finalLines = allNewLines.map((lineObj, index) => {
            let finalText = lineObj.text;

            if (lineObj.type === 'strength') {
                if (!finalText.startsWith('-')) finalText = `- ${finalText}`;
            } else {
                if (finalText.startsWith('(GA)')) finalText = finalText.replace('(GA)', '').trim();
                finalText = `(GA) ${finalText}`;
            }

            if (index < originalContentMap.length) {
                const savedCue = originalContentMap[index].cues;
                if (savedCue && !finalText.includes(savedCue)) {
                    finalText = `${finalText} ${savedCue}`;
                }
            }
            return { text: finalText, type: lineObj.type };
        });

        // --- STEP 4: FORMAT ---
        const finishedStrengths = finalLines.filter(l => l.type === 'strength').map(l => l.text);
        const finishedGrowths = finalLines.filter(l => l.type === 'growth').map(l => l.text);

        const sBlock = finishedStrengths.join('\n');
        const gBlock = finishedGrowths.join('\n\n'); 

        let combinedText = "";
        if (sBlock && gBlock) combinedText = `${sBlock}\n\n${gBlock}`;
        else combinedText = sBlock || gBlock;

        return {
            ...ind,
            commentText: combinedText,
            ocrPendingReview: false,
            aiPendingReview: false
        };
    });

    // 2. Commit Data
    setIndicators(newIndicators);
    isDirtyRef.current = true;
    
    const payload: SavedObservationPayload = {
      id: observationMeta.id,
      meta: { teacherName, teacher_id,grapeseed_id, schoolName, campus, unit, lesson, supportType, date },
      indicators: newIndicators,
      status: observationStatus,
      updatedAt: Date.now(),
      scratchpadText,
      adminSummaryVN,
      lastSync: lastServerVersionRef.current,
    };
    
    persistObservation(payload);
    
    // 3. Close Modal
    setShowExportPreview(false);

    // 4. 🟢 JUMP (If requested)
    if (jumpTo !== null) {
        // Small timeout ensures modal closes cleanly before slide switch
        setTimeout(() => setActiveIndex(jumpTo), 50);
    }
};

const handleMarkAllReviewed = () => {
      const newIndicators = indicators.map(ind => ({
          ...ind,
          ocrPendingReview: false,
          aiPendingReview: false
      }));
      setIndicators(newIndicators);
      isDirtyRef.current = true;
      
      const payload: SavedObservationPayload = {
        id: observationMeta.id,
        meta: { teacherName,teacher_id,grapeseed_id, schoolName, campus, unit, lesson, supportType, date },
        indicators: newIndicators,
        status: observationStatus,
        updatedAt: Date.now(),
        scratchpadText,
        adminSummaryVN,
        lastSync: lastServerVersionRef.current,
      };
      persistObservation(payload);
  };

  const handlePreviewPolishAll = async () => {
      setIsAiPolishing(true);
      try {
           const candidates = indicators
            .filter(ind => ind.commentText.trim().length > 3 && !ind.aiPendingReview)
            .map(ind => ({ id: ind.id, text: ind.commentText }));

           if (candidates.length === 0) {
               alert("No new items to polish.");
               return;
           }

           const results = await polishBatchWithGroq(candidates);

           const polishedIndicators = indicators.map(ind => {
               const pText = results[ind.id];
               return pText ? { ...ind, commentText: pText, aiPendingReview: true } : ind;
           });
           
           setIndicators(polishedIndicators);

           // Re-run load logic to update preview
           const metaForExport = { teacherName, schoolName, campus, unit, lesson, supportType, date: observationMeta.date };
           const exportInds = polishedIndicators.map(ind => ({
               id: ind.id, number: ind.number, title: ind.title, description: ind.description,
               good: ind.good, growth: ind.growth, commentText: ind.commentText,
               includeInTrainerSummary: !!ind.includeInTrainerSummary
           }));
           
           const model = buildTeacherExportModel(metaForExport, exportInds,trainerName);
           
           const nextEdits: Record<string, { strengths: string, growths: string }> = {};
           model.rows.forEach(row => {
               const originalInd = polishedIndicators.find(i => row.indicatorLabel.startsWith(i.number));
               if (originalInd) {
                   nextEdits[originalInd.id] = {
                       strengths: cleanTextForPreview(row.strengths),
                       growths: cleanTextForPreview(row.growths)
                   };
               }
           });
           
           setPreviewEdits(nextEdits);
           setExportPreview(model);
           
      } catch (e) {
          console.error(e);
          alert("Polish failed.");
      } finally {
          setIsAiPolishing(false);
      }
  };

const handleAdminPreview = async () => {
    // 1. Save Canvas if dirty (Standard check)
    if (canvasDirty) {
      handleStrokesChange(activeIndex, indicators[activeIndex].strokes);
      setCanvasDirty(false);
    }

    // 2. Validation
    const hasSummaryCandidates = indicators.some((i) => i.includeInTrainerSummary);
    if (!hasSummaryCandidates) {
      alert("Please check 'Include in Summary' for at least one indicator.");
      return;
    }

    // 3. Build Base Model (Calculates everything except the AI summary)
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

    const freshModel = buildAdminExportModel(metaForExport, exportIndicators,trainerName);

    // 🟢 CRITICAL FIX: Explicitly load the saved 'adminSummaryVN' into the preview.
    // This ensures that when you reopen the modal, your previous text is restored.
    const finalModel = {
      ...freshModel,
      trainerSummary: adminSummaryVN || "", 
    };

    setAdminPreview(finalModel);
    setShowAdminPreview(true);
    setIsCanvasVisible(false);
  };

const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

const handleGenerateAiSummary = async () => {
    if (!adminPreview) return;
    
    // Safety check: Don't overwrite existing text without warning
    if (adminPreview.trainerSummary && adminPreview.trainerSummary.length > 20) {
      const confirm = window.confirm("This will overwrite your current summary with a new AI draft. Are you sure?");
      if (!confirm) return;
    }

    setIsGeneratingSummary(true);

    try {
      const aiSummary = await generateAdminSummary(indicators);
      
      setAdminPreview(prev => prev ? { ...prev, trainerSummary: aiSummary } : prev);
      
      // Optional: Auto-save to state so it persists if they close/reopen
      setAdminSummaryVN(aiSummary); 
      
    } catch (err) {
      console.error("Summary Generation Error", err);
      alert("Failed to generate summary.");
    } finally {
      setIsGeneratingSummary(false);
    }
};

const [canvasDirty, setCanvasDirty] = useState(false);


useEffect(() => {
    // 1. Don't save if we aren't ready or have no ID
    if (!observationMeta.id || !isMetadataReady) return;

    // 2. Only save if something actually changed
    // (isDirtyRef tracks comments/ratings, canvasDirty tracks ink)
    if (!isDirtyRef.current && !canvasDirty) return;
    
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = window.setTimeout(() => {
      console.log("💾 Auto-saving draft...");
      
      const payload: SavedObservationPayload = {
        id: observationMeta.id,
        // Priority: Rescued ID > Props ID
        teacher_id: rescuedIds.teacher_id || teacher_id, 
        grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id,
        meta: { 
          ...observationMeta, 
          teacher_id: rescuedIds.teacher_id || teacher_id,
          grapeseed_id: rescuedIds.grapeseed_id || grapeseed_id 
        },
        indicators,
        performance_rating: indicators[0]?.performance_rating || null,
        status: observationStatus,
        updatedAt: Date.now(),
        scratchpadText,
        adminSummaryVN: adminSummaryVN
      };

      persistObservation(payload);
      setCanvasDirty(false);
    }, 800);

    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [
    // 🟢 ALL ACTUAL DEPENDENCIES LISTED HERE:
    observationMeta, 
    isMetadataReady, 
    canvasDirty, 
    rescuedIds, 
    indicators, 
    observationStatus, 
    scratchpadText, 
    adminSummaryVN, 
    persistObservation,
    teacher_id,
    grapeseed_id
  ]);


// Update this useEffect
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    // Block if Canvas is dirty OR if we haven't successfully synced to server yet
    const hasUnsavedChanges = canvasDirty || saveStatus !== "saved" || syncError !== null;
    
    if (!hasUnsavedChanges) return;
    
    e.preventDefault();
    // @ts-ignore
    e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [canvasDirty, saveStatus, syncError]);

const handleStrokesChange = (index: number, newStrokes: Stroke[]) => {
  if (isLocked) return; 
  updateIndicator(index, { strokes: newStrokes });
  setCanvasDirty(true);  
};


const mimeTypeRef = useRef<string>("");


const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // 🟢 DETECT SUPPORTED MIME TYPE
    // Chrome uses 'audio/webm', Safari uses 'audio/mp4'
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") 
      ? "audio/webm" 
      : "audio/mp4";
    
    mimeTypeRef.current = mimeType; // Save it for later

    const recorder = new MediaRecorder(stream, { mimeType });
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    mediaRecorderRef.current = recorder;
    recorder.start(1000); // 🟢 Capture chunks every 1s (safer than waiting for stop)
    setIsRecording(true);
  } catch (err) {
    console.error("Mic error", err);
    alert("Could not access microphone.");
  }
};

// Inside ObservationWorkspaceShell.tsx

const stopRecording = async (target: 'indicator' | 'admin') => {
  if (!mediaRecorderRef.current || !isRecording) return;

  const recorder = mediaRecorderRef.current;

  // 🟢 Wrap in a promise to wait for the actual onstop event
  const onStopPromise = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      // 🟢 Cleanup: Explicitly stop tracks to turn off the mic light
      if (recorder.stream) {
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
      resolve();
    };
  });

  recorder.stop();
  setIsRecording(false);
  setIsTranscribing(true);

  // 🟢 Wait for chunks to finalize
  await onStopPromise;

  // 🔍 Debug: Check if we actually recorded audio
  const blobSize = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
  console.log(`🎙️ Recording finished. Total Size: ${blobSize} bytes`);
  
  if (blobSize === 0) {
    alert("❌ Microphone recorded silence (0 bytes). Please check your mic permissions.");
    setIsTranscribing(false);
    return;
  }

  // Use the stored mimeType or default to webm
  const mimeType = mimeTypeRef.current || "audio/webm";
  const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

  try {
    const text = await transcribeWithGroq(audioBlob, mimeType);
    const textToAdd = text?.trim() || "";
    
    console.log("📝 Transcribed Text:", textToAdd);
    
    if (!textToAdd) {
        alert("⚠️ Transcription returned empty text. Please try again.");
        return;
    }

    // 🟢 Set dirty flag so the auto-save effect triggers
    isDirtyRef.current = true;

    if (target === 'indicator') {
        setIndicators(prev => {
            const newInds = [...prev];
            if (!newInds[activeIndex]) return prev;
            
            const existing = newInds[activeIndex].commentText || "";
            // Append with a newline if existing text exists
            newInds[activeIndex] = {
                ...newInds[activeIndex],
                commentText: existing ? `${existing}\n${textToAdd}` : textToAdd
            };
            return newInds;
        });
    } else {
        setAdminPreview(prev => prev ? { 
            ...prev, 
            trainerSummary: (prev.trainerSummary || "") + (prev.trainerSummary ? "\n" : "") + textToAdd 
        } : prev);
        setAdminSummaryVN(prev => (prev || "") + (prev ? "\n" : "") + textToAdd);
    }

  } catch (err: any) {
    console.error("Transcription Logic Error:", err);
    alert("Error: " + err.message);
  } finally {
    setIsTranscribing(false);
  }
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

  // 1. Validation
  if (!active.strokes || active.strokes.length === 0) {
    setOcrError("No handwriting found.");
    return;
  }
  if (isOcrRunning) return;
  setIsOcrRunning(true);

  try {
    // -------------------------------------------------------
    // STEP 1: VISION (Gemini)
    // -------------------------------------------------------
    console.log("👁️ Step 1: Sending image to Gemini (Vision)...");
    
    // Use your existing strokesToPngBase64 or the new optimizer
    const { text: rawText, confidence } = await runOcrOnStrokes(active.strokes);

    if (!rawText) throw new Error("OCR returned empty text");

    console.log("✅ Step 1 Complete. Raw Text:", rawText);

    // -------------------------------------------------------
    // STEP 2: IMMEDIATE UPDATE (Show Raw Text)
    // -------------------------------------------------------
    const now = Date.now();
    const existingComment = active.commentText.trim();
    
    // Append [OCR] tag
    const rawCombined = existingComment 
      ? `${existingComment}\n\n[OCR]\n${rawText}` 
      : `[OCR]\n${rawText}`;

    updateIndicator(activeIndex, {
      commentText: rawCombined,
      ocrUsed: true,
      ocrLastRunAt: now,
      ocrLastConfidence: confidence,
      ocrPendingReview: true, 
      aiPendingReview: false 
    });

    // -------------------------------------------------------
    // STEP 3: PREPARE FOR POLISH (Client-Side Expansion)
    // -------------------------------------------------------
    console.log("📖 Step 3: Expanding abbreviations...");
    
    // Simple Client-Side Map (Add your full list here)
    const ABBREVIATION_MAP: Record<string, string> = {
      "PCs": "Phonogram cards",
      "PWCs": "Phonogram word cards",
      "TM": "Teaching materials",
      "CM": "Classroom management",
      "(GA)": "(GA)", // Protect the tag
    };

    // Regex to match whole words only
    const expand = (t: string) => t.replace(/\b(PCs|PWCs|TM|CM)\b/g, m => ABBREVIATION_MAP[m] || m);
    const expandedText = expand(rawText);

    // -------------------------------------------------------
    // STEP 4: POLISH (Groq)
    // -------------------------------------------------------
    console.log("✨ Step 4: Sending to Groq (Polish)...");

    try {
      const polishedText = await polishTextWithGroq(expandedText);
      
      console.log("✅ Step 4 Complete. Polished Text:", polishedText);

      // -------------------------------------------------------
      // STEP 5: FINAL UPDATE (Replace Raw with Polished)
      // -------------------------------------------------------
      const finalCombined = existingComment
        ? `${existingComment}\n\n[OCR]\n${polishedText}`
        : `[OCR]\n${polishedText}`;

      updateIndicator(activeIndex, {
        commentText: finalCombined,
        aiPendingReview: true // Marks it as "Polished" purple
      });

    } catch (polishErr) {
      console.warn("⚠️ Groq Polish failed. Keeping raw text.", polishErr);
      // We don't alert here; the user at least has the raw text.
    }

  } catch (err) {
    console.error("❌ OCR Pipeline failed", err);
    setOcrError("Could not convert handwriting.");
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
    // 🟢 NEW: Mark as dirty so we know to save later
    isDirtyRef.current = true;
    
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
      <div className="workspace-top-bar"
      style={{ zIndex: 100, position: 'relative' }}
      >
        <div className="workspace-top-meta">
          <div className="workspace-top-line">
            <button className="btn" onClick={handleBackToDashboard} type="button">
              ← Back to Dashboard
            </button>
            <button 
              className="btn" 
              type="button" 
              onClick={() => setIsDesktopMode(!isDesktopMode)}
              style={{ background: isDesktopMode ? "#0ea5e9" : "#64748b", color: 'white' }}
            >
              {isDesktopMode ? "💻 PC Mode" : "📱 iPad Mode"}
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
                {!isDesktopMode && (
                  <button
                    className="btn"
                    type="button"
                    onClick={handleConvertAllInk}
                    disabled={isLocked || isBatchOcrRunning || isAiPolishing}
                    style={{
                      // Distinct color (e.g., Orange/Amber)
                      background: isBatchOcrRunning 
                        ? "#d97706" 
                        : "linear-gradient(135deg, #f59e0b, #b45309)", 
                      border: "none",
                      color: "white",
                      marginLeft: 8,
                      fontWeight: 500,
                      minWidth: 100 // Prevent resize jitter when text changes
                    }}
                  >
                    {isBatchOcrRunning ? (
                      <span>⌛ {batchOcrProgress || "Processing..."}</span>
                    ) : (
                      "📝 Convert All"
                    )}
                  </button>
                )}
              {/* 
              <button
                className="btn"
                type="button"
                onClick={handleToggleLock}
                style={{ fontWeight: 600 }}
              >
                {isLocked ? "Reopen as Draft" : "Mark Completed"}
              </button> */}
              <button className="btn" type="button" onClick={handleExportPreview}>
                Preview (teacher)
              </button>
              <button className="btn" type="button" onClick={handleAdminPreview}>
                Preview (admin)
              </button>
              {!isDesktopMode ? (
              <>
              <button
                className="btn"
                type="button"
                onClick={() => setShowScratchpad(true)}
              >
                Scratchpad
              </button>
              </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(30, 41, 59, 0.5)", padding: "4px 12px", borderRadius: "8px", border: "1px solid #334155" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>
                    OVERALL PERFORMANCE {!indicators[0]?.performance_rating && " *"}
                  </label>
                  <select
                    className="select"
                    value={indicators[0]?.performance_rating || ""}
                    onChange={(e) => {
                      const val = (e.target.value === "" ? null : e.target.value) as PerformanceRating;
                      setIndicators(prev => prev.map(ind => ({ ...ind, performance_rating: val })));
                    }}
                    style={{ height: "32px", fontSize: 12, background: "#0f172a", border: "1px solid #475569", color: "white", borderRadius: "6px" }}
                  >
                    <option value="">[ Select Rating ]</option>
                    <option value="Developing">Developing</option>
                    <option value="Functioning">Functioning</option>
                    <option value="Thriving">Thriving</option>
                  </select>
                </div>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: syncError ? "#ef4444" : "var(--text-muted)",
                fontWeight: syncError ? "bold" : "normal",
                textAlign: "right",
                // 🟢 NEW: Allow clicking if it is a storage error
                cursor: syncError && syncError.includes("Storage") ? "pointer" : "default",
                textDecoration: syncError && syncError.includes("Storage") ? "underline" : "none"
              }}
              // 🟢 NEW: The Rescue Action
              onClick={() => {
                if (syncError && syncError.includes("Storage")) {
                  if (window.confirm("Storage is full. Clear all temporary data to fix this? (Your saved data is safe on the server).")) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }
              }}
            >
              {syncError ? (
                <span>{syncError}</span>
              ) : lastSavedAt ? (
                saveStatus === "saved" ? (
                  `Saved ✔ at ${new Date(lastSavedAt).toLocaleTimeString()}`
                ) : (
                  `Saved locally at ${new Date(lastSavedAt).toLocaleTimeString()} (Pending Sync...)`
                )
              ) : (
                "Auto-save enabled"
              )}
            </div>   
          </div>
        </div>
      </div>
      <section className="main-layout">
        {!isDesktopMode && (
        <>
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
          <>
        {/* 1. THE RESIZABLE PANEL */}
            <div 
              className="indicator-panel" 
              style={{ 
                width: sidebarWidth, 
                flexShrink: 0, 
                display: "flex", 
                flexDirection: "column",
                // 🟢 FIX: Ensure transition doesn't fight with drag
                transition: isSidebarResizing ? "none" : "width 0.2s ease-out"
              }}
            >
              <div className="indicator-panel-header">
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* --- PERFORMANCE RATING DROPDOWN --- */}
                  <div style={{ 
                    padding: "10px 14px", 
                    borderBottom: "1px solid #334155", 
                    background: "rgba(15, 23, 42, 0.4)" 
                  }}>
                    <label style={{ 
                      display: "block", 
                      fontSize: 11, 
                      fontWeight: 600, 
                      color: observationStatus === "saved" ? "var(--text-muted)" : "var(--accent)",
                      marginBottom: 6 
                    }}>
                      OVERALL PERFORMANCE {!indicators[activeIndex]?.performance_rating && " *"}
                    </label>
                    <select
                      className="select"
                      // Use the first indicator's rating as the source of truth for the dropdown
                      value={indicators[0]?.performance_rating || ""} 
                      disabled={observationStatus === "saved"}
                      onChange={(e) => {
                        // 🟢 The Fix: Cast 'val' to 'PerformanceRating'
                        const val = (e.target.value === "" ? null : e.target.value) as PerformanceRating;
                        
                        // Update ALL indicators so the rating is consistent across the entire observation object
                        setIndicators(prev => prev.map(ind => ({ 
                          ...ind, 
                          performance_rating: val 
                        })));
                        
                        isDirtyRef.current = true;
                      }}
                      style={{
                        width: "100%",
                        fontSize: 13,
                        borderColor: !indicators[0]?.performance_rating ? "#f59e0b" : "#334155",
                        backgroundColor: "#0f172a"
                      }}
                    >
                      <option value="">[ Select Rating ]</option>
                      <option value="Developing">Developing</option>
                      <option value="Functioning">Functioning</option>
                      <option value="Thriving">Thriving</option>
                    </select>
                    {!indicators[activeIndex]?.performance_rating && observationStatus !== "saved" && (
                      <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4 }}>
                        ⚠️ Required before sync
                      </div>
                    )}
                  </div> 
                  {/* 🔒 NEW LOCK BUTTON */}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setIsResizerLocked(!isResizerLocked)}
                    title={isResizerLocked ? "Unlock width resizing" : "Lock width resizing (Palm rejection)"}
                    style={{ 
                      padding: "4px 8px", 
                      color: isResizerLocked ? "#f43f5e" : "var(--text-muted)", // Red if locked
                      background: isResizerLocked ? "rgba(244, 63, 94, 0.1)" : "transparent",
                      border: isResizerLocked ? "1px solid rgba(244, 63, 94, 0.3)" : "1px solid transparent"
                    }}
                  >
                    {isResizerLocked ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                    )}
                  </button>
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
              <div 
                className="indicator-list" 
                style={{ 
                  flexGrow: 1, 
                  overflowY: 'auto', // 🟢 Allows scrolling
                  paddingBottom: '40px', // 🟢 Space for the last item
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
              {indicators.map((ind, idx) => {
                if (filterMode === "good" && !ind.good) return null;
                if (filterMode === "growth" && !ind.growth) return null;
                if (filterMode === "favorites" && !ind.favorite) return null;
                
                const showDescription = sidebarWidth > 380; 
                const showAdminLabel = sidebarWidth > 300; 
                const isDescExpanded = expandedDesc[ind.id];

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
                    style={{
                      display: "flex",
                      flexDirection: "column", 
                      alignItems: "flex-start", 
                      gap: 8, 
                      padding: "12px 14px"
                    }}
                  >
                    {/* --- TITLE --- */}
                    <div 
                      className="indicator-title" 
                      style={{ 
                        width: "100%",
                        whiteSpace: "normal", 
                        textAlign: "left",
                        fontSize: 14,
                        fontWeight: 700,
                        lineHeight: 1.3,
                        color: "#f8fafc"
                      }}
                    >
                      <span style={{ marginRight: 6, opacity: 0.8 }}>{ind.number}</span>
                      {ind.title}
                    </div>

                    {/* --- DESCRIPTION --- */}
                    {showDescription && (
                      <div style={{ width: "100%", paddingLeft: 0, marginTop: 2 }}>
                        <div
                          style={isDescExpanded ? {
                            display: "block",
                            whiteSpace: "pre-wrap",
                            color: "#cbd5e1", 
                            fontSize: 12, 
                            lineHeight: 1.5,
                            marginBottom: 4,
                            overflow: "visible"
                          } : {
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "pre-wrap",
                            color: "#cbd5e1", 
                            fontSize: 12, 
                            lineHeight: 1.5,
                            marginBottom: 4
                          }} 
                        >
                          {ind.description}
                        </div>
                        
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDescription(ind.id);
                          }}
                          style={{ 
                            background: "none", 
                            border: "none", 
                            padding: "4px 0",
                            color: "var(--accent)", 
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4
                          }}
                        >
                          {isDescExpanded ? "See less" : "See more"}
                        </button>
                      </div>
                    )}

                    {/* --- RESTORED ACTIONS (Everything is back) --- */}
                    <div 
                      className="indicator-actions" 
                      style={{ 
                        marginTop: 4, 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "flex-start", 
                        gap: 10,
                        width: "100%"
                      }}
                    >
                      <div className="indicator-status-dots" onClick={(e) => e.stopPropagation()}>
                        {ind.strokes && ind.strokes.length > 0 && <span className="indicator-dot indicator-dot-ink" />}
                        {ind.commentText && ind.commentText.trim().length > 0 && <span className="indicator-dot indicator-dot-comment" />}
                        {ind.ocrUsed && <span className="indicator-dot indicator-dot-ocr" />}
                      </div>

                      {showDescription && (
                        <button
                          type="button"
                          className="btn"
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(idx); }}
                        >
                          {ind.favorite ? "⭐" : "☆"}
                        </button>
                      )}

                      <button
                        type="button"
                        className={`btn rating-btn rating-good ${ind.good ? "rating-selected" : ""}`}
                        onClick={(e) => { e.stopPropagation(); toggleGood(idx); }}
                      >
                        ✓
                      </button>

                      <button
                        type="button"
                        className={`btn rating-btn rating-growth ${ind.growth ? "rating-selected" : ""}`}
                        onClick={(e) => { e.stopPropagation(); toggleGrowth(idx); }}
                      >
                        ✕
                      </button>

                      {ind.hasPreComment && (
                        <button
                          type="button"
                          className="btn pre-comment-bubble"
                          onClick={(e) => { e.stopPropagation(); insertPreComment(idx); }}
                          title="Insert default comment"
                        >
                          💬
                        </button>
                      )}

                      <label
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          marginLeft: "auto", 
                          display: "flex", alignItems: "center", gap: 6,
                          fontSize: 10, color: "var(--text-muted)", cursor: "pointer",
                          whiteSpace: "nowrap"
                        }}
                        title="Include in Admin Report"
                      >
                        <input
                          type="checkbox"
                          checked={!!ind.includeInTrainerSummary}
                          onChange={() => toggleIncludeInTrainerSummary(idx)}
                          style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                        />
                        {showAdminLabel && <span>Admin report</span>}
                      </label>
                    </div>
                  </div>
                );
              })}
              </div>
              </div> 
        {/* 2. THE VISIBLE RESIZE HANDLE (Updated visual state) */}
            <div
              className="sidebar-resize-handle"
              onMouseDown={startSidebarResize}
              onTouchStart={startSidebarResize}
              style={{
                width: 12,
                // 🔒 CHANGE CURSOR: Indicates disabled state when locked
                cursor: isResizerLocked ? "not-allowed" : "col-resize", 
                background: "transparent",
                flexShrink: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // 🔒 CHANGE BORDER STYLE: Solid if Active/Unlocked, Dashed/Faint if Locked
                borderLeft: isSidebarResizing 
                  ? "2px solid var(--accent)" 
                  : (isResizerLocked ? "1px dashed rgba(71, 85, 105, 0.5)" : "1px solid #334155"),
                transition: "border-color 0.2s"
              }}
              // Disable hover highlight if locked
              onMouseEnter={(e) => !isResizerLocked && (e.currentTarget.style.borderLeft = "2px solid var(--accent)")}
              onMouseLeave={(e) => !isSidebarResizing && !isResizerLocked && (e.currentTarget.style.borderLeft = "1px solid #334155")}
            >
              {/* Optional Grip Icon - Hide if locked to visually indicate "disabled" */}
              {!isResizerLocked && (
                <div style={{ 
                  width: 4, height: 20, 
                  borderRadius: 2, 
                  background: isSidebarResizing ? "var(--accent)" : "#475569" 
                }} />
              )}
            </div>
          </>
        )}
        </>
        )}
        <div className="workspace-container">
           {showAdminPreview && adminPreview ? (
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
                  <div style={{ display: "flex", gap: "8px" }}>
                    {/* 🟢 NEW BUTTON: Runs the AI on demand */}
                      <button
                        type="button"
                        className={`btn ${isRecording ? 'pulse-red' : ''}`}
                        onClick={() => isRecording ? stopRecording('admin') : startRecording()}
                        disabled={isTranscribing || isGeneratingSummary}
                        style={{
                          background: isRecording ? "#ef4444" : "transparent",
                          border: "1px solid #f59e0b",
                          color: isRecording ? "white" : "#f59e0b"
                        }}
                      >
                        {isTranscribing ? "⌛ Transcribing..." : isRecording ? "🛑 Stop Recording" : "🎤 Record Summary"}
                      </button>
                      
                      <button
                        type="button"
                        className="btn"
                        onClick={handleGenerateAiSummary}
                        disabled={isGeneratingSummary}
                        style={{ 
                          background: "linear-gradient(135deg, #f59e0b, #d97706)", // Amber/Orange
                          color: "white",
                          border: "none"
                        }} 
                      >
                        {isGeneratingSummary ? "Generating..." : "✨ Generate AI Summary"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary" 
                        onClick={handleAdminReviewSave} 
                        style={{ backgroundColor: 'var(--color-primary)' }} 
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
                  </div>

                  {/* 🟢 NEW: Side-by-side flex container */}
                  <div style={{ display: "flex", gap: "16px", marginBottom: 16 }}>
                    
                    {/* LEFT SIDE: Read-Only Reference Data */}
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(148, 163, 184, 0.35)",
                        background: "rgba(15, 23, 42, 0.9)",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        Flagged Feedback Reference
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                        Read-only text from indicators marked for the Admin report.
                      </div>
                      <textarea
                        readOnly
                        value={indicators
                          .filter(ind => ind.includeInTrainerSummary)
                          .map(ind => `[${ind.number}] ${ind.title}\n${ind.commentText.trim()}`)
                          .join("\n\n")}
                        style={{
                          width: "100%",
                          resize: "none",
                          borderRadius: 8,
                          border: "1px solid rgba(51,65,85,0.9)",
                          background: "rgba(15, 23, 42, 0.5)",
                          color: "#94a3b8",
                          padding: 8,
                          fontSize: 12,
                          lineHeight: 1.4,
                          flexGrow: 1,
                          minHeight: "300px"
                        }}
                      />
                    </div>

                    {/* RIGHT SIDE: Editable Trainer Summary */}
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(148, 163, 184, 0.35)",
                        background: "rgba(15, 23, 42, 0.9)",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        Trainer summary (Admin sheet – merged cell E5–E18)
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                        Built automatically from indicators you checked as <em>Trainer summary</em>. You can edit / translate it here before exporting.
                      </div>
                      <textarea
                        value={adminPreview.trainerSummary ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAdminPreview((prev) =>
                            prev ? { ...prev, trainerSummary: value } : prev
                          );
                        }}
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
                          flexGrow: 1,
                          minHeight: "300px"
                        }}
                      />
                    </div>
                    
                  </div>              
                </div>
              ) : (
                <>
{isDesktopMode ? (
  <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    <div className="pc-scroll-feed" style={{ overflowY: 'auto', padding: '20px', height: '100%' }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button 
          type="button" 
          className="btn" 
          onClick={handleToggleAll}
          style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", color: "#94a3b8", fontSize: 12 }}
        >
          {openRowIds.size === indicators.length ? "▲ Collapse All Rows" : "▼ Expand All Rows"}
        </button>
      </div>
      
      {/* 🟢 FIXED: Add SortableContext wrapper and sort the map */}
{/* 🟢 FIXED: Add SortableContext wrapper and sort the map */}
      <SortableContext items={indicators.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {indicators
          .slice() // Copy array before sorting
          .sort((a, b) => ((a as any).sortOrder || 0) - ((b as any).sortOrder || 0))
          .map((ind, sortedIdx) => {
            
            // 🟢 FIXED: Calculate the true index in the original state array
            const globalIndex = indicators.findIndex(x => x.id === ind.id);

            if (filterMode === "good" && !ind.good) return null;
            if (filterMode === "growth" && !ind.growth) return null;
            if (filterMode === "favorites" && !ind.favorite) return null;

            return (
              <IndicatorRow 
                key={ind.id} 
                ind={ind} 
                // 🟢 FIXED: Pass globalIndex so text, buttons, and toggles update the correct row
                idx={globalIndex} 
                activeRowId={activeRowId}
                openRowIds={openRowIds}
                pinnedRowIds={pinnedRowIds}
                activeIndex={activeIndex}
                isAiPolishing={isAiPolishing}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                setActiveIndex={setActiveIndex}
                handleRowToggle={handleRowToggle}
                setActiveRowId={setActiveRowId}
                togglePin={togglePin}
                insertPreComment={insertPreComment}
                toggleGood={toggleGood}
                toggleGrowth={toggleGrowth}
                toggleIncludeInTrainerSummary={toggleIncludeInTrainerSummary}
                handlePolishWithAi={handlePolishWithAi}
                startRecording={startRecording}
                stopRecording={stopRecording}
                handleCommentChange={handleCommentChange}
                handleSendToTop={handleSendToTop}
              />
            );
        })}
      </SortableContext>
    </div>
  </DndContext>
            ) : (
            <div className="canvas-card">

                <>
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
                      onClick={() => toggleDescription(active.id)}
                      style={{ 
                        background: "none", 
                        border: "none", 
                        padding: "4px 0",
                        color: "var(--accent)", 
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4
                      }}
                    >
                      {expandedDesc[active.id] ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 15l-6-6-6 6"/>
                          </svg>
                          See less
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6"/>
                          </svg>
                          See more
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
                
            {/* 🟢 MODIFIED: Strict Alignment using Flexbox and Box-Sizing */}
  {sidebarCollapsed && (
    <div
      style={{
        display: "flex",
        alignItems: "center",      // 👈 Vertical Center axis
        justifyContent: "flex-start",
        gap: 12,
        marginBottom: 10,
        marginTop: 4,
        height: "32px",            // 👈 Hard constraint on container
      }}
    >
      {/* 1. The Dropdown Group */}
      <div style={{ display: "flex", alignItems: "center", height: "100%" }}>
        <label 
          className="quick-jump-label" 
          style={{ 
            margin: "0 8px 0 0", 
            whiteSpace: 'nowrap',
            fontSize: 13,
            color: "var(--text-muted)",
            lineHeight: 1
          }}
        >
          Jump to:
        </label>
        <select
          value={activeIndex}
          onChange={(e) => setActiveIndex(Number(e.target.value))}
          style={{ 
            // Sizing
            height: "32px", 
            minWidth: "220px",
            maxWidth: "300px",
            boxSizing: "border-box", // Includes padding/border in height
            
            // Reset defaults
            margin: 0,
            padding: "0 24px 0 8px", // Right padding for arrow space
            
            // Visuals
            background: "#0f172a", // Dark background to match theme
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: "6px",
            fontSize: "13px",
            outline: "none",
            cursor: "pointer"
          }}
        >
          {indicators.map((i, idx) => (
            <option key={i.id} value={idx}>
              {i.number} — {i.title}
            </option>
          ))}
        </select>
      </div>

      {/* 2. The Action Buttons Group */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: "100%" }}>
        
        {/* Good Button */}
        <button
          type="button"
          onClick={() => toggleGood(activeIndex)}
          title="Mark as Good"
          style={{ 
            // 🛑 STRICT RESET
            appearance: "none",
            margin: 0,
            padding: 0,
            
            // Sizing
            height: "32px", 
            width: "32px",
            minWidth: "32px", 
            boxSizing: "border-box",
            
            // Visuals
            borderRadius: "50%",
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            border: active.good ? "1px solid transparent" : "1px solid #334155",
            background: active.good ? "var(--color-good, #22c55e)" : "transparent",
            color: active.good ? "#fff" : "#94a3b8",
            cursor: "pointer",
            fontSize: "14px",
            transition: "all 0.1s"
          }} 
        >
          ✓
        </button>

        {/* Growth Button */}
        <button
          type="button"
          onClick={() => toggleGrowth(activeIndex)}
          title="Mark as Growth"
          style={{ 
            appearance: "none",
            margin: 0,
            padding: 0,
            height: "32px", 
            width: "32px", 
            minWidth: "32px", 
            boxSizing: "border-box",
            borderRadius: "50%",
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            border: active.growth ? "1px solid transparent" : "1px solid #334155",
            background: active.growth ? "var(--color-growth, #ef4444)" : "transparent",
            color: active.growth ? "#fff" : "#94a3b8",
            cursor: "pointer",
            fontSize: "14px",
            transition: "all 0.1s"
          }} 
        >
          ✕
        </button>

        {/* Pre-comment Button */}
        {active.hasPreComment && (
          <button
              type="button"
              onClick={() => insertPreComment(activeIndex)}
              title="Insert default comment"
              style={{
                appearance: "none",
                margin: 0,
                padding: 0,
                height: "32px", 
                width: "32px", 
                minWidth: "32px", 
                boxSizing: "border-box",
                borderRadius: "50%", 
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid #475569", 
                color: "#94a3b8",
                cursor: "pointer",
                transition: "all 0.2s"            
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#60a5fa"; 
                e.currentTarget.style.color = "#60a5fa";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#475569";
                e.currentTarget.style.color = "#94a3b8";
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"></circle>
                <circle cx="12" cy="11" r="0.5" fill="currentColor" stroke="none"></circle>
                <circle cx="16" cy="11" r="0.5" fill="currentColor" stroke="none"></circle>
              </svg>
            </button>
        )}

        {/* Admin Checkbox */}
        <label
          style={{
            display: "flex", 
            alignItems: "center", 
            gap: 6,
            fontSize: 11, 
            color: "var(--text-muted)", 
            cursor: "pointer",
            whiteSpace: "nowrap", 
            marginLeft: 6,
            height: "32px", 
            margin: 0,
            userSelect: "none"
          }}
          title="Include in Admin Report"
        >
          <input
            type="checkbox"
            checked={!!active.includeInTrainerSummary}
            onChange={() => toggleIncludeInTrainerSummary(activeIndex)}
            style={{ 
              width: 14, 
              height: 14, 
              margin: 0, 
              accentColor: "var(--accent)",
              cursor: "pointer" 
            }}
          />
          <span>Admin</span>
        </label>

      </div>
    </div>
  )}         

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
                  isResizeLocked={isCanvasLocked}
                  onToggleResizeLock={() => setIsCanvasLocked(!isCanvasLocked)}
                />
              </div>
  
              {isCanvasVisible && (
                <div
                  className="canvas-resize-handle"
                  onMouseDown={startCanvasResize}
                  onTouchStart={startCanvasResize}
                  style={{
                    // 🔒 Visual feedback for locked state
                    cursor: isCanvasLocked ? "default" : "row-resize",
                    opacity: isCanvasLocked ? 0.2 : 1,
                    pointerEvents: isCanvasLocked ? "none" : "auto" 
                  }}
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
                  className={`btn ${isRecording ? 'pulse-red' : ''}`}
                  onClick={() => isRecording ? stopRecording('indicator') : startRecording()}
                  disabled={isTranscribing || isAiPolishing}
                  style={{
                    background: isRecording ? "#ef4444" : "var(--bg-card)",
                    color: isRecording ? "white" : "var(--accent)",
                    border: "1px solid var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                  }}
                >
                  {isTranscribing ? "⌛..." : isRecording ? "🛑 Stop" : "🎤 Rec"}
                </button>
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
            </>
             
            </div>
            )}
              {showExportPreview && exportPreview && (
                <div className="scratchpad-backdrop"
                style={{ zIndex: 1000 }}
                >
                
                  <div 
                    className="scratchpad-modal" 
                    style={{ 
                      width: '95vw', 
                      height: '95vh', 
                      maxWidth: '1200px', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      padding: 0, 
                      overflow: 'hidden' 
                    }}
                  >
                    {(() => {
                      // --- HELPERS ---
                      const isEmpty = (text: string | undefined) => !text || text.trim().length === 0;

                      // 1. CALCULATE WARNINGS
                      const warningMap = indicators.reduce<Record<string, string[]>>((acc, ind) => {
                          const edit = previewEdits[ind.id] || { strengths: "", growths: "" };
                          const issues: string[] = [];

                          if (ind.growth && isEmpty(edit.growths)) issues.push("growth-empty");
                          if (ind.good && isEmpty(edit.strengths) && ind.preComment) issues.push("good-template");
                          if (ind.ocrPendingReview || ind.aiPendingReview) issues.push("pending-review");
                          if (!ind.good && !ind.growth) issues.push("unchecked");

                          const hasInk = ind.strokes?.some(s => s.points.length > 0);
                          if (hasInk && !ind.ocrUsed) issues.push("ink-ignored");

                          if (issues.length > 0) acc[ind.number] = issues;
                          return acc;
                      }, {});

                      // 2. SCROLL / JUMP HELPERS
                      const handleScrollToRow = (num: string) => {
                          const el = document.getElementById(`preview-row-${num}`);
                          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      };

                      const renderScrollLinks = (filterFn: (issues: string[]) => boolean) => {
                          const nums = Object.keys(warningMap).filter(num => filterFn(warningMap[num]));
                          if (nums.length === 0) return null;
                          return nums.map((num, i) => (
                              <button
                                  key={num}
                                  type="button"
                                  className="preview-indicator-link"
                                  style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', fontSize: 'inherit' }}
                                  onClick={() => handleScrollToRow(num)}
                              >
                                  {num}{i < nums.length - 1 ? ", " : ""}
                              </button>
                          ));
                      };

                      // 3. ACTIONS
                      const handleApproveAll = () => {
                          if (!window.confirm("Mark ALL visible text as reviewed?")) return;
                          setIndicators(prev => prev.map(ind => ({
                              ...ind,
                              ocrPendingReview: false,
                              aiPendingReview: false
                          })));
                      };

                      const handleJumpToIndicator = (index: number) => {
                          handleSavePreview(index); 
                      };

                      const hasPending = Object.values(warningMap).some((list: string[]) => list.includes("pending-review"));
                      const hasEmptyGrowth = Object.values(warningMap).some((list: string[]) => list.includes("growth-empty"));
                      const hasTemplate = Object.values(warningMap).some((list: string[]) => list.includes("good-template"));

                      // 4. INTERNAL BANNER COMPONENT
                      const Banner = ({ color, bg, icon, label, filter, action }: any) => (
                          <div style={{ 
                              display: 'flex', 
                              alignItems: "center", 
                              justifyContent: "space-between",
                              border: `1px solid ${color}`, 
                              color: color, 
                              background: bg, 
                              padding: "8px 12px", 
                              borderRadius: "10px",
                              fontSize: "13px",
                              fontWeight: 500
                          }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: "center" }}>
                                  <span>{icon} {label}</span>
                                  {renderScrollLinks(filter)}
                              </div>
                              {action && <div>{action}</div>}
                          </div>
                      );

                      return (
                        <div className="export-preview-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                          
                          {/* --- TOP BANNERS --- */}
                          <div style={{ flexShrink: 0, padding: "16px 16px 0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                              
                              {hasPending && (
                                  <Banner 
                                      color="#ca8a04" 
                                      bg="rgba(202, 138, 4, 0.1)" 
                                      icon="⚠" 
                                      label="Unreviewed Text in:" 
                                      filter={(issues: string[]) => issues.includes("pending-review")}
                                      action={
                                          <button type="button" onClick={handleApproveAll} style={{ fontSize: 11, background: "#fff", border: "1px solid #ca8a04", color: "#ca8a04", borderRadius: 4, cursor: "pointer", padding: "2px 8px", fontWeight: "bold" }}>
                                              ✓ Approve All
                                          </button>
                                      }
                                  />
                              )}

                              {hasEmptyGrowth && (
                                  <Banner 
                                      color="#ef4444" 
                                      bg="rgba(239, 68, 68, 0.1)"
                                      icon="⚠" 
                                      label="Empty Growth Areas in:" 
                                      filter={(issues: string[]) => issues.includes("growth-empty")}
                                  />
                              )}

                              {hasTemplate && (
                                  <Banner 
                                      color="#3b82f6" 
                                      bg="rgba(59, 130, 246, 0.1)"
                                      icon="ℹ" 
                                      label="Use 'Insert Default' for:" 
                                      filter={(issues: string[]) => issues.includes("good-template")}
                                  />
                              )}
                          </div>

                          {/* --- HEADER (Uniform Buttons) --- */}
                          <div className="export-preview-header" style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
                            <div>
                              <div className="export-preview-title">Teacher export preview</div>
                              <div className="export-preview-sub">{exportPreview.teacherName} • {exportPreview.schoolName}</div>
                            </div>

                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                {/* AI Polish */}
                                <button type="button" className="btn" 
                                    style={{ 
                                        height: 40, minWidth: 140, borderRadius: 20, fontSize: 13, fontWeight: 600, border: "none", color: "white", 
                                        background: "linear-gradient(135deg, #6366f1, #8b5cf6)", 
                                        display: "flex", alignItems: "center", justifyContent: "center", cursor: isAiPolishing ? "not-allowed" : "pointer", opacity: isAiPolishing ? 0.7 : 1
                                    }} 
                                    onClick={handlePreviewPolishAll} disabled={isAiPolishing}
                                >
                                    {isAiPolishing ? "✨ Polishing..." : "✨ AI Polish All"}
                                </button>

                                {/* Save & Update */}
                                <button type="button" className="btn" 
                                    style={{ 
                                        height: 40, minWidth: 140, borderRadius: 20, fontSize: 13, fontWeight: 600, border: "none", color: "white", 
                                        backgroundColor: "#06b6d4", // Teal/Cyan
                                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                                    }} 
                                    onClick={() => handleSavePreview()}
                                >
                                    Save & Update
                                </button>

                                {/* Close */}
                                <button type="button" className="btn" 
                                    style={{ 
                                        height: 40, minWidth: 140, borderRadius: 20, fontSize: 13, fontWeight: 600, 
                                        border: "1px solid #334155", color: "#94a3b8", background: "transparent",
                                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                                    }} 
                                    onClick={() => setShowExportPreview(false)}
                                >
                                    Close
                                </button>
                            </div>
                          </div>

                          {/* --- SCROLLABLE TABLE --- */}
                          <div className="export-preview-table-container" style={{ flexGrow: 1, overflowY: "auto", padding: 0 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead style={{ position: "sticky", top: 0, background: "#1e293b", zIndex: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
                                    <tr>
                                      <th style={{ padding: "12px 16px", textAlign: "left", width: "25%", color: "#94a3b8", fontWeight: 600 }}>Indicator</th>
                                      <th style={{ padding: "12px 16px", textAlign: "left", width: "37.5%", color: "#4ade80", fontWeight: 600 }}>Good Points</th>
                                      <th style={{ padding: "12px 16px", textAlign: "left", width: "37.5%", color: "#f87171", fontWeight: 600 }}>Growth Areas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {exportPreview.rows.map((row) => {
                                      const indIndex = indicators.findIndex(i => 
                                          i.number === row.matchKey || 
                                          i.number.replace(/[^\d]/g, '') === row.indicatorLabel.substring(0, 15).replace(/[^\d]/g, '')
                                      );
                                      if (indIndex === -1) return null;
                                      const ind = indicators[indIndex];

                                      const edit = previewEdits[ind.id] || { strengths: "", growths: "" };
                                      
                                      const issues = warningMap[ind.number] || [];
                                      const isPending = issues.includes("pending-review");
                                      const isEmptyGrowth = issues.includes("growth-empty");
                                      const isTemplateOnly = issues.includes("good-template");
                                      const isInkIgnored = issues.includes("ink-ignored");

                                      return (
                                          <tr id={`preview-row-${ind.number}`} key={ind.id} style={{ borderBottom: "1px solid #334155" }}>
                                            
                                            {/* COL 1: INFO & BADGES */}
                                            <td style={{ padding: 16, verticalAlign: "top", color: "#e2e8f0", background: "#0f172a" }}>
                                                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                                                  <strong style={{ fontSize: 14, color: "#fff" }}>{ind.number}</strong>
                                                  <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{ind.title}</span>
                                                </div>
                                                <div style={{ fontSize: 11, marginTop: 6, color: "#94a3b8", lineHeight: 1.4 }}>{ind.description}</div>
                                                
                                                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                    {isInkIgnored && (
                                                        <button 
                                                          type="button"
                                                          onClick={() => handleJumpToIndicator(indIndex)}
                                                          style={{ fontSize: 10, background: "#64748b", color: "white", padding: "2px 6px", borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                                        >
                                                          ✎ Ink Ignored (Save & Jump) ➜
                                                        </button>
                                                    )}
                                                    {isPending && (
                                                        <span style={{ fontSize: 10, background: "#ca8a04", color: "white", padding: "2px 6px", borderRadius: 4 }}>⚠ Review Needed</span>
                                                    )}
                                                    {isEmptyGrowth && (
                                                        <span style={{ fontSize: 10, background: "#ef4444", color: "white", padding: "2px 6px", borderRadius: 4 }}>⚠ Empty Growth</span>
                                                    )}
                                                </div>
                                            </td>
                                            
                                            {/* COL 2: GOOD POINTS */}
                                            <td style={{ padding: 12, verticalAlign: "top", background: "#0f172a", position: 'relative' }}>
                                              <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 'bold', color: ind.good ? '#4ade80' : '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                  {ind.good ? (<span>✅ Checked Good</span>) : (<span>⬜ Not Checked</span>)}
                                              </div>

                                              <div style={{ position: 'relative' }}>
                                                  <textarea 
                                                      className="input"
                                                      placeholder={ind.good ? "Add strengths..." : "Add text here (Will check 'Good')"}
                                                      style={{ 
                                                          width: "100%", 
                                                          // 🟢 CHANGED: Increased minHeight to 120px for better iPad touch area
                                                          minHeight: 120, 
                                                          fontSize: 13, 
                                                          background: "#1e293b", border: "1px solid #334155", 
                                                          color: "#e2e8f0", lineHeight: 1.5, padding: "10px", 
                                                          borderRadius: "8px", 
                                                          // 🟢 CRITICAL: Enables dragging to resize vertically
                                                          resize: "vertical" 
                                                      }}
                                                      value={edit.strengths}
                                                      onChange={(e) => setPreviewEdits(prev => {
                                                          const current = prev[ind.id] || { strengths: "", growths: "" };
                                                          return { ...prev, [ind.id]: { ...current, strengths: e.target.value } };
                                                      })}
                                                  />
                                                  {isTemplateOnly && (
                                                      <button 
                                                          type="button"
                                                          className="btn"
                                                          style={{ 
                                                              position: 'absolute', bottom: 8, right: 8, 
                                                              fontSize: 10, padding: "2px 8px", 
                                                              background: "rgba(59, 130, 246, 0.2)", color: "#60a5fa", border: "1px solid #60a5fa"
                                                          }}
                                                          onClick={() => setPreviewEdits(prev => {
                                                              const current = prev[ind.id] || { strengths: "", growths: "" };
                                                              return { ...prev, [ind.id]: { ...current, strengths: ind.preComment || "" } };
                                                          })}
                                                      >
                                                          📋 Insert Default
                                                      </button>
                                                  )}
                                                  {isPending && !isEmpty(edit.strengths) && (
                                                      <button 
                                                          type="button"
                                                          title="Mark Reviewed"
                                                          style={{ 
                                                              position: 'absolute', top: 8, right: 8, 
                                                              background: "#10b981", color: "white", border: "none",
                                                              borderRadius: "50%", width: 20, height: 20, cursor: "pointer",
                                                              display: "flex", alignItems: "center", justifyContent: "center"
                                                          }}
                                                          onClick={() => setIndicators(prev => prev.map(x => x.id === ind.id ? { ...x, ocrPendingReview: false, aiPendingReview: false } : x))}
                                                      >
                                                          ✓
                                                      </button>
                                                  )}
                                              </div>
                                            </td>

                                            {/* COL 3: GROWTH AREAS */}
                                            <td style={{ padding: 12, verticalAlign: "top", background: "#0f172a" }}>
                                              <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 'bold', color: ind.growth ? '#f87171' : '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                  {ind.growth ? (<span>✅ Checked Growth</span>) : (<span>⬜ Not Checked</span>)}
                                              </div>

                                              <div style={{ position: 'relative' }}>
                                                  <textarea 
                                                      className="input"
                                                      placeholder={ind.growth ? "Add growth areas..." : "Add text here (Will check 'Growth')"}
                                                      style={{ 
                                                          width: "100%", 
                                                          // 🟢 CHANGED: Increased minHeight to 120px
                                                          minHeight: 120, 
                                                          fontSize: 13, 
                                                          background: "#1e293b", 
                                                          border: isEmptyGrowth ? "1px solid #ef4444" : "1px solid #334155", 
                                                          color: "#e2e8f0", lineHeight: 1.5, padding: "10px", 
                                                          borderRadius: "8px", 
                                                          // 🟢 CRITICAL: Enables dragging to resize vertically
                                                          resize: "vertical" 
                                                      }}
                                                      value={edit.growths}
                                                      onChange={(e) => setPreviewEdits(prev => {
                                                          const current = prev[ind.id] || { strengths: "", growths: "" };
                                                          return { ...prev, [ind.id]: { ...current, growths: e.target.value } };
                                                      })}
                                                  />
                                                  {isPending && !isEmpty(edit.growths) && (
                                                      <button 
                                                          type="button"
                                                          title="Mark Reviewed"
                                                          style={{ 
                                                              position: 'absolute', top: 8, right: 8, 
                                                              background: "#10b981", color: "white", border: "none",
                                                              borderRadius: "50%", width: 20, height: 20, cursor: "pointer",
                                                              display: "flex", alignItems: "center", justifyContent: "center"
                                                          }}
                                                          onClick={() => setIndicators(prev => prev.map(x => x.id === ind.id ? { ...x, ocrPendingReview: false, aiPendingReview: false } : x))}
                                                      >
                                                          ✓
                                                      </button>
                                                  )}
                                              </div>
                                            </td>
                                          </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )} 
              </>  
           )} 
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
const pillStyle = (color: string) => ({
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  padding: '2px 6px',
  borderRadius: '4px',
  background: `${color}22`,
  color: color,
  border: `1px solid ${color}44`,
  letterSpacing: '0.5px'
});

const quickMarkStyle = (active: boolean, color: string) => ({
  width: 28, height: 28, borderRadius: "50%", 
  border: active ? "none" : "1px solid #334155",
  background: active ? color : "transparent",
  color: active ? "white" : "#94a3b8", 
  fontSize: 12, cursor: "pointer",
  transition: "all 0.1s",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
});

interface IndicatorRowProps {
  ind: IndicatorState;
  idx: number;
  isSidebar?: boolean;
  activeRowId: string | null;
  openRowIds: Set<string>;
  pinnedRowIds: Set<string>;
  activeIndex: number;
  isAiPolishing: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  setActiveIndex: (idx: number) => void;
  handleRowToggle: (id: string) => void;
  setActiveRowId: (id: string) => void;
  togglePin: (e: React.MouseEvent, id: string) => void;
  insertPreComment: (idx: number) => void;
  toggleGood: (idx: number) => void;
  toggleGrowth: (idx: number) => void;
  toggleIncludeInTrainerSummary: (idx: number) => void;
  handlePolishWithAi: () => void;
  startRecording: () => void;
  stopRecording: (target: 'indicator' | 'admin') => void;
  handleCommentChange: (idx: number, val: string) => void;
  handleSendToTop: (id: string) => void;
}  
// 🟢 REFACTORED UNIFIED ROW COMPONENT
const IndicatorRow = React.memo(({ 
  ind, idx, isSidebar = false, activeRowId, openRowIds, pinnedRowIds, 
  activeIndex, isAiPolishing, isRecording, isTranscribing,
  setActiveIndex, handleRowToggle, setActiveRowId, togglePin,
  insertPreComment, toggleGood, toggleGrowth, toggleIncludeInTrainerSummary,
  handlePolishWithAi, startRecording, stopRecording, handleCommentChange, handleSendToTop
}: IndicatorRowProps) => {
const isExpanded = 
  openRowIds.has(ind.id) ||   // 🟢 Priority: Global Expand/Collapse state
  activeRowId === ind.id ||   // Individual selection
  pinnedRowIds.has(ind.id);   // Individual pins
  const isPinned = pinnedRowIds.has(ind.id);
  const hasInk = ind.strokes?.some(s => s.points && s.points.length > 0);
  const hasText = ind.commentText?.trim().length > 0;
  const [isHovered, setIsHovered] = useState(false);
  

  // 🟢 STABILIZER: Ref for the textarea to replace jumpy autoFocus
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 🟢 WARNING LOGIC: (Identical to your snippet)
  const isMissingComment = (ind.good || ind.growth) && !hasText;
  const needsReview = !!(ind.ocrPendingReview || ind.aiPendingReview);
  const convertInk = !!(hasInk && !ind.ocrUsed);

const {
  attributes,
  listeners,
  setNodeRef,
  transform,
  transition,
  isDragging
} = useSortable({ id: ind.id });

const style = {
  // 🟢 FIXED: Use Translate instead of Transform to prevent text stretching
  transform: CSS.Translate.toString(transform), 
  transition,
  zIndex: isDragging ? 100 : 1,
  opacity: isDragging ? 0.5 : 1,
};

// 🟢 STABILIZER: Focus without scrolling when expanding
useEffect(() => {
  if (isExpanded && !isSidebar && textareaRef.current) {
    textareaRef.current.focus({ preventScroll: true });
  }
}, [isExpanded, isSidebar]);

const handleClick = () => {
  setActiveIndex(idx); 
  handleRowToggle(ind.id); 
};

return (
  <div
    ref={setNodeRef} /* 🟢 FIXED: Attach DND Ref */
    key={ind.id} 
    className={`pc-row ${isExpanded ? "active" : ""}`}
    onClick={handleClick}
    onDoubleClick={(e) => {
      e.stopPropagation();
      togglePin(e, ind.id);
    }}
    onMouseEnter={() => setIsHovered(true)} 
    onMouseLeave={() => setIsHovered(false)}
    style={{
      ...style, /* 🟢 FIXED: Inject DND transforms here */
      background: isExpanded ? "rgba(30, 41, 59, 0.9)" : isHovered ? "rgba(51, 65, 85, 0.4)" : "var(--bg-card)",
      border: isExpanded ? "1px solid var(--accent)" : "1px solid #334155",
      padding: '12px 16px',
      borderRadius: '10px',
      marginBottom: '8px',
      transition: isDragging ? "none" : "all 0.2s ease", /* Prevent transition stutter while dragging */
      cursor: "pointer",
      boxShadow: isExpanded ? "0 4px 12px rgba(0,0,0,0.3)" : isDragging ? "0 10px 20px rgba(0,0,0,0.5)" : "none",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        
        {/* 🟢 FIXED: The Draggable Grip Handle */}
        <div 
          {...attributes} 
          {...listeners}
          onClick={(e) => e.stopPropagation()} // Stop accordion toggle when grabbing
          style={{ cursor: isDragging ? 'grabbing' : 'grab', padding: '4px', touchAction: 'none', display: 'flex', alignItems: 'center' }}
        >
          <svg width="12" height="18" viewBox="0 0 12 18" fill={isHovered ? "#94a3b8" : "#475569"}>
            <circle cx="2" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" />
            <circle cx="8" cy="2" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="14" r="1.5" />
          </svg>
        </div>

        <div style={{ width: 4, height: 24, borderRadius: 2, background: ind.good ? "#22c55e" : ind.growth ? "#ef4444" : "#475569" }} />
        <span style={{ fontWeight: 700, color: "#94a3b8", fontSize: 13 }}>{ind.number}</span>
        <span style={{ fontWeight: 600, color: "#f8fafc", fontSize: 14 }}>{ind.title}</span>

          <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
              {!isExpanded && (
                <>
                    {hasInk && <span style={pillStyle("#3b82f6")}>Ink</span>}
                    {hasText && <span style={pillStyle("#a855f7")}>Text</span>}
                    {ind.ocrUsed && <span style={pillStyle("#eab308")}>OCR</span>}
                </>
              )}
              {!isSidebar && (
                <>
                    {isMissingComment && <span style={pillStyle("#ef4444")}>Missing Comment</span>}
                    {needsReview && <span style={pillStyle("#eab308")}>Needs Review</span>}
                    {convertInk && <span style={pillStyle("#3b82f6")}>Convert Ink</span>}
                </>
              )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {ind.hasPreComment && (
            <button type="button" onClick={(e) => { e.stopPropagation(); insertPreComment(idx); }}
              style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", opacity: 0.6 }}>💬</button>
          )}
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleGood(idx); }} style={quickMarkStyle(ind.good, "#22c55e")}>✓</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleGrowth(idx); }} style={quickMarkStyle(ind.growth, "#ef4444")}>✕</button>
          
          {/* 📌 Pin Button (Lucide) */}
          <button 
            type="button" 
            onClick={(e) => { e.stopPropagation(); togglePin(e, ind.id); }}
            style={{ 
              background: "none", 
              border: "none", 
              cursor: "pointer", 
              color: isPinned ? "#f43f5e" : "#94a3b8", // Rose if pinned, slate if not
              opacity: isPinned ? 1 : 0.5,
              transition: "all 0.2s",
              display: "flex", 
              alignItems: "center", 
              padding: 4
            }}
            onMouseEnter={(e) => { if(!isPinned) e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { if(!isPinned) e.currentTarget.style.opacity = "0.5"; }}
            title={isPinned ? "Unpin row" : "Pin row"}
          >
            {/* Fills the pin icon and thickens the lines when active */}
            <Pin size={16} fill={isPinned ? "currentColor" : "none"} strokeWidth={isPinned ? 2 : 1.5} />
          </button>

          {/* ⬆️ Send to Top Button (Lucide) */}
          <button 
            type="button" 
            onClick={(e) => { e.stopPropagation(); handleSendToTop(ind.id); }}
            style={{ 
              background: "none", 
              border: "none", 
              cursor: "pointer", 
              color: "#94a3b8", 
              opacity: 0.5,
              transition: "all 0.2s",
              display: "flex", 
              alignItems: "center", 
              padding: 4
            }}
            onMouseEnter={(e) => { 
              e.currentTarget.style.opacity = "1"; 
              e.currentTarget.style.color = "#3b82f6"; // Blue highlight on hover
            }} 
            onMouseLeave={(e) => { 
              e.currentTarget.style.opacity = "0.5"; 
              e.currentTarget.style.color = "#94a3b8"; 
            }}
            title="Send to Top"
          >
            <ArrowUpToLine size={16} strokeWidth={2} />
          </button>
          <input type="checkbox" checked={!!ind.includeInTrainerSummary} onClick={(e) => e.stopPropagation()} onChange={() => toggleIncludeInTrainerSummary(idx)}
             style={{ marginLeft: 4, accentColor: "var(--accent)" }} />
        </div>
      </div>

      {isExpanded && (
        <div style={{ marginTop: 16, borderTop: "1px solid #334155", paddingTop: 16 }}>
          <p style={{ fontSize: 13, color: "#cbd5e1", marginBottom: isSidebar ? 0 : 12 }}>{ind.description}</p>
          
          {!isSidebar && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn" onClick={(e) => { e.stopPropagation();setActiveIndex(idx); handlePolishWithAi(); }} disabled={isAiPolishing || ind.commentText.length < 5}>
                  {isAiPolishing ? "✨..." : "✨ AI Polish"}
                </button>
                <button type="button" className="btn" onClick={(e) => { 
                    e.stopPropagation(); 
                    setActiveIndex(idx); 
                    isRecording ? stopRecording('indicator') : startRecording(); 
                  }}
                  style={{ 
                    background: (isRecording && activeIndex === idx) ? "#ef4444" : "transparent",
                    border: "1px solid var(--accent)",
                    color: (isRecording && activeIndex === idx) ? "white" : "var(--accent)",
                    padding: "4px 12px", fontSize: 12, borderRadius: 20
                  }}
                >
                  {isTranscribing && activeIndex === idx ? "⌛..." : (isRecording && activeIndex === idx) ? "🛑 Stop" : "🎤 Rec"}
                </button>
              </div>
              <textarea
                ref={textareaRef} // 🟢 STABILIZER: Controlled focus
                value={ind.commentText}
                onChange={(e) => handleCommentChange(idx, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{ 
                    width: "100%", minHeight: 120, background: "#020617", color: "white", padding: 12, borderRadius: 8, 
                    border: isMissingComment ? "1px solid #ef4444" : needsReview ? "1px solid #eab308" : "1px solid #475569" 
                }}
                placeholder="Type your observations here..."
              />
            </>
          )}
        </div>
      )}
    </div>
  );
});