# Project Architecture Rules (Non-Obvious Only)

- The AI utility [`src/utils/gemini.ts`](src/utils/gemini.ts) uses the OpenAI API, which is a key architectural decision that must be respected when proposing changes to AI features.
- Data persistence utilizes a **local storage cache synced with Supabase**, making the local cache an offline-first critical path. Design changes must consider this two-layer persistence model.
- Excel manipulation is a **client-side process using ExcelJS** for merging (in [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts)), relying heavily on a specific [\`public/TeacherTemplate.xlsx\`](public/TeacherTemplate.xlsx) file.
- The system depends on external Microsoft Graph API integration for Excel and email, requiring careful handling of authorization and Base64-encoded \`shareId\`s.
- The Node.js Express server in [\`server/\`](server/) acts as a service layer for non-frontend tasks (OCR, bulk email, bulk merge) and should be treated as decoupled from the frontend state.