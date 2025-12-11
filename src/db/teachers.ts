// src/db/teachers.ts
import { supabase } from "../supabaseClient"; // ⬅️ reuse shared client

export type TeacherRow = {
  id: string;
  trainer_id: string;
  name: string;
  email: string | null;
  school_name: string;
  campus: string;
  worksheet_url: string | null;
  created_at: string;
  updated_at: string;
};

export type NewTeacherInput = {
  name: string;
  email?: string;
  school_name: string;
  campus: string;
  worksheet_url?: string;
};

export type UpdateTeacherInput = {
  name?: string;
  email?: string | null;
  school_name?: string;
  campus?: string;
  worksheet_url?: string | null;
};

const TABLE = "teachers";

/**
 * Fetch all teachers for the current logged-in trainer.
 * RLS ensures you only see your own rows.
 */
export async function fetchTeachers(): Promise<TeacherRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("[DB] fetchTeachers error", error);
    throw error;
  }

  return (data as TeacherRow[]) ?? [];
}

/**
 * Create a new teacher for this trainer.
 */
export async function createTeacher(
  trainerId: string,
  input: NewTeacherInput
): Promise<TeacherRow> {
  const payload = {
    trainer_id: trainerId,
    name: input.name,
    email: input.email ?? null,
    school_name: input.school_name,
    campus: input.campus,
    worksheet_url: input.worksheet_url ?? null,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert([payload])
    .select("*")
    .single();

  if (error) {
    console.error("[DB] createTeacher error", error);
    throw error;
  }

  return data as TeacherRow;
}

/**
 * Update existing teacher (RLS ensures it belongs to this trainer).
 */
export async function updateTeacher(
  id: string,
  input: UpdateTeacherInput
): Promise<TeacherRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      ...input,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[DB] updateTeacher error", error);
    throw error;
  }

  return data as TeacherRow;
}

/**
 * Delete a teacher row.
 */
export async function deleteTeacher(id: string): Promise<void> {
  console.log("[DB] deleteTeacher called with id:", id);

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) {
    console.error("[DB] deleteTeacher error", error);
    throw error;
  }

  console.log("[DB] deleteTeacher success for id:", id);
}