/**
 * src/utils/gemini.ts
 * Utility to interact with Google Gemini API.
 * Includes "Single Polish" for individual edits and "Batch Polish" for the "Polish All" button.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ⚡ Switch to 1.5-Flash (Stable) for higher rate limits than the Preview model
const MODEL_NAME = "gemini-1.5-flash"; 

if (!API_KEY) {
  console.error("Missing VITE_GEMINI_API_KEY in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.2, // Lower temperature = strictly follows instructions
  }
});

// ==========================================
// 1. SINGLE ITEM POLISH
// Used when clicking the "✨ AI Polish" button on a specific indicator
// ==========================================
export async function polishTextWithGemini(
  text: string,
  indicatorTitle?: string,
  indicatorDescription?: string
): Promise<string> {
  if (!text) return "";

  // 🛡️ STRICT PROMPT: Uses XML tags to separate "Reference" from "Work"
  const systemInstruction = `
You are a professional pedagogical editor. 
Your task is to rewrite the text inside <user_input> to be professional, constructive, and grammatically correct (US English).

<reference_material>
  Indicator: ${indicatorTitle || "General"}
  Definition: ${indicatorDescription || ""}
  (INSTRUCTION: This is context ONLY. Do NOT paraphrase or output this text.)
</reference_material>

<user_input>
  ${text}
</user_input>

RULES:
1. Rewrite ONLY the content found inside <user_input>.
2. If <user_input> is extremely short (e.g., "bad", "good"), expand it slightly into a professional sentence, but DO NOT simply copy the <reference_material>.
3. Maintain the original sentiment. If the input is negative, keep the critique but make it professional.
4. Return ONLY the final polished string. No quotes, no headers.
`;

  try {
    const result = await model.generateContent(systemInstruction);
    const response = await result.response;
    const polished = response.text();

    // Safety cleanup
    if (!polished) return text;
    
    // Strip common AI conversational prefixes
    let finalClean = polished.trim();
    finalClean = finalClean.replace(/^Here is (the )?polished.*?:\s*/i, "");
    finalClean = finalClean.replace(/^Option 1:?\s*/i, "");
    finalClean = finalClean.replace(/^Revised:?\s*/i, "");

    return finalClean;

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    // Graceful fallback
    throw new Error("AI busy. Please wait a moment."); 
  }
}


// ==========================================
// 2. BATCH POLISH (1 Request for ALL items)
// Used when clicking "✨ Polish All"
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

  // 1. Prepare data 
  // 🟢 RENAMED FIELDS: helps the AI distinguish "Reference" vs "Input"
  const cleanInput = items.map((i) => ({
    id: i.id,
    topic_reference: i.title, // Passive context
    user_raw_input: i.text,   // Active input to rewrite
  }));

  // 2. Strict JSON Prompt
  const systemPrompt = `
You are a professional editor for teacher observation reports.
I will provide a JSON array of raw notes. 
Your task is to polish the "user_raw_input" field for grammar and professional tone (US English).

INPUT DATA:
${JSON.stringify(cleanInput, null, 2)}

INSTRUCTIONS:
1. Return ONLY a valid JSON object.
2. Keys must match the "id" from input.
3. Values must be the polished version of "user_raw_input".
4. 🛑 CRITICAL: Do NOT use the "topic_reference" as your output. You must rewrite the "user_raw_input". 
5. If "user_raw_input" is very short (e.g. "poor"), write "The performance in this area needs improvement" instead of copying the topic definition.
6. Maintain original sentiment (do not turn negatives into praise).

EXAMPLE OUTPUT:
{
  "ind-1": "The teacher managed the classroom effectively.",
  "ind-2": "The pacing of the lesson needs adjustment."
}
`;

  try {
    // Force JSON mode for reliability
    const jsonModel = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json" } 
    });

    const result = await jsonModel.generateContent(systemPrompt);
    const response = await result.response;
    const rawText = response.text();

    if (!rawText) throw new Error("Empty response from AI");

    // 3. Parse JSON
    // Sometimes AI adds Markdown code blocks even in JSON mode, so we strip them
    const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(cleanedJson);

  } catch (e) {
    console.error("Batch Polish Error:", e);
    // Handle the 429 specifically for user clarity
    if (String(e).includes("429")) {
      throw new Error("Quota exceeded. Please wait 60 seconds.");
    }
    throw new Error("Failed to process batch. Try polishing individual items.");
  }
}