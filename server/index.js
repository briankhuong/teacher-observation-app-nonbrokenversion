import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";

// --------------------------------------------------
// Routes
// --------------------------------------------------
import mergeRoutes from "./mergeRoutes.js";
import geminiOcrRoutes from "./ocrGeminiRoute.js";
import polishGroqRoute from "./polishGroqRoute.js";
import syncRoute from "./syncRoute.js";

// --------------------------------------------------
// Env setup
// --------------------------------------------------
dotenv.config({ path: ".env.azure" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------------------------------------
// 1. Configuration & Checks
// --------------------------------------------------
const AZURE_OCR_ENDPOINT = process.env.AZURE_OCR_ENDPOINT;
const AZURE_OCR_KEY = process.env.AZURE_OCR_KEY;
const GEMINI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;

if (!GEMINI_KEY) {
  console.warn("⚠️ GOOGLE_GENERATIVE_AI_KEY is missing. Gemini OCR will fail.");
}

// --------------------------------------------------
// 2. Express App Setup
// --------------------------------------------------
const app = express();

const ALLOWED_ORIGIN =
  process.env.NODE_ENV === "production"
    ? "https://teacher-observation-app-nonbrokenve-delta.vercel.app"
    : "http://localhost:5173";

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.includes("localhost")) return callback(null, true);
      if (origin.includes("192.168")) return callback(null, true);
      if (origin === ALLOWED_ORIGIN) return callback(null, true);
      return callback(null, true);
    },
    credentials: false,
  })
);

app.use(express.json({ limit: "10mb" }));

// --------------------------------------------------
// 3. API ROUTES (ORDER MATTERS)
// --------------------------------------------------
app.use(polishGroqRoute); // /api/transcribe, /api/polish-text
app.use(geminiOcrRoutes);
app.use(mergeRoutes);
app.use(syncRoute);

// --------------------------------------------------
// 4. Manual API Routes
// --------------------------------------------------
app.post("/api/ocr-azure", async (req, res) => {
  if (!AZURE_OCR_ENDPOINT || !AZURE_OCR_KEY) {
    return res.status(500).json({ error: "OCR keys are not configured." });
  }

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");
    const url = `${AZURE_OCR_ENDPOINT.replace(
      /\/+$/,
      ""
    )}/computervision/imageanalysis:analyze?api-version=2023-10-01&features=read`;

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
      return res
        .status(azureResponse.status)
        .json({ error: "Azure OCR error", details: text });
    }

    const result = await azureResponse.json();
    const blocks = result?.readResult?.blocks ?? [];

    const rawLines = [];
    const confidences = [];

    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        if (line.text) rawLines.push(line.text.trim());
        if (line.words?.length) {
          const avg =
            line.words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) /
            line.words.length;
          confidences.push(avg);
        }
      }
    }

    const text = rawLines.reduce((acc, line) => {
      if (!line) return acc;
      const isNewItem =
        line.startsWith("-") || line.toUpperCase().startsWith("(GA)");
      if (!acc) return line;
      return isNewItem ? `${acc}\n${line}` : `${acc} ${line}`;
    }, "");

    const confidence =
      confidences.length === 0
        ? 0
        : confidences.reduce((a, b) => a + b, 0) / confidences.length;

    res.json({ text, confidence });
  } catch (err) {
    console.error("Server error during OCR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------------------------------------
// GrapeSEED APIs
// --------------------------------------------------
app.post("/api/get-grapeseed-token", async (req, res) => {
  const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();
  const username = (process.env.GRAPESEED_USERNAME || "").trim();
  const password = (process.env.GRAPESEED_PASSWORD || "").trim();

  if (!username || !password || !authHeader) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  try {
    const response = await fetch(
      "https://account.grapeseed.com/connect/token",
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=password&scope=offline_access basicinfo openid&username=${encodeURIComponent(
          username
        )}&password=${encodeURIComponent(password)}`,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res
        .status(response.status)
        .json({ error: "Token request failed", details: errorText });
    }

    res.json(await response.json());
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/get-grapeseed-classes", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Missing Access Token" });
  }

  try {
    const response = await fetch(
      "https://services.grapeseed.com/admin/v1/resources/users/b6133f96-5f21-47ca-9ab3-1b4205bf073f/landingresources/9?filterText=&sortBy=schoolName&sortBy=campusName&disabled=false&sortBy=schoolClassName",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-gl-origin": "https://schools.grapeseed.com/",
          "User-Agent": "Mozilla/5.0",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res
        .status(response.status)
        .json({ error: "Data fetch failed", details: errorText });
    }

    res.json(await response.json());
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// --------------------------------------------------
// 5. Serve React Frontend (EXPRESS 5 SAFE)
// --------------------------------------------------
const DIST_PATH = path.join(process.cwd(), "dist");
const INDEX_PATH = path.join(DIST_PATH, "index.html");

console.log(`📂 Serving Frontend from: ${DIST_PATH}`);
console.log(fs.existsSync(INDEX_PATH) ? "✅ index.html found!" : "❌ index.html missing");

app.use(express.static(DIST_PATH));

// 🚨 DO NOT ADD A PATH — Express 5 SAFE SPA FALLBACK
app.use((req, res) => {
  if (fs.existsSync(INDEX_PATH)) {
    res.sendFile(INDEX_PATH);
  } else {
    res.status(404).send("Frontend build missing");
  }
});

// --------------------------------------------------
// 6. Start Server
// --------------------------------------------------
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`✅ Main server running on port ${PORT}`);
});
