// src/constants.ts

export type PerformanceRating = "Developing" | "Functioning" | "Thriving" | null;
// 1. Move the types here so they can be shared
export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  color: string;
  size: number;
  points: StrokePoint[];
  mode: "pen" | "eraser";
}

export interface IndicatorState {
  id: string;
  number: string;
  title: string;
  description: string;
  hasPreComment: boolean;
  preComment?: string;
  good: boolean;
  growth: boolean;
  favorite: boolean;
  commentText: string;
  strokes: Stroke[];
  performance_rating?: PerformanceRating;
  ocrUsed?: boolean;
  ocrLastRunAt?: number | null;
  ocrLastConfidence?: number | null; 
  ocrPendingReview?: boolean;        
  includeInTrainerSummary?: boolean;  
  aiPendingReview?: boolean;
}

// 2. Move the data array here and ensure it uses "export"
export const INITIAL_INDICATORS: IndicatorState[] = [
  {
    id: "ind-1",
    number: "1.1",
    title: "Organized Teaching Area",
    description: "- Teaching area is highly organized; materials, props, and technology are easily accessible. Students can see the teaching materials well.",
    hasPreComment: true,
    preComment: "The classroom was spacious, which is ideal for students to learn English with GrapeSEED.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-2",
    number: "1.2",
    title: "Safe teaching environment",
    description: "Teaching environment is completely safe for all activities. Classroom space is effectively organized for easy movement during AAs and transitions.",
    hasPreComment: true,
    preComment: "The classroom was spacious, which is ideal for students to learn English with GrapeSEED.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-3",
    favorite: false,  
    number: "1.3",
    title: "Visually stimulating environment",
    description: "Classroom visuals fully reinforce lesson content and engage students.",
    hasPreComment: true,
    preComment: "The classroom was spacious, which is ideal for students to learn English with GrapeSEED.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
  },
  {
    id: "ind-4",
    number: "2.1.– 2.2",
    title: "Classroom Routines & Management Strategies",
    description: "- Routines are well-planned, effectively taught/modeled, and consistently reinforced.\n- Effective strategies create a productive and positive environment.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-5",
    number: "2.3",
    title: "Problem-Solving Tech Issues",
    description: "Proactively resolves tech issues without interrupting lessons.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-6",
    number: "3.1",
    title: "Utilizing Lesson Plans",
    description: "Follows lesson plans with precision and adapts effectively.",
    hasPreComment: true,
    preComment: "You managed to follow all instructions in the lesson plan.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-7",
    number: "3.5",
    title: "Using Memory Mode",
    description: "Effectively delivers lessons using Memory Mode, allowing smooth and engaging instruction.",
    hasPreComment: true,
    preComment: "You have memorized all the materials.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-8",
    number: "3.4 – 5.1",
    title: "Using Materials Effectively",
    description: "Fully utilizes GrapeSEED materials as outlined in the Lesson Plans and manuals.",
    hasPreComment: true,
    preComment: "You delivered all materials accurately.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-9",
    number: "3.3 – 6.1 – 7.2",
    title: "Actively Monitoring Student Progress",
    description: "- Prepares for diverse student responses and uses them to enrich lessons. Use the Lesson Plan, Learning Objectives, and components to create follow-up prompts and questions.\n- Consistently monitors and adjusts teaching based on students’ responses and behavior to enhance learning.\n- Listens for correct pronunciation, enunciation, and use of words related to the Learning Objectives.\n- Provides timely, specific, and constructive feedback to help students improve accuracy and pronunciation.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-10",
    number: "7.1",
    title: "Asking targeted Questions",
    description: "Consistently asks purposeful questions that align with lesson objectives and engage all students.",
    hasPreComment: true,
    preComment: "You asked all questions in the lesson plan.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-11",
    number: "7.3",
    title: "Using Effective Transitions",
    description: "Uses transitions in the Lesson Plans or smoothly connects lesson components with purposeful transitions that reinforce objectives.",
    hasPreComment: true,
    preComment: "You conducted engaging transitions.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-12",
    number: "7.4 – 8.1",
    title: "Positive Presence and Participation",
    description: "- Utilizes gestures, expressions, and prompts to actively engage all students in lessons.\n- Builds on student responses.\n- Uses props students are interested in that relate to the target words and expressions.\n- Maintains a positive demeanor with engaging facial expressions, body language, and voice that foster a joyful classroom.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-13",
    number: "7.5",
    title: "Allowing Time for Student Responses",
    description: "Consistently provides appropriate wait time for students to think and respond using English.",
    hasPreComment: true,
    preComment: "You gave students enough time to think before inviting them to answer questions.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-14",
    number: "7.6",
    title: "Facilitatiing Peer Practice",
    description: "Regularly creates opportunities for students to practice speaking in pairs or small groups, fostering confidence and language use.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-15",
    number: "8.2",
    title: "Using Gestures and Props",
    description: "- Purposefully integrates gestures and props to enhance comprehension and retention.\n- Points at the pictures while saying the target word, purposefully connecting the word with the image.",
    hasPreComment: true,
    preComment: "You used gestures and props effectively, pointing precisely at the pictures and helping students understand the content better.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-16",
    number: "8.3",
    title: "Emphasizing Learning Objectives",
    description: "Consistently uses visual cues to reinforce lesson objectives (e.g., phonograms) and key vocabulary.",
    hasPreComment: false,
    preComment: undefined,
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-17",
    number: "8.4",
    title: "Modeling Proper Speech",
    description: "- Clearly models speech with correct grammar, intonation, and pronunciation, serving as an effective language role model.",
    hasPreComment: true,
    preComment: "All instructions and sample sentences were said accurately, making them great models for the students to learn from.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
  {
    id: "ind-18",
    number: "8.5",
    title: "Modeling Actions",
    description: "- Accurately models actions and movements that align with lesson content, enhancing comprehension and engagement.",
    hasPreComment: true,
    preComment: "All actions were modeled clearly, allowing students to understand and follow easily.",
    good: false,
    growth: false,
    commentText: "",
    strokes: [],
    favorite: false,  
  },
];