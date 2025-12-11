// azure-ocr-server.mjs
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config({ path: ".env.azure" });

const endpoint = process.env.AZURE_OCR_ENDPOINT;
const key = process.env.AZURE_OCR_KEY;

if (!endpoint || !key) {
  console.error("❌ Missing AZURE_OCR_ENDPOINT or AZURE_OCR_KEY in .env.azure");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // we send base64 PNG

app.post("/api/ocr-azure", async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");

    const url =
      `${endpoint.replace(/\/+$/, "")}` +
      `/computervision/imageanalysis:analyze` +
      `?api-version=2023-10-01&features=read`;

    const azureResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    });

    if (!azureResponse.ok) {
      const text = await azureResponse.text();
      console.error("Azure error:", azureResponse.status, text);
      return res
        .status(azureResponse.status)
        .json({ error: "Azure OCR error", details: text });
    }

    const result = await azureResponse.json();

    // 🔎 Safely pull out lines + average confidence
    const blocks = result?.readResult?.blocks ?? [];
    const lines = [];
    const confidences = [];

    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        if (line.text) lines.push(line.text);
        // average word confidence per line
        if (line.words && line.words.length) {
          const avg =
            line.words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) /
            line.words.length;
          confidences.push(avg);
        }
      }
    }

    const text = lines.join("\n");
    const confidence =
      confidences.length === 0
        ? 0
        : confidences.reduce((a, b) => a + b, 0) / confidences.length;

    return res.json({ text, confidence });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`✅ OCR server listening on http://localhost:${PORT}`);
});