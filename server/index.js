import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; 
import fs from 'fs'; 

// Routes
import mergeRoutes from "./mergeRoutes.js";
import geminiOcrRoutes from "./ocrGeminiRoute.js";
import polishGroqRoute from "./polishGroqRoute.js"; 
import syncRoute from "./syncRoute.js";

dotenv.config({ path: ".env.azure" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------
// 1. Configuration & Checks
// -----------------------------------------------------------------
const AZURE_OCR_ENDPOINT = process.env.AZURE_OCR_ENDPOINT;
const AZURE_OCR_KEY = process.env.AZURE_OCR_KEY;
const GEMINI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;

if (!GEMINI_KEY) {
  console.warn("⚠️ GOOGLE_GENERATIVE_AI_KEY is missing. Gemini OCR will fail.");
}

// -----------------------------------------------------------------
// 2. Main Express App Setup
// -----------------------------------------------------------------
const app = express();

const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
    : 'http://localhost:5173'; 

app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    if (origin.includes('192.168')) return callback(null, true);
    if (origin === ALLOWED_ORIGIN) return callback(null, true);
    return callback(null, true);
  },
  credentials: false,
}));

app.use(express.json({ limit: "10mb" })); 

// -----------------------------------------------------------------
// 3. Register Routes (ORDER MATTERS - APIs FIRST)
// -----------------------------------------------------------------

app.use(polishGroqRoute); // Handles /api/transcribe and /api/polish-text
app.use(geminiOcrRoutes);
app.use(mergeRoutes); 
app.use(syncRoute);

// Manual API Routes
app.post("/api/ocr-azure", async (req, res) => {
  if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
      return res.status(500).json({ error: "OCR keys are not configured." });
  }
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });

    const imageBuffer = Buffer.from(imageBase64, "base64");
    const url = `${AZURE_OCR_ENDPOINT.replace(/\/+$/, "")}/computervision/imageanalysis:analyze?api-version=2023-10-01&features=read`;

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
          const avg = line.words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / line.words.length;
          confidences.push(avg);
        }
      }
    }

    const text = rawLines.reduce((acc, line) => {
      if (!line) return acc;
      const isNewItem = line.startsWith("-") || line.toUpperCase().startsWith("(GA)");
      if (acc.length === 0) return line;
      return isNewItem ? `${acc}\n${line}` : `${acc} ${line}`; 
    }, "");

    const confidence = confidences.length === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / confidences.length;
    return res.json({ text, confidence });
  } catch (err) {
    console.error("Server error during OCR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GrapeSEED Token
app.post("/api/get-grapeseed-token", async (req, res) => {
    const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();
    const username = (process.env.GRAPESEED_USERNAME || "").trim();
    const password = (process.env.GRAPESEED_PASSWORD || "").trim();

    try {
        const url = "https://account.grapeseed.com/connect/token";
        if (!username || !password || !authHeader) return res.status(500).json({ error: "Server misconfiguration" });

        const bodyString = `grant_type=password&scope=offline_access basicinfo openid&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: bodyString,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: "Token request failed", details: errorText });
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GrapeSEED Classes
app.post("/api/get-grapeseed-classes", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Missing Access Token" });

    try {
        const dataUrl = "https://services.grapeseed.com/admin/v1/resources/users/b6133f96-5f21-47ca-9ab3-1b4205bf073f/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName"
        const response = await fetch(dataUrl, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "x-gl-origin": "https://schools.grapeseed.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: "Data fetch failed", details: errorText });
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// -----------------------------------------------------------------
// 4. SERVE REACT FRONTEND (Robust Fix)
// -----------------------------------------------------------------

const DIST_PATH = path.join(process.cwd(), 'dist');
const INDEX_PATH = path.join(DIST_PATH, 'index.html');

console.log(`📂 Serving Frontend from: ${DIST_PATH}`);
if (fs.existsSync(INDEX_PATH)) {
    console.log("✅ index.html found!");
} else {
    console.error("❌ ERROR: index.html is MISSING at " + INDEX_PATH);
}

// Serve the Static Files
app.use(express.static(DIST_PATH));

// Handle React Routing
app.get('*', (req, res) => {
  if (fs.existsSync(INDEX_PATH)) {
    res.sendFile(INDEX_PATH);
  } else {
    res.status(404).send("404 Error: Frontend file (index.html) is missing on server. Check build logs.");
  }
});

// -----------------------------------------------------------------
// 5. Start Server
// -----------------------------------------------------------------
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`✅ Main server running on port ${PORT}`);
});