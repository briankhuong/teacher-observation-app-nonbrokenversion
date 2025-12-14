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
// Allow CORS from your iPad/Network
app.use(cors({ origin: "*" })); 
app.use(express.json({ limit: "10mb" }));

app.post("/api/ocr-azure", async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    // Convert base64 to Buffer
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
      return res.status(azureResponse.status).json({ error: "Azure OCR error", details: text });
    }

    const result = await azureResponse.json();

    const blocks = result?.readResult?.blocks ?? [];
    const lines = [];
    const confidences = [];

    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        if (line.text) lines.push(line.text);
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

const PORT = 4001;

// 🔹 CRITICAL CHANGE: Listen on '0.0.0.0' so the network can see it
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ OCR server listening on http://0.0.0.0:${PORT}`);
});