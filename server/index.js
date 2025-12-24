// server/index.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; 
import mergeRoutes from "./mergeRoutes.js";

dotenv.config({ path: ".env.azure" });

// -----------------------------------------------------------------
// 1. Configuration & Checks
// -----------------------------------------------------------------
const AZURE_OCR_ENDPOINT = process.env.AZURE_OCR_ENDPOINT;
const AZURE_OCR_KEY = process.env.AZURE_OCR_KEY;

if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
  console.error("❌ Missing AZURE_OCR_ENDPOINT or AZURE_OCR_KEY in .env.azure");
}

// -----------------------------------------------------------------
// 2. Main Express App Setup
// -----------------------------------------------------------------
const app = express();

// 👇 PRODUCTION URL (Update this if your Vercel URL changes)
const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app/' 
    : 'http://localhost:5173'; 

// 🟢 ROBUST CORS SETUP
app.use(cors({
  origin: function(origin, callback){
    // Allow requests with no origin (like mobile apps or curl requests)
    if(!origin) return callback(null, true);

    // 1. Allow Localhost (HTTP or HTTPS)
    if (origin.includes('localhost')) {
      return callback(null, true);
    }

    // 2. Allow Local Network IP (HTTP or HTTPS)
    // 🟢 FIX: Used .includes() instead of .startsWith('http') to allow https://192...
    if (origin.includes('192.168')) {
      return callback(null, true);
    }

    // 3. Allow Production Domain
    if (origin === ALLOWED_ORIGIN) {
      return callback(null, true);
    }

    // Block everything else
    console.log("🚫 Blocked CORS origin:", origin);
    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: false,
}));

app.use(express.json({ limit: "10mb" })); 

// -----------------------------------------------------------------
// 3. OCR Endpoint (With Smart Paragraph Logic)
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

    const blocks = result?.readResult?.blocks ?? [];
    const rawLines = [];
    const confidences = [];

    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        if (line.text) rawLines.push(line.text.trim());
        if (line.words && line.words.length) {
          const avg =
            line.words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) /
            line.words.length;
          confidences.push(avg);
        }
      }
    }

    // B. SMART GLUE LOGIC
    const text = rawLines.reduce((acc, line) => {
      if (!line) return acc;

      const isNewItem = line.startsWith("-") || line.toUpperCase().startsWith("(GA)");

      if (acc.length === 0) return line;

      if (isNewItem) {
        return `${acc}\n${line}`; 
      } else {
        return `${acc} ${line}`; 
      }
    }, "");

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
// 4. Merge Routes & Start Server
// -----------------------------------------------------------------
app.use(mergeRoutes); 

const PORT = process.env.OCR_SERVER_PORT || 4000;

app.listen(PORT, () => {
  console.log(`✅ Main server (OCR/Merge) running at http://localhost:${PORT}`);
});