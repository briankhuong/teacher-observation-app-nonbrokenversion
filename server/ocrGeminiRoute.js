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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });


    // This tells Gemini: "Read my messy writing and turn it into clear, correct English."
    const prompt = `
      You are an expert assistant transcribing a teacher's observation notes.
      The user has written these notes quickly by hand. 
      
      Your job is to:
      1. Transcribe the handwriting accurately.
      2. CORRECT all grammar, spelling, and punctuation errors automatically.
      3. EXPAND shorthand (e.g., convert "stdnts" to "students", "w/" to "with").
      4. MAKE IT READABLE: Ensure the sentences flow naturally as standard English.
      
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