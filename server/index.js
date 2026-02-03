import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; 
import mergeRoutes from "./mergeRoutes.js";
// 👇 Import the new Gemini Route
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

// Log warnings if keys are missing
if (!GEMINI_KEY) {
  console.warn("⚠️ GOOGLE_GENERATIVE_AI_KEY is missing in .env.azure. Gemini OCR will fail.");
}

if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
  console.warn("⚠️ AZURE_OCR keys missing. The /api/ocr-azure route will fail if used.");
}

// -----------------------------------------------------------------
// 2. Main Express App Setup
// -----------------------------------------------------------------
const app = express();

// 👇 PRODUCTION URL (Update this if your Vercel URL changes)
const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
    : 'http://localhost:5173'; 

// 🟢 ROBUST CORS SETUP
app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true);
    
    // Allow Localhost, Local Network (192.168...), and Production
    if (origin.includes('localhost')) return callback(null, true);
    if (origin.includes('192.168')) return callback(null, true);
    if (origin === ALLOWED_ORIGIN) return callback(null, true);

    console.log("🚫 Blocked CORS origin:", origin);
    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: false,
}));

// Increase limit for Base64 image payloads
app.use(express.json({ limit: "10mb" })); 

// -----------------------------------------------------------------
// 3. Register Routes
// -----------------------------------------------------------------

// 👇 A. Enable the Gemini Route (mounts /api/ocr-gemini)
app.use(geminiOcrRoutes);


// 👇 B. Azure OCR Endpoint (Kept for reference/backup)
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

    // Azure "Simple Glue" Logic
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

// 👇 D. NEW ROUTE: Secure Proxy for GrapeSEED Token
app.post("/api/get-grapeseed-token", async (req, res) => {
    console.log("🚀 Request received for GrapeSEED token");

    // 1. Get Secrets
    const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();
    const username = (process.env.GRAPESEED_USERNAME || "").trim();
    const password = (process.env.GRAPESEED_PASSWORD || "").trim();

    try {
        // 🟢 FIX 1: The Correct URL
        const url = "https://account.grapeseed.com/connect/token";

        // Validate secrets
        if (!username || !password || !authHeader) {
            console.error("Missing credentials in .env.azure");
            return res.status(500).json({ error: "Server misconfiguration" });
        }

        // 🟢 FIX 2: Correct Body for 'connect/token' endpoints
        // Usually 'connect/token' uses 'grant_type=password' standard OAuth
        const bodyString = `grant_type=password&scope=offline_access basicinfo openid&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
                // 🟢 FIX 3: Removed manual 'Host' header. 
                // Fetch will automatically set Host to 'account.grapeseed.com'
            },
            body: bodyString,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Upstream Error: ${response.status}`);
            console.error("Details:", errorText);
            return res.status(response.status).json({ 
                error: "Token request failed", 
                details: errorText 
            });
        }

        const data = await response.json();
        console.log("✅ Success! Token received.");
        res.json(data);

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 👇 E. NEW ROUTE: Fetch Class Data using the Token
app.post("/api/get-grapeseed-classes", async (req, res) => {
    console.log("🚀 Request received for Class Data");
    
    // 1. Get the Token passed from the Frontend
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: "Missing Access Token" });
    }

    try {
        // ⚠️ PASTE YOUR FULL, REAL URL HERE (Replace the "..." parts)
        const dataUrl = "https://services.grapeseed.com/admin/v1/resources/users/b6133f96-5f21-47ca-9ab3-1b4205bf073f/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName"

        const response = await fetch(dataUrl, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/x-www-form-urlencoded",
                // 🟢 CRITICAL HEADER (From your VBA)
                "x-gl-origin": "https://schools.grapeseed.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Upstream Data Error: ${response.status}`);
            return res.status(response.status).json({ error: "Data fetch failed", details: errorText });
        }

        const data = await response.json();
        console.log("✅ Class Data Retrieved Successfully!");
        res.json(data);

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// 👇 C. Merge Routes (Excel Logic)
app.use(mergeRoutes); 

// 👇 USE NEW ROUTE
app.use(polishGroqRoute);
app.use(syncRoute);

// =========================================================
// 🟢 THE FIX: SERVE FRONTEND FROM NODE (Replaces Vite Proxy)
// =========================================================

// 1. Serve the React Build Folder
// This tells Express: "If they ask for a file (js, css, logo), look in ../dist"
app.use(express.static(path.join(__dirname, '../dist')));

// 2. Handle React Routing (The Catch-All)
// This tells Express: "If they ask for a page I don't know, give them index.html"
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});
// -----------------------------------------------------------------
// 4. Start Server
// -----------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

