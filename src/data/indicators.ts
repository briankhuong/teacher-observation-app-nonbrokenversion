// src/data/indicators.ts

export interface Indicator {
  id: string;
  number: string;      // e.g. "1.1", "2.1–2.2", etc.
  title: string;
  description: string;
  hasPreComment: boolean;
  preComment?: string;
}

// CLEANED INDICATORS — PHASE 2 VERSION
// (Shortened placeholder — replace with your real cleaned list)
export const INDICATORS: Indicator[] = [
  {
    id: "ind-1",
    number: "1.1",
    title: "Classroom Environment",
    description: "The space is orderly and supports learning.",
    hasPreComment: true,
    preComment: "The learning environment was well-organized.",
  },
  {
    id: "ind-2",
    number: "1.2",
    title: "Materials Preparation",
    description: "Teacher prepares materials in advance.",
    hasPreComment: false,
  },
  {
    id: "ind-3",
    number: "2.1–2.2",
    title: "Lesson Planning & Routines",
    description: "Teacher follows GrapeSeed routines consistently.",
    hasPreComment: true,
    preComment: "The teacher followed routines smoothly.",
  },
  // TODO — I will replace these with your actual 18 cleaned indicators.
];
