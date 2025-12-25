import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// 1. Initialize Gemini
// We check for the key inside the request to ensure it's loaded, 
// or fail fast if missing.
const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;

const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

router.use(express.json({ limit: "10mb" }));

router.post("/api/ocr-gemini", async (req, res) => {
  try {
    // 2. Safety Checks
    if (!GEN_AI_KEY) {
      console.error("❌ GOOGLE_GENERATIVE_AI_KEY is missing in server environment.");
      return res.status(500).json({ error: "Server missing Google API Key" });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // 3. Prepare the Model
    // 'gemini-1.5-flash' is the fastest and cheapest for OCR tasks.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


    // This tells Gemini: "Read my messy writing, fix the English, but DON'T break the Excel formatting."
    const prompt = `
      You are an expert assistant transcribing a teacher's observation notes.
      
      TASK:
      1. Transcribe the handwriting accurately from the image.
      2. Fix grammar, spelling, and tense (e.g., "She speak" -> "She spoke").
      3. Expand shorthand (e.g., "tchr" -> "teacher").
      4. Keep the tone SIMPLE. Do not upgrade vocabulary (e.g., keep "good job", do NOT change to "exemplary").

      CRITICAL DATA INTEGRITY RULES:
      - You must PRESERVE all structure markers exactly as they appear.
      - NEVER remove a hyphen "-" at the start of a line.
      - NEVER remove or change tags like "(GA)", "(WA)", etc. 
      - These markers are required for the text to load correctly into Excel files.

      Return ONLY the cleaned-up text. Do not add conversational filler.
    `;

    // 5. Send to Gemini
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg", // We send JPEG from frontend
        },
      },
    ]);

    const response = await result.response;
    const text = response.text().trim();

    // 6. Return standard JSON
    // We mock "confidence" because Gemini doesn't return it per word,
    // but if it generated text, it's usually high confidence.
    return res.json({ 
      text: text, 
      confidence: 0.95 
    });

  } catch (err) {
    console.error("Gemini OCR Error:", err);
    
    // 7. Handle Safety Blocks or API Errors
    // This ensures your frontend shows the red error box correctly.
    let errorMessage = "Failed to process image with Gemini.";
    
    if (err.message && err.message.includes("SAFETY")) {
      errorMessage = "Gemini blocked this image due to safety filters.";
    }

    return res.status(500).json({ 
      error: errorMessage, 
      details: err.message 
    });
  }
});

export default router;