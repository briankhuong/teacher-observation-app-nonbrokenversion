// src/utils/transcribe.ts

export async function transcribeWithGroq(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  // "file" matches upload.single("file") in your backend
  formData.append("file", audioBlob, "recording.wav");

  // 1. Determine URL based on environment
  // If you are running locally, ensure this matches your Express Port (often 3000, 5000, or 8080)
  // If you have a Vite Proxy set up, just "/api/transcribe" works best.
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
  return data.text; // Matches res.json({ text: ... }) in backend
}