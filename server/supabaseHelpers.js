// server/supabaseHelpers.js
import dotenv from "dotenv";
dotenv.config({ path: ".env.azure" }); // ✅ load envs for server-side Supabase

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[server] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
  );
  // You can hard-fail if you prefer:
  // throw new Error("Missing Supabase admin environment variables");
}

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Load an observation with the key fields we care about
 * for merging into workbooks.
 */
export async function getObservationWithRelations(observationId) {
  const { data, error } = await supabaseAdmin
    .from("observations")
    .select(
      `
      id,
      trainer_id,
      teacher_id,
      teacher_name,
      school_name,
      campus,
      unit,
      lesson,
      support_type,
      observation_date,
      teacher_workbook_url,
      admin_workbook_url,
      meta,
      indicators
    `
    )
    .eq("id", observationId)
    .single();

  if (error) {
    console.error("[server] getObservationWithRelations error", error);
    throw error;
  }

  return data;
}

/**
 * Update workbook-related links on an observation after a merge.
 *
 * mergeRoutes.js calls this as a named export. We accept a generic payload
 * so we won't break even if the caller passes extra fields.
 *
 * Example payload:
 * {
 *   observationId: "uuid",
 *   teacherWorkbookUrl?: "https://...",
 *   adminWorkbookUrl?: "https://..."
 * }
 */
export async function updateObservationMetaLinks(payload) {
  const {
    observationId,
    teacherWorkbookUrl,
    adminWorkbookUrl,
    // extra props are ignored
  } = payload || {};

  if (!observationId) {
    console.warn(
      "[server] updateObservationMetaLinks called without observationId"
    );
    return null;
  }

  const patch = {};

  if (typeof teacherWorkbookUrl === "string") {
    patch.teacher_workbook_url = teacherWorkbookUrl;
  }

  if (typeof adminWorkbookUrl === "string") {
    patch.admin_workbook_url = adminWorkbookUrl;
  }

  if (Object.keys(patch).length === 0) {
    // nothing to update
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("observations")
    .update(patch)
    .eq("id", observationId)
    .select("id, teacher_workbook_url, admin_workbook_url")
    .single();

  if (error) {
    console.error("[server] updateObservationMetaLinks error", error);
    throw error;
  }

  return data;
}

/**
 * Update the *view-only* workbook URL on a school.
 *
 * We make the signature flexible so mergeRoutes.js can call it either as:
 *   updateSchoolViewOnlyUrl(schoolId, viewUrl)
 * or:
 *   updateSchoolViewOnlyUrl({ schoolId, viewOnlyUrl })
 */
export async function updateSchoolViewOnlyUrl(arg1, arg2) {
  let schoolId;
  let viewOnlyUrl;

  if (typeof arg1 === "object" && arg1 !== null) {
    schoolId = arg1.schoolId || arg1.id;
    viewOnlyUrl =
      arg1.viewOnlyUrl || arg1.adminWorkbookViewUrl || arg1.url || null;
  } else {
    schoolId = arg1;
    viewOnlyUrl = arg2;
  }

  if (!schoolId) {
    console.warn(
      "[server] updateSchoolViewOnlyUrl called without schoolId",
      arg1
    );
    return null;
  }

  if (!viewOnlyUrl) {
    console.warn(
      "[server] updateSchoolViewOnlyUrl called without viewOnlyUrl",
      arg1
    );
    return null;
  }

  // 🔑 This assumes your Supabase column is named:
  //     admin_workbook_view_url
  // (from our earlier plan in Stage 2)
  const { data, error } = await supabaseAdmin
    .from("schools")
    .update({ admin_workbook_view_url: viewOnlyUrl })
    .eq("id", schoolId)
    .select("id, admin_workbook_view_url")
    .single();

  if (error) {
    console.error("[server] updateSchoolViewOnlyUrl error", error);
    throw error;
  }

  return data;
}