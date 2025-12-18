/**
 * src/utils/gemini.ts
 * * Utility to interact with Google Gemini API.
 * Includes "Single Polish" for individual edits and "Batch Polish" for the "Polish All" button.
 */

// ==========================================
// 1. SINGLE ITEM POLISH
// Used when clicking the "✨ AI Polish" button on a specific indicator
// ==========================================
export async function polishTextWithGemini(
  text: string,
  indicatorTitle?: string,
  indicatorDescription?: string
): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY in environment variables.");
  }

  // Strict prompt to ensure professional, concise output
  const systemInstruction = `
You are a professional pedagogical editor. Rewrite the input to be professional, grammatically correct, and constructive (US English).

CONTEXT:
- Indicator: "${indicatorTitle || "General"}"
- Definition: "${indicatorDescription || ""}"

INPUT: "${text}"

RULES:
1. Return ONLY the polished text. No conversational filler.
2. Maintain the original sentiment (if negative, keep it constructive but critical).
3. Do not invent details not present in the input.
4. Output must be a single string.
`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: systemInstruction }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 250,
    },
  };

  // Using the efficient flash-lite model
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-preview-02-05:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      // Handle the 429 Rate Limit specifically
      if (response.status === 429) {
        throw new Error("Too many requests. Please wait a moment before trying again.");
      }
      throw new Error(`Gemini API Error: ${response.status} ${errData?.error?.message || ""}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

    // Safety cleanup
    if (!result) return text;
    let finalClean = result.trim();
    // Remove common AI prefixes just in case
    finalClean = finalClean.replace(/^Here is (the )?polished.*?:\s*/i, "");
    
    return finalClean;

  } catch (err: any) {
    console.error("AI Polish Error:", err);
    throw err; // Re-throw so the UI knows it failed
  }
}


// ==========================================
// 2. BATCH POLISH (The Fix for 429 Errors)
// Used when clicking "✨ Polish All"
// Sends 1 request for ALL items.
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

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY");
  }

  // 1. Prepare the data for the prompt
  // We strip unnecessary fields to save tokens
  const cleanInput = items.map((i) => ({
    id: i.id,
    context: i.title,
    note: i.text,
  }));

  // 2. Construct ONE giant prompt
  const systemPrompt = `
You are a professional editor for teacher observation reports.
I will provide a JSON array of raw notes. 
Your task is to polish each note for grammar and professional tone (US English).

INPUT DATA:
${JSON.stringify(cleanInput, null, 2)}

INSTRUCTIONS:
1. Return ONLY a valid JSON object.
2. The keys must be the "id" from the input.
3. The values must be the polished version of the "note".
4. Maintain the original sentiment (do not turn negative feedback into praise).
5. Do not include markdown code blocks (like \`\`\`json). Just the raw JSON string.

EXAMPLE OUTPUT:
{
  "ind-1": "The teacher managed the classroom effectively.",
  "ind-2": "The pacing of the lesson needs adjustment."
}
`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
    generationConfig: {
      temperature: 0.2, // Low temp for reliable JSON
      // 'responseMimeType' ensures Gemini tries to output valid JSON
      responseMimeType: "application/json", 
    },
  };

  // We use the same Flash-Lite model
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-preview-02-05:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("System is busy (Rate Limit). Please wait 60 seconds and try again.");
      }
      throw new Error(`Batch Polish Failed: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) throw new Error("Empty response from AI");

    // 3. Parse the result
    // Sometimes AI adds backticks even with JSON mode, so we clean it.
    const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(cleanedJson);

  } catch (e) {
    console.error("Batch Polish Error:", e);
    throw new Error("Failed to process batch polish. Please try individual items or wait a minute.");
  }
}