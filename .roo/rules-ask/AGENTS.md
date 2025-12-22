# Project Documentation Rules (Non-Obvious Only)

- The core AI utility file [`src/utils/gemini.ts`](src/utils/gemini.ts) is misnamed; it implements OpenAI API calls, not Gemini.
- The canonical template for Excel merging is [\`public/TeacherTemplate.xlsx\`](public/TeacherTemplate.xlsx).
- The Observation Workspace is rendered by [`src/ObservationWorkspaceShell.tsx`](src/ObservationWorkspaceShell.tsx) and is the main view for detailed observation data.
- Metadata editing (teacher, school, date) is handled by [`src/components/EditObservationModal.tsx`](src/components/EditObservationModal.tsx) and the related persistence logic.
- Backend logic for reports, merges, and OCR is in the [\`server/\`](server/) directory.