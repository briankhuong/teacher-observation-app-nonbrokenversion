# Project Debug Rules (Non-Obvious Only)

- The AI utility [`src/utils/gemini.ts`](src/utils/gemini.ts) uses the OpenAI API, not Gemini. Debugging AI functionality requires checking OpenAI-related environment variables and network traffic.
- Excel file locking issues during upload (HTTP 423/409) are handled by a retry mechanism in \`uploadBufferWithRetry\` in [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts). Check for failures after retries are exhausted.
- Backend services for email/Excel/OCR are in [\`server/\`](server/). To debug backend issues, ensure the Node.js Express server is running.
- Frontend data persistence uses a local storage cache synced with Supabase. When debugging data issues, check both local storage and the Supabase tables.