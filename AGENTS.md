# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Stack
- **Backend**: Node.js/Express (server/), Supabase, Microsoft Graph API, Google Gemini API

## Core Architecture
- **Observation Workflow**: Dashboard ([`src/DashboardShell.tsx`](src/DashboardShell.tsx)) lists observations; clicking an observation opens the detailed workspace ([`src/ObservationWorkspaceShell.tsx`](src/ObservationWorkspaceShell.tsx)).
- **Metadata Editing**: Observation card metadata (e.g., teacher name, school, date) is editable directly from the Dashboard via [`src/components/EditObservationModal.tsx`](src/components/EditObservationModal.tsx) and saved via \`persistMergedLinkToObservationMeta\`.
- **Data Persistence**: Supabase is the primary backend. Local storage acts as an offline-first cache and is synced with Supabase.
- **Backend Services**: The [\`server/\`](server/) directory contains Node.js/Express endpoints for email reports, Excel merges, and OCR processing.

## Critical Patterns (Non-Obvious)
- **Misnamed AI Utility**: The file named [`src/utils/gemini.ts`](src/utils/gemini.ts) *actually* uses the **OpenAI API** for its core functionality.
- **ExcelJS Usage**: Custom client-side Excel workbook manipulation for merging, duplication, and conditional formatting via [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts).
- **Template Dependency**: The Excel merge process *requires* fetching the canonical template from [\`public/TeacherTemplate.xlsx\`](public/TeacherTemplate.xlsx) before modification.
- **Microsoft Graph API Integration**: Direct interaction with Graph API for Excel (download, upload, links) requiring specific authorization and Base64 encoding for \`shareId\`s.
- **Excel File Locking**: \`uploadBufferWithRetry\` in [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts) includes retry logic for handling Microsoft Excel file locking (423/409 HTTP status codes).
- **Gemini AI Markers**: The AI polishing functions in [`src/utils/gemini.ts`](src/utils/gemini.ts) *must* preserve hyphens (-) and "(GA)" markers at the beginning of lines, as these are critical for Excel placement.
- **Hardcoded Excel Cell References**: Data in Excel workbooks is written to specific hardcoded cells (e.g., "A1", "D4", "E6"), as seen in [`src/utils/clientExcelMerge.ts`](src/utils/clientExcelMerge.ts).

## Testing
- No automated unit/integration testing setup is explicitly configured in \`package.json\` or through common configuration files. Manual testing is currently used for verification.