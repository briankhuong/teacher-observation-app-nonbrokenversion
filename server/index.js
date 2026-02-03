import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; 
import path from "path";
import { fileURLToPath } from "url";

// Route Imports
import mergeRoutes from "./mergeRoutes.js";
import geminiOcrRoutes from "./ocrGeminiRoute.js";
import polishGroqRoute from "./polishGroqRoute.js";
import syncRoute from "./syncRoute.js";
// ❌ FIXED: Removed the duplicate import of polishGroqRoute here
// Ensure you import the CORRECT file for transcription if it exists:
// import transcriptionRoutes from "./transcriptionRoute.js"; 

dotenv.config({ path: ".env.azure" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// -----------------------------------------------------------------
// 1. Middleware & CORS
// -----------------------------------------------------------------
const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
    : 'http://localhost:5173'; 

app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('192.168') || origin === ALLOWED_ORIGIN) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: false,
}));

app.use(express.json({ limit: "10mb" })); 

// -----------------------------------------------------------------
// 2. API Routes (Must come BEFORE the frontend catch-all)
// -----------------------------------------------------------------

app.use(geminiOcrRoutes);
app.use(polishGroqRoute);
app.use(syncRoute);
app.use(mergeRoutes);
// app.use(transcriptionRoutes); // Uncomment when the file is correct

// GrapeSEED Token Proxy
app.post("/api/get-grapeseed-token", async (req, res) => {
    const authHeader = (process.env.GRAPESEED_AUTH_HEADER || "").trim();
    const username = (process.env.GRAPESEED_USERNAME || "").trim();
    const password = (process.env.GRAPESEED_PASSWORD || "").trim();

    try {
        const url = "https://account.grapeseed.com/connect/token";
        if (!username || !password || !authHeader) {
            return res.status(500).json({ error: "Server misconfiguration" });
        }

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
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Azure OCR Route (Simplified for brevity)
app.post("/api/ocr-azure", async (req, res) => {
    /* Your existing Azure logic is fine here */
});

// -----------------------------------------------------------------
// 3. Static Files & Frontend Routing (KEEP THIS AT THE BOTTOM)
// -----------------------------------------------------------------

// Serve static assets from the build folder
app.use(express.static(path.join(__dirname, '../dist')));

// The Catch-All: This handles client-side routing (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

// -----------------------------------------------------------------
// 4. Start Server
// -----------------------------------------------------------------
const PORT = process.env.OCR_SERVER_PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
