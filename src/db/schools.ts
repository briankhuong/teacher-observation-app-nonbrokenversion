// src/db/schools.ts
import { supabase } from "../supabaseClient";

/**
 * Shape of one row in the `schools` table.
 * Matches the columns in your Supabase screenshot.
 */
export interface SchoolRow {
  id: string;
  trainer_id: string;
  school_name: string;
  campus_name: string;

  city: string | null;
  admin_name: string | null;
  admin_email: string | null;
  admin_phone: string | null;
  am_name: string | null;
  am_email: string | null;
  address: string | null;
  district: string | null;
  notes: string | null;

  /** Editable admin workbook link (full access) */
  admin_workbook_url: string | null;

  /** 🆕 View-only admin workbook link (for anonymous / email use) */
  admin_workbook_view_url: string | null;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Input when creating a school row.
 * Only the fields you actually set in the app are required;
 * everything else is optional and will default to null/true.
 */
export interface CreateSchoolInput {
  trainer_id: string;
  school_name: string;
  campus_name: string;

  city?: string | null;
  admin_name?: string | null;
  admin_email?: string | null;
  admin_phone?: string | null;
  am_name?: string | null;
  am_email?: string | null;
  address?: string | null;
  district?: string | null;
  notes?: string | null;

  admin_workbook_url?: string | null;
  admin_workbook_view_url?: string | null;
  is_active?: boolean;
}

/**
 * Patch for updating an existing school.
 * All fields are optional so existing callers
 * that only pass { school_name, campus_name } still work.
 */
export interface UpdateSchoolPatch {
  school_name?: string;
  campus_name?: string;

  city?: string | null;
  admin_name?: string | null;
  admin_email?: string | null;
  admin_phone?: string | null;
  am_name?: string | null;
  am_email?: string | null;
  address?: string | null;
  district?: string | null;
  notes?: string | null;

  admin_workbook_url?: string | null;
  /** 🆕 allow updating the view-only link */
  admin_workbook_view_url?: string | null;

  is_active?: boolean;
}

/**
 * Get all schools for the current trainer (one row per campus).
 */
export async function fetchSchoolsForTrainer(
  trainerId: string
): Promise<SchoolRow[]> {
  const { data, error } = await supabase
    .from("schools")
    .select(
      `
      id,
      trainer_id,
      school_name,
      campus_name,
      city,
      admin_name,
      admin_email,
      admin_phone,
      am_name,
      am_email,
      address,
      district,
      notes,
      admin_workbook_url,
      admin_workbook_view_url,
      is_active,
      created_at,
      updated_at
    `
    )
    .eq("trainer_id", trainerId)
    .order("school_name", { ascending: true })
    .order("campus_name", { ascending: true });

  if (error) {
    console.error("[DB] fetchSchoolsForTrainer error", error);
    throw error;
  }

  return (data as SchoolRow[]) ?? [];
}

/**
 * Create a new school row.
 * Existing usages that call createSchool({ trainer_id, school_name, campus_name })
 * still work because extra fields are optional.
 */
export async function createSchool(input: CreateSchoolInput): Promise<SchoolRow> {
  const { data, error } = await supabase
    .from("schools")
    .insert({
      trainer_id: input.trainer_id,
      school_name: input.school_name.trim(),
      campus_name: input.campus_name.trim(),

      city: input.city ?? null,
      admin_name: input.admin_name ?? null,
      admin_email: input.admin_email ?? null,
      admin_phone: input.admin_phone ?? null,
      am_name: input.am_name ?? null,
      am_email: input.am_email ?? null,
      address: input.address ?? null,
      district: input.district ?? null,
      notes: input.notes ?? null,

      admin_workbook_url: input.admin_workbook_url ?? null,
      admin_workbook_view_url: input.admin_workbook_view_url ?? null, // 🆕
      is_active: input.is_active ?? true,
    })
    .select(
      `
      id,
      trainer_id,
      school_name,
      campus_name,
      city,
      admin_name,
      admin_email,
      admin_phone,
      am_name,
      am_email,
      address,
      district,
      notes,
      admin_workbook_url,
      admin_workbook_view_url,
      is_active,
      created_at,
      updated_at
    `
    )
    .single();

  if (error) {
    console.error("[DB] createSchool error", error);
    throw error;
  }

  return data as SchoolRow;
}

/**
 * Update an existing school row.
 * Callers can update just name/campus, or also workbook links, etc.
 */
export async function updateSchool(
  id: string,
  patch: UpdateSchoolPatch
): Promise<SchoolRow> {
  const updates: Record<string, any> = {};

  if (patch.school_name !== undefined) {
    updates.school_name = patch.school_name.trim();
  }
  if (patch.campus_name !== undefined) {
    updates.campus_name = patch.campus_name.trim();
  }

  if (patch.city !== undefined) updates.city = patch.city;
  if (patch.admin_name !== undefined) updates.admin_name = patch.admin_name;
  if (patch.admin_email !== undefined) updates.admin_email = patch.admin_email;
  if (patch.admin_phone !== undefined) updates.admin_phone = patch.admin_phone;
  if (patch.am_name !== undefined) updates.am_name = patch.am_name;
  if (patch.am_email !== undefined) updates.am_email = patch.am_email;
  if (patch.address !== undefined) updates.address = patch.address;
  if (patch.district !== undefined) updates.district = patch.district;
  if (patch.notes !== undefined) updates.notes = patch.notes;

  if (patch.admin_workbook_url !== undefined) {
    updates.admin_workbook_url = patch.admin_workbook_url;
  }
  if (patch.admin_workbook_view_url !== undefined) {
    // 🆕 new view-only link
    updates.admin_workbook_view_url = patch.admin_workbook_view_url;
  }

  if (patch.is_active !== undefined) {
    updates.is_active = patch.is_active;
  }

  const { data, error } = await supabase
    .from("schools")
    .update(updates)
    .eq("id", id)
    .select(
      `
      id,
      trainer_id,
      school_name,
      campus_name,
      city,
      admin_name,
      admin_email,
      admin_phone,
      am_name,
      am_email,
      address,
      district,
      notes,
      admin_workbook_url,
      admin_workbook_view_url,
      is_active,
      created_at,
      updated_at
    `
    )
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
  const { error } = await supabase.from("schools").delete().eq("id", id);

  if (error) {
    console.error("[DB] deleteSchool error", error);
    throw error;
  }
}