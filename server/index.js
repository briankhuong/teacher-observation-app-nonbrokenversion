// server/index.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.azure" });

import express from "express";
import cors from "cors";

import ocrAzureRoute from "./ocrAzureRoute.js";
// (for now we can keep emailTeacherRoute wired if you want,
// but it's optional while we pivot to delegated-email design)
// import emailTeacherRoute from "./emailTeacherRoute.js";

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: false,
  })
);

app.use(express.json());

// OCR endpoint
app.use(ocrAzureRoute);

// If you still want the /api/email stub mounted, uncomment:
// app.use("/api/email", emailTeacherRoute);

const PORT = process.env.OCR_SERVER_PORT || 4000;

app.listen(PORT, () => {
  console.log(`OCR server running at http://localhost:${PORT}`);
});