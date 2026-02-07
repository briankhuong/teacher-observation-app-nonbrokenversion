// src/db/observations.ts
import { supabase } from "../supabaseClient";

export type ObservationStatus = "draft" | "saved";
export type PerformanceRating = "Developing" | "Functioning" | "Thriving" | null;

export interface ObservationMeta {
  teacherName: string;
  schoolName: string;
  campus: string;
  unit: string;
  lesson: string;
  supportType: "Training" | "LVA" | "Visit";
  date: string; // "YYYY-MM-DD"
}

export interface ObservationRecord {
  id: string;
  trainer_id: string;
  teacher_id: string | null;
  status: ObservationStatus;
  performance_rating: PerformanceRating;
  meta: ObservationMeta;
  indicators: any[]; // your existing indicator shape
  observation_date: string | null;
  created_at: string;
  updated_at: string;
  is_good?: boolean;
  is_bad?: boolean;
  is_favorite?: boolean;
  admin_summary_vn: string | null;
}

// Load one observation by id (for the current trainer, enforced by RLS)
export async function loadObservationFromDb(id: string) {
  const { data, error } = await supabase
    .from("observations")
    .select("id, trainer_id, teacher_id, status, performance_rating, meta, indicators, updated_at, admin_summary_vn")
    .eq("id", id)
    .single();

  if (error) {
    console.error("[DB] loadObservationFromDb error", error);
    throw error;
  }

  const row = data as any;

  return {
    id: row.id,
    trainer_id: row.trainer_id,
    teacher_id: row.teacher_id,
    status: (row.status ?? "draft") as ObservationStatus,
    meta: row.meta as ObservationMeta,
    indicators: (row.indicators ?? []) as any[],
    observation_date: row.observation_date as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    // RETURN THE NEW COLUMN HERE
    admin_summary_vn: row.admin_summary_vn as string | null,
  } as ObservationRecord;
}

// Save indicators + meta + status back to Supabase
// export async function saveObservationToDb(args: {
//   id: string;
//   status: ObservationStatus;
//   meta: ObservationMeta;
//   indicators: any[];
// }) {
//   const { id, status, meta, indicators } = args;

//   const { error } = await supabase
//     .from("observations")
//     .update({
//       status,
//       meta,
//       indicators,
//       observation_date: meta.date ?? null,
//     })
//     .eq("id", id);

//   if (error) {
//     console.error("[DB] saveObservationToDb error", error);
//     throw error;
//   }
// }

// Save indicators + meta + status back to Supabase
// src/db/observations.ts
// src/db/observations.ts

export async function saveObservationToDb(args: {
  id: string;
  status: ObservationStatus;
  meta: ObservationMeta;
  indicators: any[];
  updatedAt: number;
  lastSync: number; // 👈 NEW PARAMETER
}) {
  const { id, status, meta, indicators, updatedAt, lastSync } = args;

  // 1) Read Server Data
  const { data: serverRow, error: readErr } = await supabase
    .from("observations")
    .select("meta, updated_at")
    .eq("id", id)
    .single();

  if (readErr) {
    console.error("[DB] saveObservationToDb read error", readErr);
    throw readErr;
  }

  // 2) 🛡️ UPDATED CONFLICT CHECK
  // Compare Server Time vs. When YOU last saw the data (lastSync)
  const serverTime = serverRow.updated_at ? new Date(serverRow.updated_at).getTime() : 0;
  
  // Logic: If Server is > 2 seconds newer than your last sync, someone else touched it.
  if (serverTime > lastSync + 2000) {
    throw new Error("CONFLICT: Server has newer data. Please refresh.");
  }

  // 3) Write (Same as before)
  const prevMeta: any = serverRow?.meta ?? {};
  const nextMeta: any = meta ?? {};

  const mergedMeta: any = {
    ...prevMeta,
    ...nextMeta,
    teacherWorkbookUrl: nextMeta.teacherWorkbookUrl ?? prevMeta.teacherWorkbookUrl ?? null,
    adminWorkbookUrl: nextMeta.adminWorkbookUrl ?? prevMeta.adminWorkbookUrl ?? null,
    adminWorkbookViewUrl: nextMeta.adminWorkbookViewUrl ?? prevMeta.adminWorkbookViewUrl ?? null,
    mergedTeacher: nextMeta.mergedTeacher ?? prevMeta.mergedTeacher ?? null,
    mergedAdmin: nextMeta.mergedAdmin ?? prevMeta.mergedAdmin ?? null,
  };

  const { error: writeErr } = await supabase
    .from("observations")
    .update({
      status,
      meta: mergedMeta,
      indicators,
      observation_date: mergedMeta.date ?? null,
      updated_at: new Date(updatedAt).toISOString(),
    })
    .eq("id", id);

  if (writeErr) {
    console.error("[DB] saveObservationToDb error", writeErr);
    throw writeErr;
  }
}
/**
 * Saves only the single translated Admin Summary text to the observation row.
 */
/**
 * Saves only the single translated Admin Summary text to the observation row.
 */
/**
 * Saves only the single translated Admin Summary text to the observation row.
 */
export async function saveAdminSummaryToDb(
  id: string,
  adminSummaryVN: string | null | undefined
) {
  // 💡 FIX HERE: Convert Date.now() (milliseconds) to ISO 8601 string
  const currentTimestamp = new Date().toISOString(); 
  
  const { data, error } = await supabase 
    .from("observations")
    .update({
      admin_summary_vn: adminSummaryVN,
      // 💡 USE THE ISO STRING HERE
      updated_at: currentTimestamp, 
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[DB] saveAdminSummaryToDb error", error);
    throw error;
  }
  return data;
}

export async function updateObservationMetaLinks(opts: {
  id: string;
  teacherSheetUrl?: string;
  adminSheetUrl?: string;
}) {
  const { id, teacherSheetUrl, adminSheetUrl } = opts;

  // Fetch current meta
  const { data: row, error: fetchError } = await supabase
    .from("observations")
    .select("meta")
    .eq("id", id)
    .single();

  if (fetchError) {
    console.error("[DB] updateObservationMetaLinks fetch error", fetchError);
    throw fetchError;
  }

  const meta = (row?.meta ?? {}) as any;
  if (teacherSheetUrl !== undefined) {
    meta.teacherSheetUrl = teacherSheetUrl;
  }
  if (adminSheetUrl !== undefined) {
    meta.adminSheetUrl = adminSheetUrl;
  }

  const { error: updateError } = await supabase
    .from("observations")
    .update({ meta })
    .eq("id", id);

  if (updateError) {
    console.error("[DB] updateObservationMetaLinks update error", updateError);
    throw updateError;
  }

  return meta as typeof meta;
}


