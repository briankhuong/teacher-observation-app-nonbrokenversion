import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; 
import path from "path";
import { fileURLToPath } from "url";
import mergeRoutes from "./mergeRoutes.js";
import geminiOcrRoutes from "./ocrGeminiRoute.js";
import polishGroqRoute from "./polishGroqRoute.js";
import syncRoute from "./syncRoute.js";

dotenv.config({ path: ".env.azure" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// -----------------------------------------------------------------
// 1. Port & Environment Logic
// -----------------------------------------------------------------
const PORT = process.env.PORT || process.env.OCR_SERVER_PORT || 4000;

const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
    : 'http://localhost:5173'; 

// -----------------------------------------------------------------
// 2. Middleware (CORS & Body Parsing)
// -----------------------------------------------------------------
app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    if (origin.includes('192.168')) return callback(null, true);
    if (origin === ALLOWED_ORIGIN || origin.includes('vercel.app')) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: false,
}));

app.use(express.json({ limit: "10mb" })); 

// -----------------------------------------------------------------
// 3. Register Routes
// -----------------------------------------------------------------
app.use(geminiOcrRoutes);
app.use(mergeRoutes); 
app.use(polishGroqRoute);
app.use(syncRoute);

// Azure OCR Endpoint
app.post("/api/ocr-azure", async (req, res) => {
  const AZURE_OCR_ENDPOINT = process.env.AZURE_OCR_ENDPOINT;
  const AZURE_OCR_KEY = process.env.AZURE_OCR_KEY;

  if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
      return res.status(500).json({ error: "OCR keys are not configured on the server." });
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

    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        if (line.text) rawLines.push(line.text.trim());
      }
    }

    const text = rawLines.reduce((acc, line) => {
      if (!line) return acc;
      const isNewItem = line.startsWith("-") || line.toUpperCase().startsWith("(GA)");
      return acc.length === 0 ? line : (isNewItem ? `${acc}\n${line}` : `${acc} ${line}`);
    }, "");

    return res.json({ text });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

// GrapeSEED Token Proxy
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

        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GrapeSEED Class Data Proxy
app.post("/api/get-grapeseed-classes", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Missing Access Token" });

    try {
        const dataUrl = "https://services.grapeseed.com/admin/v1/resources/users/b6133f96-5f21-47ca-9ab3-1b4205bf073f/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName"
        const response = await fetch(dataUrl, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "x-gl-origin": "https://schools.grapeseed.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            },
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// -----------------------------------------------------------------
// 4. Static Serving & SPA Routing (Express 5.0 Fix)
// -----------------------------------------------------------------
const rootDistPath = path.join(__dirname, "..", "dist");

app.use(express.static(rootDistPath));

// 🔥 THE MINIMUM CHANGE: Added '/*' instead of just '*'
// Express 5 needs the leading slash for the wildcard to be parsed as a path
app.get("/:catchall*", (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: "API route not found" });
  }
  res.sendFile(path.join(rootDistPath, "index.html"));
});
// -----------------------------------------------------------------
// 5. Start Server
// -----------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});