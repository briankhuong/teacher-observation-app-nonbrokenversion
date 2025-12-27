// src/utils/imageOptimizer.ts

/**
 * SMART CROP & COMPRESS
 * 1. Scans the canvas to find the "Bounding Box" of the actual drawing.
 * 2. Crops the image to that box (plus a small padding).
 * 3. Compresses it to JPEG (lossy but fast) to reduce payload size.
 */
export function getOptimizedInkImage(
  strokes: any[], // We don't need the full canvas element, we can reuse your strokesToPngBase64 logic partially or use canvas ref
  canvasRef: HTMLCanvasElement | null
): string | null {
  if (!canvasRef) return null;

  const ctx = canvasRef.getContext("2d");
  if (!ctx) return null;

  const width = canvasRef.width;
  const height = canvasRef.height;
  
  // 1. Get Pixel Data (Raw RGBA array)
  // This is fast enough for typical signature/note canvases.
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hasInk = false;

  // 2. Scan for pixels (Simple algorithm)
  // We look for any pixel that is NOT transparent/white.
  // Assuming white background (R=255, G=255, B=255) or Transparent (A=0)
  // Since your canvas might be transparent or dark mode, we check Alpha mostly.
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index+1];
      const b = data[index+2];
      const a = data[index+3];

      // Check if pixel contributes to drawing
      // In your dark mode, ink is likely light color on dark bg, OR simple transparency check if layer 
      // Let's assume non-zero alpha is ink for safety if you draw on transparent layer
      if (a > 10) { 
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasInk = true;
      }
    }
  }

  // If canvas is empty, return null
  if (!hasInk) return null; 

  // 3. Apply Padding
  const padding = 20;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width, maxX + padding);
  maxY = Math.min(height, maxY + padding);

  const cropWidth = maxX - minX;
  const cropHeight = maxY - minY;

  // 4. Draw to Temp Canvas
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = cropWidth;
  tempCanvas.height = cropHeight;
  const tempCtx = tempCanvas.getContext("2d");
  
  if (!tempCtx) return null;

  // Fill white background first (JPEGs have no transparency)
  // This helps OCR read better than transparent background
  tempCtx.fillStyle = "#FFFFFF";
  tempCtx.fillRect(0, 0, cropWidth, cropHeight);

  // Draw the cropped slice
  // We need to draw the original canvas content onto the white background
  // Caution: If your original canvas has dark background drawn on it, this might look weird. 
  // BETTER APPROACH: Use your existing 'strokesToPngBase64' logic but applying crop coordinates?
  // Let's stick to canvas slicing for speed if the canvas is what the user sees.
  
  tempCtx.drawImage(
    canvasRef, 
    minX, minY, cropWidth, cropHeight, // Source Rect
    0, 0, cropWidth, cropHeight        // Dest Rect
  );

  // 5. Compress & Export
  return tempCanvas.toDataURL("image/jpeg", 0.6); // 60% quality
}