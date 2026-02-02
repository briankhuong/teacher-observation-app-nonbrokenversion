// src/utils/transcribe.ts

export async function transcribeWithGroq(audioBlob: Blob, mimeType: string): Promise<string> {
  const formData = new FormData();
  
  // 🟢 DETERMINE EXTENSION
  // If mime is 'audio/webm' -> use .webm
  // If mime is 'audio/mp4' -> use .m4a (Safari)
  const extension = mimeType.includes("mp4") ? "m4a" : "webm";
  
  formData.append("file", audioBlob, `recording.${extension}`);
  formData.append("mimeType", mimeType); // Optional, but good for debugging

  const SERVER_URL = "/api/transcribe"; 

  const response = await fetch(SERVER_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}