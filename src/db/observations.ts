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
export async function saveObservationToDb(args: {
  id: string;
  status: ObservationStatus;
  meta: ObservationMeta;
  indicators: any[];
}) {
  const { id, status, meta, indicators } = args;

  const { error } = await supabase
    .from("observations")
    .update({
      status,
      meta,
      indicators,
      observation_date: meta.date ?? null,
    })
    .eq("id", id);

  if (error) {
    console.error("[DB] saveObservationToDb error", error);
    throw error;
  }
}