// server/index.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.azure" });

import express from "express";
import cors from "cors";

import ocrAzureRoute from "./ocrAzureRoute.js";
import mergeRoutes from "./mergeRoutes.js"; // 👈
// If you keep teacher email route later:
// import emailTeacherRoute from "./emailTeacherRoute.js";

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: false,
  })
);

app.use(express.json({ limit: "10mb" }));

// OCR endpoint
app.use(ocrAzureRoute);

// 🔗 Merge endpoints mounted under /api
app.use("/api", mergeRoutes);

const PORT = process.env.OCR_SERVER_PORT || 4000;

app.listen(PORT, () => {
  console.log(`OCR / merge server running at http://localhost:${PORT}`);
});