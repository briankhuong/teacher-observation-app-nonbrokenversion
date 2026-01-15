// src/utils/imageStitcher.ts

import type { Stroke } from "../constants";

interface StitchItem {
  id: string; // The indicator ID (e.g., "1.2")
  strokes: Stroke[];
}

interface StitchedBatch {
  imageBase64: string;
  idsInBatch: string[];
}

// Helper: Calculate bounding box of strokes
function getBounds(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export async function stitchHandwritingBatches(
  items: StitchItem[],
  maxItemsPerBatch = 5
): Promise<StitchedBatch[]> {
  const batches: StitchedBatch[] = [];
  
  // 1. Chunk items into smaller groups
  for (let i = 0; i < items.length; i += maxItemsPerBatch) {
    const chunk = items.slice(i, i + maxItemsPerBatch);
    const batch = await processSingleBatch(chunk);
    if (batch) batches.push(batch);
  }

  return batches;
}

async function processSingleBatch(items: StitchItem[]): Promise<StitchedBatch | null> {
  const HEADER_HEIGHT = 40; // Space for the "[[ID: X]]" text
  const PADDING = 20;
  const SEPARATOR_HEIGHT = 2; // Black line height

  // 1. Pre-calculate dimensions for each item
  const measurements = items.map(item => {
    const b = getBounds(item.strokes);
    // If empty strokes, handle gracefully
    if (b.minX === Infinity) return { ...item, width: 0, height: 0, b };
    
    return {
      ...item,
      width: Math.max(1, (b.maxX - b.minX) + (PADDING * 2)),
      height: Math.max(1, (b.maxY - b.minY) + (PADDING * 2)),
      b
    };
  });

  // Filter out empty ones
  const validItems = measurements.filter(m => m.height > 0);
  if (validItems.length === 0) return null;

  // 2. Calculate Master Canvas Size
  // Width = Max width of any single item (plus margin)
  // Height = Sum of all item heights + headers + separators
  const masterWidth = Math.max(...validItems.map(m => m.width));
  const masterHeight = validItems.reduce((sum, item) => sum + item.height + HEADER_HEIGHT + SEPARATOR_HEIGHT + 20, 0);

  // 3. Create Master Canvas
  const canvas = document.createElement("canvas");
  canvas.width = masterWidth;
  canvas.height = masterHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Fill White Background (Crucial for OCR)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, masterWidth, masterHeight);

  // 4. Draw Items Vertically
  let currentY = 10;

  for (const item of validItems) {
    // A. Draw Header (The Anchor)
    ctx.fillStyle = "#000000"; // Black Text
    ctx.font = "bold 24px monospace";
    ctx.textBaseline = "top";
    // We draw "[[ID: <number>]]" - this is the key the AI will return
    const headerText = `[[ID: ${item.id}]]`;
    ctx.fillText(headerText, 10, currentY);
    
    currentY += HEADER_HEIGHT;

    // B. Draw Strokes
    // We translate the context so (0,0) is the start of this block
    ctx.save();
    ctx.translate(PADDING - item.b.minX, currentY + PADDING - item.b.minY);

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000";

    for (const stroke of item.strokes) {
      if (!stroke.points.length) continue;
      const first = stroke.points[0];
      ctx.moveTo(first.x, first.y);
      for (let k = 1; k < stroke.points.length; k++) {
        ctx.lineTo(stroke.points[k].x, stroke.points[k].y);
      }
    }
    ctx.stroke();
    ctx.restore();

    currentY += item.height;

    // C. Draw Separator Line
    ctx.fillStyle = "#cccccc"; // Light gray divider
    ctx.fillRect(0, currentY + 10, masterWidth, SEPARATOR_HEIGHT);
    
    currentY += (SEPARATOR_HEIGHT + 20); // Add some spacing before next
  }

  // 5. Export
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  return {
    imageBase64: dataUrl.split(",")[1],
    idsInBatch: validItems.map(i => i.id)
  };
}