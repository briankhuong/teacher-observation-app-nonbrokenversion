import 'dotenv/config';

const endpoint = process.env.AZURE_OCR_ENDPOINT;
const key = process.env.AZURE_OCR_KEY;

if (!endpoint || !key) {
  console.error("❌ Missing AZURE_OCR_ENDPOINT or AZURE_OCR_KEY in .env.azure");
  process.exit(1);
}

// Use a simple test image URL
const imageUrl =
  "https://learn.microsoft.com/azure/ai-services/computer-vision/media/quickstarts/presentation.png";

async function run() {
  console.log("🔍 Testing Azure OCR…");

  const url = `${endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: imageUrl }),
  });

  const text = await response.text();

  console.log("Status:", response.status);
  console.log("Response:");
  console.log(text);
}

run().catch((err) => {
  console.error("❌ Request failed");
  console.error(err);
});
