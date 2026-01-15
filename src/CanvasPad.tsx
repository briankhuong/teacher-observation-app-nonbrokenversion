import React, { useLayoutEffect, useRef, useState, useCallback } from "react";
import { getStroke } from "perfect-freehand";

const usePersistedState = <T,>(key: string, defaultValue: T) => {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      return defaultValue;
    }
  });

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      // Ignore write errors
    }
  }, [key, state]);

  return [state, setState] as const;
};

// ------------------------------------------------------------------
// 1. Configuration (Standard Pen Feel)
// ------------------------------------------------------------------
const STROKE_OPTIONS = {
  size: 3,
  thinning: 0.3,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => t,
  start: { taper: 0, easing: (t: number) => t, cap: true },
  end: { taper: 0, easing: (t: number) => t, cap: true },
};
function getSvgPathFromStroke(strokePoints: number[][]) {
  const len = strokePoints.length;
  if (!len) return "";
  const d = strokePoints.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % len];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...strokePoints[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}
export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}
export interface Stroke {
  color: string;
  size: number;
  points: StrokePoint[];
  mode: "pen" | "eraser";
}
// ------------------------------------------------------------------
// Eraser Utility
// ------------------------------------------------------------------
const ERASER_HIT_DISTANCE_SQUARED = 5 * 5; // Distance of 5px squared for 'on contact' comparison
function isStrokeIntersecting(eraserPoints: StrokePoint[], targetStroke: Stroke): boolean {
  for (const ePoint of eraserPoints) {
    for (const tPoint of targetStroke.points) {
      const dx = ePoint.x - tPoint.x;
      const dy = ePoint.y - tPoint.y;
      // We check distance squared to avoid Math.sqrt
      if (dx * dx + dy * dy < ERASER_HIT_DISTANCE_SQUARED) {
        return true;
      }
    }
  }
  return false;
}
interface CanvasPadProps {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  readOnly?: boolean;
  isResizeLocked?: boolean;
  onToggleResizeLock?: () => void;
}
// ------------------------------------------------------------------
// 2. Component
// ------------------------------------------------------------------
export const CanvasPad = React.memo<CanvasPadProps>(({
  strokes,
  onChange,
  readOnly = false,
  isResizeLocked,
  onToggleResizeLock,
}) => {
  // Element Refs
  const canvasStaticRef = useRef<HTMLCanvasElement | null>(null);
  const canvasLiveRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // State Refs (Mutable source of truth to bypass React lag)
  const history = useRef<Stroke[]>(strokes);
  const currentStroke = useRef<StrokePoint[]>([]);
  const isDrawing = useRef(false);
  // Tools
  const [mode, setMode] = usePersistedState<"pen" | "eraser">("canvas-tool-mode", "pen");
  const [color, setColor] = usePersistedState<string>("canvas-tool-color", "#e5e7eb");
  const [size, setSize] = usePersistedState<number>("canvas-tool-size", 3);

  // These are for the UI buttons only
  const [canUndo, setCanUndo] = useState(strokes.length > 0);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  // Refs for event listeners to access latest tools without re-binding
  const toolsRef = useRef({ mode, color, size, readOnly });
 
  // Keep tools refs updated
  useLayoutEffect(() => {
    toolsRef.current = { mode, color, size, readOnly };
  }, [mode, color, size, readOnly]);
  // ----------------------------------------------------------------
  // 3. Drawing Logic (Retina Ready)
  // ----------------------------------------------------------------
  const drawAll = () => {
    const liveCanvas = canvasLiveRef.current;
    if (!liveCanvas) return;
    const liveCtx = liveCanvas.getContext("2d");
    if (!liveCtx) return;
   
    // Clear live canvas
    liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
   
    // Draw Current Line on live canvas
    if (currentStroke.current.length > 0) {
      drawRawStroke(liveCtx, currentStroke.current);
    }
  };
  const drawRawStroke = (ctx: CanvasRenderingContext2D, points: StrokePoint[]) => {
    if (points.length < 2) return;
    ctx.lineWidth = toolsRef.current.size * (window.devicePixelRatio || 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = toolsRef.current.mode === "pen" ? toolsRef.current.color : "#020617";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  };
  const stampPrettyStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const inputPoints = stroke.points.map((p) => [p.x, p.y, p.pressure]);
   
    const outlinePoints = getStroke(inputPoints, {
      ...STROKE_OPTIONS,
      size: stroke.size * dpr, // Scale for Retina
      simulatePressure: true,
    });
    const pathData = getSvgPathFromStroke(outlinePoints);
    ctx.fillStyle = stroke.color;
   
    const path = new Path2D(pathData);
    ctx.fill(path);
  };
  const redrawAll = () => {
    const staticCanvas = canvasStaticRef.current;
    if (!staticCanvas) return;
    const ctx = staticCanvas.getContext("2d");
    if (!ctx) return;
    const width = staticCanvas.width;
    const height = staticCanvas.height;
    const dpr = window.devicePixelRatio || 1;
    // Clear
    ctx.clearRect(0, 0, width, height);
   
    // Background
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, width, height);
    // Grid
    ctx.fillStyle = "rgba(148,163,184,0.35)";
    const spacing = 20 * dpr;
    for (let x = 0; x < width; x += spacing) {
      for (let y = 0; y < height; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 0.7 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Draw History
    history.current.forEach(stroke => stampPrettyStroke(ctx, stroke));
  };
  // ----------------------------------------------------------------
  // 4. Props Sync (Handling Undo/Redo from Parent)
  // ----------------------------------------------------------------
 
  useLayoutEffect(() => {
    // Only update if the length changed externally (e.g. initial load or reset)
    if (strokes.length !== history.current.length) {
        history.current = strokes;
        setCanUndo(strokes.length > 0);
        redrawAll();
        requestAnimationFrame(drawAll);
    }
  }, [strokes]);
  // ----------------------------------------------------------------
  // 5. Input Handling
  // ----------------------------------------------------------------
  // Helper to get coordinates relative to canvas
  const getPoint = (x: number, y: number): StrokePoint => {
    const canvas = canvasLiveRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 0.5 };
   
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
   
    return {
      x: (x - rect.left) * dpr,
      y: (y - rect.top) * dpr,
      pressure: 0.5, // For mouse/touch, default pressure
    };
  };
  const isStylusTouch = (touch: Touch): boolean => {
    const anyTouch = touch as any;
    if (typeof anyTouch.touchType === "string") {
      return anyTouch.touchType === "stylus";
    }
    return true; // Fallback
  };
  useLayoutEffect(() => {
    const liveCanvas = canvasLiveRef.current;
    const container = containerRef.current;
    if (!liveCanvas || !container) return;
    // Handle Resize
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
     
      [canvasStaticRef.current, canvasLiveRef.current].forEach(cvs => {
        if (cvs) {
          cvs.width = rect.width * dpr;
          cvs.height = rect.height * dpr;
          cvs.style.width = `${rect.width}px`;
          cvs.style.height = `${rect.height}px`;
        }
      });
      redrawAll();
      drawAll();
    };
    // Mouse handlers
    const handleMouseDown = (e: MouseEvent) => {
      if (toolsRef.current.readOnly) return;
      e.preventDefault();
      isDrawing.current = true;
      currentStroke.current = [getPoint(e.clientX, e.clientY)];
      requestAnimationFrame(drawAll);
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      currentStroke.current.push(getPoint(e.clientX, e.clientY));
      requestAnimationFrame(drawAll);
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      commitStroke();
    };
    const handleMouseLeave = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      commitStroke();
    };
    // Touch handlers
    const handleTouchStart = (e: TouchEvent) => {
      if (toolsRef.current.readOnly) return;
      const touch = e.touches[0];
      if (!touch || !isStylusTouch(touch)) return;
      e.preventDefault();
      isDrawing.current = true;
      currentStroke.current = [getPoint(touch.clientX, touch.clientY)];
      requestAnimationFrame(drawAll);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDrawing.current) return;
      const touch = e.touches[0];
      if (!touch || !isStylusTouch(touch)) return;
      e.preventDefault();
      currentStroke.current.push(getPoint(touch.clientX, touch.clientY));
      requestAnimationFrame(drawAll);
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      isDrawing.current = false;
      commitStroke();
    };
    const handleTouchCancel = (e: TouchEvent) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      isDrawing.current = false;
      commitStroke();
    };
    const commitStroke = () => {
      if (currentStroke.current.length > 0) {
        const currentMode = toolsRef.current.mode;
        let newHistory = history.current;

        if (currentMode === "eraser") {
          const eraserPoints = currentStroke.current;

          // Filter out any strokes that intersect with the eraser path
          const keptStrokes = history.current.filter((stroke) => {
            // Only consider pen strokes for deletion
            if (stroke.mode !== "pen") return true; 
            return !isStrokeIntersecting(eraserPoints, stroke);
          });

          if (keptStrokes.length !== history.current.length) {
            newHistory = keptStrokes;
          } else {
            // No stroke was deleted, just clear current and return
            currentStroke.current = [];
            requestAnimationFrame(drawAll);
            return;
          }
        } else {
          // Pen mode: create and add a new stroke
          const newStroke: Stroke = {
            color: toolsRef.current.color,
            size: toolsRef.current.size,
            points: [...currentStroke.current],
            mode: currentMode as "pen",
          };
          // Commit to static canvas
          const staticCtx = canvasStaticRef.current?.getContext("2d");
          if (staticCtx) stampPrettyStroke(staticCtx, newStroke);
          newHistory = [...history.current, newStroke];
        }

        history.current = newHistory;
        setCanUndo(newHistory.length > 0);
        setRedoStack([]);

        // Redraw static canvas fully for eraser mode (to show deletions)
        if (currentMode === "eraser") {
            redrawAll();
        }

        // Clear current
        currentStroke.current = [];
        requestAnimationFrame(drawAll);
        // Notify parent
        onChange([...history.current]);
      }
    };
    // Attach listeners to live canvas
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    liveCanvas.addEventListener("mousedown", handleMouseDown);
    liveCanvas.addEventListener("mousemove", handleMouseMove);
    liveCanvas.addEventListener("mouseup", handleMouseUp);
    liveCanvas.addEventListener("mouseleave", handleMouseLeave);
    liveCanvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    liveCanvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    liveCanvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    liveCanvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });
    return () => {
      ro.disconnect();
      liveCanvas.removeEventListener("mousedown", handleMouseDown);
      liveCanvas.removeEventListener("mousemove", handleMouseMove);
      liveCanvas.removeEventListener("mouseup", handleMouseUp);
      liveCanvas.removeEventListener("mouseleave", handleMouseLeave);
      liveCanvas.removeEventListener("touchstart", handleTouchStart);
      liveCanvas.removeEventListener("touchmove", handleTouchMove);
      liveCanvas.removeEventListener("touchend", handleTouchEnd);
      liveCanvas.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, []); // Empty dependency array: Setup ONCE.
  // ----------------------------------------------------------------
  // 6. Toolbar Actions
  // ----------------------------------------------------------------
  const handleUndo = useCallback(() => {
    if (toolsRef.current.readOnly || history.current.length === 0) return;
    const newHistory = history.current.slice(0, -1);
    const undone = history.current[history.current.length - 1];
   
    history.current = newHistory;
    setCanUndo(newHistory.length > 0);
    setRedoStack(prev => [...prev, undone]);
   
    redrawAll();
    requestAnimationFrame(drawAll);
    onChange([...newHistory]);
  }, [onChange]);
  const handleRedo = useCallback(() => {
    if (toolsRef.current.readOnly || redoStack.length === 0) return;
    const toRestore = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);
   
    history.current = [...history.current, toRestore];
    setCanUndo(true);
    setRedoStack(newRedo);
    redrawAll();
    requestAnimationFrame(drawAll);
    onChange([...history.current]);
  }, [redoStack, onChange]);
  const handleClear = useCallback(() => {
    if (toolsRef.current.readOnly) return;
    history.current = [];
    setCanUndo(false);
    setRedoStack([]);
    redrawAll();
    requestAnimationFrame(drawAll);
    onChange([]);
  }, [onChange]);
  return (
    <div className="canvas-pad-wrapper">
      <div className="canvas-pad-toolbar">
        <div className="canvas-pad-tools-left">
          <button type="button" className={`btn ${mode === "pen" ? "btn-primary" : ""}`} onClick={() => setMode("pen")}>✏️ Pencil</button>
          <button type="button" className={`btn ${mode === "eraser" ? "btn-primary" : ""}`} onClick={() => setMode("eraser")}>🧽 Eraser</button>
          <button type="button" className="btn" onClick={handleUndo} disabled={!canUndo}>⤺ Undo</button>
          <button type="button" className="btn" onClick={handleRedo} disabled={redoStack.length === 0}>⤻ Redo</button>
          <button type="button" className="btn" onClick={handleClear} disabled={!canUndo}>Clear</button>
          {/* 🟢 NEW: Resize Lock Button */}
              {onToggleResizeLock && (
               <button
                type="button"
                className="btn btn-ghost"
                onClick={onToggleResizeLock}
                title={isResizeLocked ? "Unlock Height" : "Lock Height"}
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  marginLeft: 8, // Keep the spacing
                  flexShrink: 0,
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  alignSelf: "center",
                  // Visual feedback: Red if locked, muted if unlocked
                  color: isResizeLocked ? "#f43f5e" : "var(--text-muted)",
                  background: isResizeLocked ? "rgba(244, 63, 94, 0.1)" : "transparent",
                  border: isResizeLocked ? "1px solid rgba(244, 63, 94, 0.3)" : "1px solid transparent",
                  borderRadius: 4
                }}
              >
                  {isResizeLocked ? (
                    /* Lock Icon */
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  ) : (
                    /* Unlock Icon */
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                  )}
                </button>
              )}
        </div>
        <div className="canvas-pad-tools-right">
           <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
           <input type="range" min={1} max={16} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </div>
      </div>
      <div className="canvas-surface-wrapper" ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", touchAction: "none" }}>
        <canvas
          ref={canvasStaticRef}
          style={{ position: "absolute", top: 0, left: 0, zIndex: 1, width: "100%", height: "100%", touchAction: "none", display: "block" }}
        />
        <canvas
          ref={canvasLiveRef}
          style={{ position: "absolute", top: 0, left: 0, zIndex: 2, width: "100%", height: "100%", touchAction: "none", display: "block" }}
        />
      </div>
    </div>
  );
});