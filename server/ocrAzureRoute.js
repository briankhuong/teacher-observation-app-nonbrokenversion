// server/ocrAzureRoute.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// Load from environment
const AZURE_ENDPOINT = process.env.AZURE_VISION_ENDPOINT;
const AZURE_KEY = process.env.AZURE_VISION_KEY;

// Parse JSON body (limit to something reasonable)
router.use(express.json({ limit: "5mb" }));

router.post("/api/ocr-azure", async (req, res) => {
  try {
    const { imageDataUrl } = req.body;

    if (!AZURE_ENDPOINT || !AZURE_KEY) {
      return res
        .status(500)
        .json({ error: "Azure OCR not configured on server" });
    }

    if (!imageDataUrl) {
      return res.status(400).json({ error: "imageDataUrl is required" });
    }

    // Extract base64 from "data:image/png;base64,...."
    const base64 = imageDataUrl.split(",")[1];
    const imageBuffer = Buffer.from(base64, "base64");

    // NOTE: adjust api-version/path according to your Azure resource docs
    const url = `${AZURE_ENDPOINT}/vision/v3.2/ocr?language=en&detectOrientation=true`;

    const azureRes = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    });

    if (!azureRes.ok) {
      const text = await azureRes.text();
      console.error("Azure OCR error:", azureRes.status, text);
      return res.status(500).json({ error: "Azure OCR call failed" });
    }

    const azureJson = await azureRes.json();

    // Super simple text extraction – we can refine later
    const lines = [];
    let sumConfidence = 0;
    let count = 0;

    if (azureJson.regions) {
      for (const region of azureJson.regions) {
        for (const line of region.lines) {
          const lineText = line.words.map((w) => w.text).join(" ");
          lines.push(lineText);

          for (const w of line.words) {
            if (typeof w.confidence === "number") {
              sumConfidence += w.confidence;
              count++;
            }
          }
        }
      }
    }

    const text = lines.join("\n");
    const confidence = count > 0 ? sumConfidence / count : 0.8;

    return res.json({ text, confidence });
  } catch (err) {
    console.error("Server /api/ocr-azure error:", err);
    return res.status(500).json({ error: "Internal OCR error" });
  }
});

export default router;
