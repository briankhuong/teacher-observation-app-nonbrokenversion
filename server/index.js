// server/index.js - CONSOLIDATED OCR AND MERGE SERVER

import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; // <-- 1. REQUIRED: Import fetch for Azure API calls

// ⚠️ We no longer need this import, as the OCR logic is inline/moved
// import ocrAzureRoute from "./ocrAzureRoute.js"; 

import mergeRoutes from "./mergeRoutes.js";

dotenv.config({ path: ".env.azure" });

// -----------------------------------------------------------------
// 🟢 AZURE OCR Configuration & Check
// -----------------------------------------------------------------
const AZURE_OCR_ENDPOINT = process.env.AZURE_OCR_ENDPOINT;
const AZURE_OCR_KEY = process.env.AZURE_OCR_KEY;

if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
  console.error("❌ Missing AZURE_OCR_ENDPOINT or AZURE_OCR_KEY in .env.azure");
  // In a production app, we won't exit, but we should log the error.
}

// -----------------------------------------------------------------
// 🟢 Main Express App Setup
// -----------------------------------------------------------------
const app = express();

// --- CORS Setup ---
// const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
//     ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
//     : 'http://localhost:5173'; 
// 🟢 USE THIS: Allow any local network origin (for development)
const origin = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
    : req.headers.origin; // Trust the incoming request in dev (handles 192.168...)

// Update the app.use(cors(...)) block below it:
app.use(
  cors({
    origin: true, // "true" means reflect the request origin (works for localhost AND 192.168...)
    credentials: false,
  })
);

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    credentials: false,
  })
);

app.use(express.json({ limit: "10mb" })); // Handles JSON and base64 images

// -----------------------------------------------------------------
// 🟢 OCR Endpoint - MOVED FROM azure-ocr-server.mjs
// -----------------------------------------------------------------
app.post("/api/ocr-azure", async (req, res) => {
  if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
      return res.status(500).json({ error: "OCR keys are not configured on the server." });
  }

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");

    const url =
      `${AZURE_OCR_ENDPOINT.replace(/\/+$/, "")}` +
      `/computervision/imageanalysis:analyze` +
      `?api-version=2023-10-01&features=read`;

    const azureResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_OCR_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    });

    if (!azureResponse.ok) {
      const text = await azureResponse.text();
      console.error("Azure error:", azureResponse.status, text);
      return res.status(azureResponse.status).json({ error: "Azure OCR error", details: text });
    }

    const result = await azureResponse.json();

    // 🔎 Safely pull out lines + average confidence
    const blocks = result?.readResult?.blocks ?? [];
    const lines = [];
    const confidences = [];

    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        if (line.text) lines.push(line.text);
        if (line.words && line.words.length) {
          const avg =
            line.words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) /
            line.words.length;
          confidences.push(avg);
        }
      }
    }

    const text = lines.join("\n");
    const confidence =
      confidences.length === 0
        ? 0
        : confidences.reduce((a, b) => a + b, 0) / confidences.length;

    return res.json({ text, confidence });
  } catch (err) {
    console.error("Server error during OCR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// -----------------------------------------------------------------
// 🔗 Merge endpoints - Already fixed to include /api prefix in mergeRoutes.js
// -----------------------------------------------------------------
app.use(mergeRoutes); 

const PORT = process.env.OCR_SERVER_PORT || 4000;

app.listen(PORT, () => {
  console.log(`✅ Main server (OCR/Merge) running at http://localhost:${PORT}`);
  console.log(`Allowed CORS Origin: ${ALLOWED_ORIGIN}`);
});