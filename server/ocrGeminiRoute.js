import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// 1. Initialize Gemini
// We check for the key inside the request to ensure it's loaded, 
// or fail fast if missing.
const GEN_AI_KEY = process.env.GOOGLE_GENERATIVE_AI_KEY;

const genAI = new GoogleGenerativeAI(GEN_AI_KEY || "");

// Increase payload limit to handle Base64 images
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
    // Using 'gemini-1.5-flash' - currently the best balance of speed/cost for OCR.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 4. The "Minimalist Fixer" Prompt
    // This incorporates your requirements: Fix grammar, keep style, preserve Excel markers.
    const prompt = `
      You are an expert handwriting transcriber and strict grammar editor.

      TASK:
      1. Transcribe the text from the image exactly.
      2. Fix the grammar and formatting of the transcribed text using the rules below.

      CRITICAL RULES (DATA INTEGRITY):
      - PRESERVE MARKERS: You must NEVER remove or alter hyphens "-" at the start of lines or tags like "(GA)" or "(WA)". These are critical for placing text into Excel files.
      - PRESERVE LINE BREAKS: Keep the vertical structure of the notes.

      EDITING RULES (MINIMALIST):
      - EXPAND SHORTHAND: Convert "tchr" -> "teacher", "stdnts" -> "students", "w/" -> "with".
      - FIX TENSE & GRAMMAR: Convert "She speak loud" -> "She spoke loudly".
      - ADD GLUE WORDS: Convert "Students happy" -> "The students were happy".
      - DO NOT UPGRADE VOCABULARY: If the user wrote "good job", keep it "Good job." Do NOT change it to "Exemplary performance." Keep the tone simple and direct.

      OUTPUT:
      - Return ONLY the final cleaned text. Do not add conversational filler like "Here is the text."
    `;

    // 5. Send to Gemini
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg", // Ensure the frontend sends this or matches the actual type
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

  } catch (err: any) {
    console.error("Gemini OCR Error:", err);
    
    // 7. Handle Safety Blocks or API Errors
    let errorMessage = "Failed to process image with Gemini.";
    
    // Check if the error is related to safety settings blocking the content
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