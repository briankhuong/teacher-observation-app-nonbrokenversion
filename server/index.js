// server/index.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.azure" });

import express from "express";
import cors from "cors";

import ocrAzureRoute from "./ocrAzureRoute.js";
import mergeRoutes from "./mergeRoutes.js"; // 👈

const app = express();

// -----------------------------------------------------------------
// 🟢 FIX: Dynamic CORS Origin
// -----------------------------------------------------------------

const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' 
    : 'http://localhost:5173'; 

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    credentials: false,
  })
);

// -----------------------------------------------------------------
// -----------------------------------------------------------------

app.use(express.json({ limit: "10mb" }));

// OCR endpoint
app.use(ocrAzureRoute);

// 🔗 Merge endpoints mounted: REMOVED "/api" prefix here.
// The /api prefix is now handled INSIDE mergeRoutes.js
app.use(mergeRoutes); // 👈 **FIX: No more "/api" prefix here**

const PORT = process.env.OCR_SERVER_PORT || 4000;

app.listen(PORT, () => {
  console.log(`OCR / merge server running at http://localhost:${PORT}`);
  console.log(`Allowed CORS Origin: ${ALLOWED_ORIGIN}`);
});