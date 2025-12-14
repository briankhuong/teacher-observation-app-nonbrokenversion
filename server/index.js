import dotenv from "dotenv";
dotenv.config({ path: ".env.azure" });

import express from "express";
import cors from "cors";

import ocrAzureRoute from "./ocrAzureRoute.js";
import mergeRoutes from "./mergeRoutes.js"; // 👈
// If you keep teacher email route later:
// import emailTeacherRoute from "./emailTeacherRoute.js";

const app = express();

// -----------------------------------------------------------------
// 🟢 FIX: Dynamic CORS Origin
// -----------------------------------------------------------------

// The environment on Render will be 'production'.
// In production, we explicitly allow the Vercel frontend URL.
// In development, we allow the local host URL.
const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production'
    ? 'https://teacher-observation-app-nonbrokenve-delta.vercel.app' // 👈 Your Vercel Live URL
    : 'http://localhost:5173'; 

app.use(
  cors({
    origin: ALLOWED_ORIGIN, // ✅ Now uses the dynamic URL
    credentials: false,
  })
);

// -----------------------------------------------------------------
// -----------------------------------------------------------------

app.use(express.json({ limit: "10mb" }));

// OCR endpoint
app.use(ocrAzureRoute);

// 🔗 Merge endpoints mounted under /api
app.use("/api", mergeRoutes);

// The PORT variable is fine, it defaults to 4000
const PORT = process.env.OCR_SERVER_PORT || 4000;

app.listen(PORT, () => {
  console.log(`OCR / merge server running at http://localhost:${PORT}`);
  console.log(`Allowed CORS Origin: ${ALLOWED_ORIGIN}`); // Helper log
});