/**
 * src/utils/gemini.ts
 * Utility to interact with Google Gemini API.
 * Uses "gemini-1.5-flash" (Standard Alias) to ensure stability and avoid 404 errors.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// 🟢 FINAL FIX: Use the standard alias "gemini-1.5-flash".
// This auto-resolves to the latest stable version and prevents "Model Not Found" errors.
const MODEL_NAME = "gemini-1.5-flash"; 

if (!API_KEY) {
  console.error("Missing VITE_GEMINI_API_KEY in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.3, 
  }
});

// ==========================================
// 1. SINGLE ITEM POLISH
// ==========================================
export async function polishTextWithGemini(
  text: string,
  _unusedTitle?: string,
  _unusedDescription?: string
): Promise<string> {
  if (!text || text.trim().length === 0) return "";

  const systemInstruction = `
You are a professional copy editor for teacher observation reports.
Your task is to polish the draft text below to be professional, grammatically correct, and constructive (US English).

INPUT TEXT:
"${text}"

RULES:
1. Fix grammar, spelling, and professional tone.
2. Maintain the original sentiment (do not change "bad" to "good", just make it professional).
3. Do not add any conversational filler like "Here is the rewritten text".
4. Return ONLY the polished string.
`;

  try {
    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const polished = response.text();

    if (!polished) return text;
    
    // Clean up common AI prefixes
    let finalClean = polished.trim();
    finalClean = finalClean.replace(/^Here is.*?:\s*/i, "").replace(/^Revised.*?:\s*/i, "");
    finalClean = finalClean.replace(/^"(.*)"$/, "$1");

    return finalClean;

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    throw new Error("AI Service Busy. Please try again."); 
  }
}


// ==========================================
// 2. BATCH POLISH
// ==========================================

interface BatchItem {
  id: string;
  title: string;
  text: string;
}

export async function polishBatchWithGemini(
  items: BatchItem[]
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const cleanInput = items.map((i) => ({
    id: i.id,
    draft_text: i.text, 
  }));

  const systemPrompt = `
You are a professional editor. I will provide a JSON array of raw draft notes.
Your task is to polish the "draft_text" field for professional tone (US English).

INPUT DATA:
${JSON.stringify(cleanInput, null, 2)}

INSTRUCTIONS:
1. Return ONLY valid JSON.
2. The output keys must match the "id" from the input.
3. The output values must be the polished version of "draft_text".
4. Do not paraphrase. Just fix grammar and tone.

EXAMPLE:
Input: [{"id":"1", "draft_text":"kids noisy"}]
Output: {"1": "The students were noisy and required redirection."}
`;

  try {
    const jsonModel = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json" } 
    });

    const result = await jsonModel.generateContent(systemPrompt);
    const response = await result.response;
    const rawText = response.text();

    if (!rawText) throw new Error("Empty response from AI");

    const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedJson);

  } catch (e) {
    console.error("Batch Polish Error:", e);
    throw new Error("Batch processing failed. Try individual items.");
  }
}