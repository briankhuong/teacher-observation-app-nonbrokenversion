export async function transcribeWithGroq(audioBlob: Blob, mimeType: string): Promise<string> {
  const formData = new FormData();
  
  // 1. Determine the extension based on the browser's mimeType
  const extension = mimeType.includes("mp4") ? "m4a" : "webm";
  
  // 2. The key MUST be "file" to match the server's upload.single("file")
  formData.append("file", audioBlob, `recording.${extension}`);

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData, // Do NOT set Content-Type header manually; fetch handles the boundary
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Transcription failed");
  }

  const data = await response.json();
  return data.text;
}