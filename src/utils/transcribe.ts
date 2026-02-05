export async function transcribeWithGroq(audioBlob: Blob, mimeType: string): Promise<string> {
  const formData = new FormData();
  
  // 🟢 DETERMINE EXTENSION
  const extension = mimeType.includes("mp4") ? "m4a" : "webm";
  
  formData.append("file", audioBlob, `recording.${extension}`);
  formData.append("mimeType", mimeType);

  // 🔥 FIX: Explicitly point to the backend port
  const SERVER_URL = "http://localhost:4000/api/transcribe"; 

  const response = await fetch(SERVER_URL, {
    method: "POST",
    body: formData,
    // Note: Browser automatically sets the correct Multipart boundary headers
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}