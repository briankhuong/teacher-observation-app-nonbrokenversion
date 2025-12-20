# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Stack
- **Language/Framework**: TypeScript, React
- **Build Tool**: Vite
- **Package Manager**: npm
- **Backend**: Node.js/Express (server/), Supabase, Microsoft Graph API, Google Gemini API

## Commands
- **Development Server**: `npm run dev` (Frontend: Vite)
- **Build**: `npm run build` (Frontend: TypeScript compilation & Vite build)
- **Lint**: `npm run lint` (ESLint)
- **Preview Build**: `npm run preview`
- **Start Backend Server**: `npm start` (Backend: Node.js Express server)

## Core Architecture
- **Frontend Entry**: `index.html` loads `src/main.tsx`.
- **Main App**: `src/App.tsx` manages top-level routing, authentication, and renders shell components.
- **Observation Workflow**: Dashboard (`src/DashboardShell.tsx`) lists observations; clicking an observation opens the detailed workspace (`src/ObservationWorkspaceShell.tsx`).
- **Metadata Editing**: Observation card metadata (e.g., teacher name, school, date) is editable directly from the Dashboard via `src/components/EditObservationModal.tsx` and saved via `persistMergedLinkToObservationMeta`.
- **Data Persistence**: Supabase is the primary backend. Local storage acts as an offline-first cache and is synced with Supabase.
- **Backend Services**: The `server/` directory contains Node.js/Express endpoints for email reports, Excel merges, and OCR processing.

## Critical Patterns (Non-Obvious)
- **ExcelJS Usage**: Custom client-side Excel workbook manipulation for merging, duplication, and conditional formatting via `src/utils/clientExcelMerge.ts`.
- **Microsoft Graph API Integration**: Direct interaction with Graph API for Excel (download, upload, links) requiring specific authorization and Base64 encoding for `shareId`s.
- **Excel File Locking**: `uploadBufferWithRetry` in `src/utils/clientExcelMerge.ts` includes retry logic for handling Microsoft Excel file locking (423/409 HTTP status codes).
- **Gemini AI Markers**: The AI polishing functions in `src/utils/gemini.ts` *must* preserve hyphens (-) and "(GA)" markers at the beginning of lines, as these are critical for Excel placement.
- **Hardcoded Excel Cell References**: Data in Excel workbooks is written to specific hardcoded cells (e.g., "A1", "D4", "E6"), as seen in `src/utils/clientExcelMerge.ts`.

## Code Style
- Enforced via ESLint with recommended configurations for JavaScript, TypeScript, and React Hooks. No project-specific custom rules are defined.

## Testing
- No automated unit/integration testing setup is explicitly configured in `package.json` or through common configuration files. Manual testing is currently used for verification.