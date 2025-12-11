import React, { useEffect, useRef, useState } from "react";

interface StrokePoint {
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

interface CanvasPadProps {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  readOnly?: boolean; // 🔒 when true, no drawing/editing
}

export const CanvasPad: React.FC<CanvasPadProps> = ({
  strokes,
  onChange,
  readOnly = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [localStrokes, setLocalStrokes] = useState<Stroke[]>(strokes);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [mode, setMode] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState<string>("#e5e7eb");
  const [size, setSize] = useState<number>(3);

  const strokesRef = useRef<Stroke[]>(localStrokes);
  const currentStrokeRef = useRef<Stroke | null>(currentStroke);

  useEffect(() => {
    strokesRef.current = localStrokes;
  }, [localStrokes]);

  useEffect(() => {
    currentStrokeRef.current = currentStroke;
  }, [currentStroke]);

  // Keep local strokes in sync when prop changes (e.g. switch indicator)
  useEffect(() => {
    setLocalStrokes(strokes);
    // Do NOT clear redoStack here, or redo breaks
  }, [strokes]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      canvas.width = rect.width;
      canvas.height = rect.height;

      // Use the latest strokes when redrawing
      drawAll(canvas, strokesRef.current, currentStrokeRef.current);
    };

    // Initial sizing once layout is ready
    const frameId = requestAnimationFrame(resize);

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        // Wait for layout to settle, then resize/redraw
        requestAnimationFrame(resize);
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        cancelAnimationFrame(frameId);
      };
    } else {
      // Fallback: window resize for old browsers
      window.addEventListener("resize", resize);
      return () => {
        window.removeEventListener("resize", resize);
        cancelAnimationFrame(frameId);
      };
    }
  }, []);

  // Redraw when strokes or currentStroke change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawAll(canvas, localStrokes, currentStroke);
  }, [localStrokes, currentStroke]);

  // ---- Shared helpers ----

  const beginStrokeAt = (x: number, y: number) => {
    if (readOnly) return; // 🔒
    const stroke: Stroke = {
      color: mode === "pen" ? color : "#020617", // dark bg as eraser
      size: mode === "pen" ? size : size * 2,
      points: [{ x, y, pressure: 0.5 }],
      mode,
    };
    setCurrentStroke(stroke);
    setIsDrawing(true);
  };

  const extendStrokeTo = (x: number, y: number) => {
    if (readOnly) return; // 🔒
    if (!isDrawing || !currentStroke) return;
    const updated: Stroke = {
      ...currentStroke,
      points: [...currentStroke.points, { x, y, pressure: 0.5 }],
    };
    setCurrentStroke(updated);
  };

  const finishStroke = () => {
    if (readOnly) {
      setIsDrawing(false);
      setCurrentStroke(null);
      return;
    }

    if (!isDrawing || !currentStroke) {
      setIsDrawing(false);
      return;
    }
    const newStrokes = [...localStrokes, currentStroke];
    setLocalStrokes(newStrokes);
    setCurrentStroke(null);
    setIsDrawing(false);
    setRedoStack([]);
    onChange(newStrokes);
  };

  // Small helper to check if a touch is from Apple Pencil
  // Small helper to check if a touch is from Apple Pencil
const isStylusTouch = (touch: any): boolean => {
  const anyTouch = touch as any;
  // On modern iOS Safari, touchType is "stylus" for Pencil
  if (typeof anyTouch.touchType === "string") {
    return anyTouch.touchType === "stylus";
  }
  // If touchType is missing (older devices), fall back to allowing it.
  return true;
};


  // ---- Mouse handlers (for desktop testing only) ----

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly) return; // 🔒
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    beginStrokeAt(e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly) return; // 🔒
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    extendStrokeTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleMouseUp = () => {
    if (readOnly) return; // 🔒
    finishStroke();
  };

  const handleMouseLeave = () => {
    if (readOnly) return; // 🔒
    finishStroke();
  };

  // ---- Touch handlers (for iPad / Pencil) ----

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (readOnly) return; // 🔒
    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = e.touches[0];
    if (!touch) return;

    if (!isStylusTouch(touch)) {
      return;
    }

    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    beginStrokeAt(x, y);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (readOnly) return; // 🔒
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = e.touches[0];
    if (!touch) return;

    if (!isStylusTouch(touch)) {
      return;
    }

    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    extendStrokeTo(x, y);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (readOnly) return; // 🔒
    e.preventDefault();
    finishStroke();
  };

  const handleTouchCancel = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (readOnly) return; // 🔒
    e.preventDefault();
    finishStroke();
  };

  // ---- Undo / Redo / Clear ----

  const handleUndo = () => {
    if (readOnly) return; // 🔒
    if (localStrokes.length === 0) return;
    const newStrokes = localStrokes.slice(0, -1);
    const undone = localStrokes[localStrokes.length - 1];
    setLocalStrokes(newStrokes);
    setRedoStack((prev) => [...prev, undone]);
    onChange(newStrokes);
  };

  const handleRedo = () => {
    if (readOnly) return; // 🔒
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);
    const newStrokes = [...localStrokes, last];
    setLocalStrokes(newStrokes);
    setRedoStack(newRedo);
    onChange(newStrokes);
  };

  const handleClear = () => {
    if (readOnly) return; // 🔒
    setLocalStrokes([]);
    setRedoStack([]);
    setCurrentStroke(null);
    onChange([]);
  };

  return (
    <div className="canvas-pad-wrapper">
      <div className="canvas-pad-toolbar">
        <div className="canvas-pad-tools-left">
          <button
            type="button"
            className={`btn ${mode === "pen" ? "btn-primary" : ""}`}
            onClick={() => !readOnly && setMode("pen")}
            disabled={readOnly}
          >
            ✏️ Pencil
          </button>
          <button
            type="button"
            className={`btn ${mode === "eraser" ? "btn-primary" : ""}`}
            onClick={() => !readOnly && setMode("eraser")}
            disabled={readOnly}
          >
            🧽 Eraser
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleUndo}
            disabled={readOnly || localStrokes.length === 0}
          >
            ⤺ Undo
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleRedo}
            disabled={readOnly || redoStack.length === 0}
          >
            ⤻ Redo
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleClear}
            disabled={readOnly || localStrokes.length === 0}
          >
            Clear
          </button>
        </div>
        <div className="canvas-pad-tools-right">
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Color{" "}
            <input
              type="color"
              value={color}
              onChange={(e) => !readOnly && setColor(e.target.value)}
              disabled={readOnly}
              style={{ marginLeft: 4 }}
            />
          </label>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Brush{" "}
            <input
              type="range"
              min={1}
              max={16}
              value={size}
              onChange={(e) => !readOnly && setSize(Number(e.target.value))}
              disabled={readOnly}
              style={{ marginLeft: 4 }}
            />
          </label>
        </div>
      </div>

      <div className="canvas-surface-wrapper" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="canvas-surface"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        />
      </div>
    </div>
  );
};

function drawAll(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  currentStroke: Stroke | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Clear
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Dotted grid
  const spacing = 20;
  ctx.fillStyle = "rgba(148,163,184,0.35)";
  for (let x = 0; x < canvas.width; x += spacing) {
    for (let y = 0; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const drawStroke = (stroke: Stroke) => {
    const pts = stroke.points;
    if (pts.length === 0) return;

    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (pts.length === 1) {
      const p = pts[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  };

  strokes.forEach(drawStroke);
  if (currentStroke) drawStroke(currentStroke);
}
