// src/utils/gemini.ts

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
//const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
interface PolishRequest {
  text: string;
  indicatorTitle: string;
  indicatorDescription: string;
}

/**
 * Sends a teacher observation note to Gemini for polishing.
 * Uses a "Circuit Breaker" timeout to prevent hanging on bad connections.
 */
export async function polishTextWithGemini({
  text,
  indicatorTitle,
  indicatorDescription,
}: PolishRequest): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("VITE_GEMINI_API_KEY is missing in .env file");
  }

  // 1. The Prompt Engineering
  // We give the AI a specific persona: Expert Supervisor.
  const systemPrompt = `
You are an expert English Language Trainer Supervisor for the GrapeSEED curriculum.
Your task is to polish the following observation notes written by a trainer.

Rules:
1. Fix grammar, spelling, and awkward phrasing.
2. Maintain a professional, supportive, and constructive tone.
3. Keep specific GrapeSEED terminology (e.g., "Memory Mode", "REP", "TGL", "Pointer").
4. Do NOT change the core meaning of the observation.
5. Return ONLY the polished text. No conversational filler ("Here is the polished version...").

Context:
Indicator: ${indicatorTitle}
Description: ${indicatorDescription}
Original Note: "${text}"
`;

  // 2. The Payload
  const payload = {
    contents: [
      {
        parts: [{ text: systemPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3, // Low temperature = more consistent/focused, less creative
      maxOutputTokens: 500,
    },
  };

  // 3. The Fetch with Timeout (Reliable Sync Strategy)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Gemini API Error: ${response.status}`);
    }

    const data = await response.json();
    const polishedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!polishedText) {
      throw new Error("Gemini returned an empty response.");
    }

    return polishedText.trim();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Please check your internet connection.");
    }
    throw err;
  }
}

// src/utils/gemini.ts

// ... existing code ...

interface BatchItem {
  id: string;
  title: string;
  text: string;
}

/**
 * Polishes multiple indicators in a SINGLE API call to save quota.
 */
export async function polishBatchWithGemini(items: BatchItem[]): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const systemPrompt = `
You are an expert GrapeSEED Supervisor. 
I will provide a JSON array of observation notes. 
Your task is to polish the "text" field of each item.

Rules:
1. Return ONLY a valid JSON object where keys are the IDs and values are the polished text.
2. Fix grammar and tone (professional, supportive).
3. Keep GrapeSEED terminology intact.
4. Do not change the meaning.

Input Format:
[
  { "id": "1", "text": "teacher use good gesture" },
  ...
]

Output Format (Strict JSON):
{
  "1": "The teacher used effective gestures.",
  ...
}
`;

  // Simplify the payload to just ID and Text to save tokens
  const cleanInput = items.map(i => ({ id: i.id, text: i.text }));

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemPrompt + "\n\nInput:\n" + JSON.stringify(cleanInput) }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json", // 🟢 Forces Gemini to return perfect JSON
    },
  };

  // Use the reliable, free model
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`;
  
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