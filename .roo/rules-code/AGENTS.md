# Project Coding Rules (Non-Obvious Only)

- The AI utility [`src/utils/gemini.ts`](src/utils/gemini.ts) *uses the OpenAI API*, not Gemini. Do not assume Gemini-specific code or configuration.
- AI polishing functions in [`src/utils/gemini.ts`](src/utils/gemini.ts) *must* preserve hyphens (-) and "(GA)" markers at the beginning of lines for Excel compatibility.
- Excel data manipulation is handled client-side using ExcelJS via [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts), which contains hardcoded cell references (e.g., "A1", "D4"). When modifying Excel output, these files must be checked.
- All Excel merge operations require fetching the template from [\`public/TeacherTemplate.xlsx\`](public/TeacherTemplate.xlsx) first.
- Microsoft Graph API interactions in [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts) use a specific \`shareId\` Base64 encoding for download/upload links.
- Use `persistMergedLinkToObservationMeta` for saving updated observation metadata after editing in [`src/components/EditObservationModal.tsx`](src/components/EditObservationModal.tsx).