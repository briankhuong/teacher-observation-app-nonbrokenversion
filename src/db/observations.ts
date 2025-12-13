// src/db/observations.ts
import { supabase } from "../supabaseClient";

export type ObservationStatus = "draft" | "saved";

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
  meta: ObservationMeta;
  indicators: any[]; // your existing indicator shape
  observation_date: string | null;
  created_at: string;
  updated_at: string;
}

// Load one observation by id (for the current trainer, enforced by RLS)
export async function loadObservationFromDb(id: string) {
  const { data, error } = await supabase
    .from("observations")
    .select(
      "id, trainer_id, teacher_id, status, meta, indicators, observation_date, created_at, updated_at"
    )
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
export async function saveObservationToDb(args: {
  id: string;
  status: ObservationStatus;
  meta: ObservationMeta; // whatever your type is
  indicators: any[];
}) {
  const { id, status, meta, indicators } = args;

  // 1) Read existing meta first so we don't wipe workbook links
  const { data: existing, error: readErr } = await supabase
    .from("observations")
    .select("meta")
    .eq("id", id)
    .single();

  if (readErr) {
    console.error("[DB] saveObservationToDb read meta error", readErr);
    throw readErr;
  }

  const prevMeta: any = existing?.meta ?? {};
  const nextMeta: any = meta ?? {};

  // 2) Merge while preserving stable link fields + merge results
  const mergedMeta: any = {
    ...prevMeta,
    ...nextMeta,

    // ✅ preserve stable links if Workspace doesn't provide them
    teacherWorkbookUrl:
      nextMeta.teacherWorkbookUrl ?? prevMeta.teacherWorkbookUrl ?? null,
    adminWorkbookUrl:
      nextMeta.adminWorkbookUrl ?? prevMeta.adminWorkbookUrl ?? null,
    adminWorkbookViewUrl:
      nextMeta.adminWorkbookViewUrl ?? prevMeta.adminWorkbookViewUrl ?? null,

    // ✅ preserve merged sheet results too
    mergedTeacher:
      nextMeta.mergedTeacher ?? prevMeta.mergedTeacher ?? null,
    mergedAdmin:
      nextMeta.mergedAdmin ?? prevMeta.mergedAdmin ?? null,
  };

  // 3) Write merged meta
  const { error: writeErr } = await supabase
    .from("observations")
    .update({
      status,
      meta: mergedMeta,
      indicators,
      observation_date: mergedMeta.date ?? null,
    })
    .eq("id", id);

  if (writeErr) {
    console.error("[DB] saveObservationToDb error", writeErr);
    throw writeErr;
  }
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