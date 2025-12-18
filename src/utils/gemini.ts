/**
 * Utility to interact with Google Gemini API (Flash-Lite model)
 * Used for polishing observation notes.
 */

// 🟢 SINGLE ITEM POLISH (Strict "No-Nonsense" Mode)
export async function polishTextWithGemini(
  text: string,
  indicatorTitle?: string,
  indicatorDescription?: string
): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY in environment variables.");
  }

  // 🟢 UPDATED PROMPT: Force single string output & forbid options
  const systemInstruction = `
You are a background text-processing engine. 
Your ONLY task is to rewrite the user's input to be professional, grammatically correct, and constructive.

CONTEXT:
- Indicator: "${indicatorTitle || "General"}"
- Definition: "${indicatorDescription || ""}"

INPUT TEXT:
"${text}"

STRICT OUTPUT RULES:
1. Return **ONLY** the polished text. 
2. Do **NOT** provide options (e.g., "Option 1", "Option 2").
3. Do **NOT** include conversational filler (e.g., "Here is the polished version", "Reasoning:").
4. Do **NOT** use Markdown headers or bolding.
5. Just give the single best result.

CONTENT RULES:
1. **Maintain Original Sentiment:** If the input is negative (e.g., "teacher is bad", "skipped step"), keep it critical/constructive. Do NOT turn it into praise.
2. **No Hallucinations:** Do not invent specific details not found in the input.
3. **Professional Tone:** Rewrite vague/harsh complaints into professional feedback.

Example 1:
Input: "teacher is bad"
Output: "The teacher's performance in this area requires significant improvement." (One line only)

Example 2:
Input: "You skipped the review part"
Output: "The lesson omitted the planned review section, which is a critical step." (One line only)
`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemInstruction }],
      },
    ],
    generationConfig: {
      temperature: 0.3, // Low temp for consistency
      maxOutputTokens: 200,
    },
  };

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini API Error: ${response.status} ${errData?.error?.message || ""}`
    );
  }

  const data = await response.json();
  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

  // 🟢 SAFETY CLEANUP: Strip common prefixes if AI disobeys
  let finalClean = result ? result.trim() : text;
  
  // Remove accidental "Here is..." or "Option 1" prefixes
  finalClean = finalClean.replace(/^Here is (the )?polished.*?:\s*/i, "");
  finalClean = finalClean.replace(/^Option 1:?\s*/i, "");
  finalClean = finalClean.replace(/^\*\*Option 1\*\*:\s*/i, "");

  return finalClean;
}


// ------------------------------------------------------------------

interface BatchItem {
  id: string;
  title: string; // Context
  text: string;  // The user's rough notes
}

// 🟢 BATCH POLISH (Multiple items in one call)
export async function polishBatchWithGemini(
  items: BatchItem[]
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY");
  }

  // 🟢 STRICT BATCH PROMPT
  const systemPrompt = `
You are a professional editor for GrapeSEED teacher observations. 
I will provide a JSON array of notes. Your task is to polish the "text" field of each item.

RULES:
1. Return ONLY a valid JSON object where keys are the IDs and values are the polished text.
2. **Maintain Sentiment:** Do NOT turn negative notes into positive praise. If a note says "bad", keep it critical (e.g., "needs improvement").
3. **No Hallucinations:** Do not add specific details unless they are in the input.
4. **Tone:** Professional, objective, and constructive.

Input Format:
[
  { "id": "1", "text": "teacher is bad", "context": "Tech Issues" },
  { "id": "2", "text": "good energy", "context": "Engagement" }
]

Output Format (Strict JSON):
{
  "1": "The teacher struggled to handle technical issues effectively.",
  "2": "The teacher displayed high energy and engagement."
}
`;

  // We send ID, Text, AND Title (Context)
  const cleanInput = items.map((i) => ({
    id: i.id,
    text: i.text,
    context: i.title,
  }));

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              systemPrompt + "\n\nInput Data:\n" + JSON.stringify(cleanInput),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Very low temperature for consistent JSON
      responseMimeType: "application/json",
    },
  };

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Batch Polish Failed: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) throw new Error("Empty response from AI");

  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.error("Failed to parse AI JSON", rawText);
    throw new Error("AI returned invalid JSON format.");
  }
}