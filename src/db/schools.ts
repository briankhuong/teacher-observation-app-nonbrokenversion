// src/db/schools.ts
import { supabase } from "../supabaseClient";

export interface SchoolRow {
  id: string;
  trainer_id: string;
  school_name: string;
  campus_name: string;
  created_at: string;
}

/**
 * Get all schools for the current trainer (one row per campus).
 */
export async function fetchSchoolsForTrainer(
  trainerId: string
): Promise<SchoolRow[]> {
  const { data, error } = await supabase
    .from("schools")
    .select("*")
    .eq("trainer_id", trainerId)
    .order("school_name", { ascending: true })
    .order("campus_name", { ascending: true });

  if (error) {
    console.error("[DB] fetchSchoolsForTrainer error", error);
    throw error;
  }

  return data ?? [];
}

/**
 * Create a new school row.
 */
export async function createSchool(input: {
  trainer_id: string;
  school_name: string;
  campus_name: string;
}): Promise<SchoolRow> {
  const { data, error } = await supabase
    .from("schools")
    .insert({
      trainer_id: input.trainer_id,
      school_name: input.school_name.trim(),
      campus_name: input.campus_name.trim(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("[DB] createSchool error", error);
    throw error;
  }

  return data as SchoolRow;
}

/**
 * Update name / campus for an existing school row.
 */
export async function updateSchool(id: string, patch: {
  school_name: string;
  campus_name: string;
}): Promise<SchoolRow> {
  const { data, error } = await supabase
    .from("schools")
    .update({
      school_name: patch.school_name.trim(),
      campus_name: patch.campus_name.trim(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[DB] updateSchool error", error);
    throw error;
  }

  return data as SchoolRow;
}

/**
 * Delete a school row.
 */
export async function deleteSchool(id: string): Promise<void> {
  const { error } = await supabase
    .from("schools")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[DB] deleteSchool error", error);
    throw error;
  }
}