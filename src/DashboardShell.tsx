// src/DashboardShell.tsx
import React, { useState, useCallback } from "react";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./supabaseClient";
// import { ObservationCard } from "./components/ObservationCard"; // Unused in this file, commenting out
import {
  buildTeacherExportModel,
  type ObservationMetaForExport,
  type IndicatorStateForExport,
} from "./exportTeacherModel";
import { getGraphAccessToken } from "./msal/getGraphToken";
import { buildAdminExportModel } from "./exportAdminModel";
import { EmailComposeModal, type EmailMode } from "./components/EmailComposeModal";
import { buildTeacherPreCallHtml } from "./emailTemplates/teacherPreCall";
import { buildTeacherPostCallHtml } from "./emailTemplates/teacherPostCall";
import { buildAdminUpdateHtml } from "./emailTemplates/adminUpdate";
import { buildAdminUpdateBulkHtml } from "./emailTemplates/adminUpdateBulk";
// Update the import to include the Admin function
import { clientMergeTeacherSheet, clientMergeAdminSheet } from './utils/clientExcelMerge';
import { EditObservationModal } from './components/EditObservationModal';
// Import the IndexedDB tools
import { get, set } from 'idb-keyval';
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { ConflictResolutionModal } from "./components/ConflictResolutionModal";
import { loadObservationFromDb, saveObservationToDb } from "./db/observations";

// ✅ CORRECT (Matches your screenshots & Vercel settings)
const MERGE_SERVER_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const SUMMARY_STATE_KEY = "obs-am-summary-v1";
const STORAGE_PREFIX = "obs-v1-";

type StatusColor = "good" | "mixed" | "growth";
type GroupMode = "none" | "month" | "school" | "campus";
type SortMode = "newest" | "oldest" | "teacher-az" | "teacher-za";

export interface DashboardObservationRow {
  id: string;
  teacherName: string;
  schoolName: string;
  campus: string;
  unit: string;
  lesson: string;
  supportType: string;
  dateLabel: string;
  isoDate: string | null;
  rawDate: number | null;
  status: "draft" | "saved";
  progress: number;
  totalIndicators: number;
  statusColor: StatusColor; // Assumes you have this type defined elsewhere
  teacherWorkbookUrl: string | null;
  adminWorkbookUrl: string | null;
  adminViewOnlyUrl: string | null;
  admin_summary_vn: string | null;
  meta: any;
  updatedAt?: number;
  lastSync?: number;
  syncStatus?: string;
}

type RecentMergePanel =
  | null
  | {
      obsId: string;
      kind: "teacher" | "admin";
      sheetUrl: string;
      sheetName: string;
      mergedAt: string; // ISO
    };

interface DashboardProps {
  onOpenObservation: (obs: {
    id: string;
    teacherName: string;
    schoolName: string;
    campus: string;
    unit: string;
    lesson: string;
    supportType: "Training" | "LVA" | "Visit";
    date: string;
  }) => void;
}

/* ------------------------------
   SCHOOL → AM MAPPING
--------------------------------- */

interface SchoolInfo {
  schoolName: string;
  campus: string;
  amName: string;
  amEmail: string;
}

const SCHOOL_DIRECTORY: SchoolInfo[] = [
  { schoolName: "19/5", campus: "Tứ Hiệp", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Ánh Trăng", campus: "Yên Xá", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Brik English Academy", campus: "Đông Hương", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Em bé hạnh phúc", campus: "Tây Nam Linh Đàm", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Green Tree House", campus: "Cơ sở 1", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Hoa Mặt Trời", campus: "Dịch Vọng", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "IQ Linh Dam", campus: "Tay Nam Linh Dam", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Kids House", campus: "Tây Mỗ", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Mầm Non Hạnh Phúc", campus: "Mầm Non Hạnh Phúc", amName: "Ginny", amEmail: "ginny.huynh@grapeseed.com" },
  { schoolName: "Mastermind", campus: "Hồ Tùng Mậu", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Mặt trời bé thơ", campus: "Minh Khai", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Mat Troi Xanh Bac Ninh", campus: "Bac Ninh 1", amName: "Sandra", amEmail: "sandra.le@grapeseed.com" },
  { schoolName: "Mi Mi", campus: "Resco Phạm Văn Đồng", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "MN AMG", campus: "AMG Vinhomes Gardenia", amName: "Bethany", amEmail: "Bethany.khuat@grapeseed.com" },
  { schoolName: "MN Bông Mai", campus: "25 Tân Mai", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "MN Bông Mai", campus: "BM GrapeSEED", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "MN Bông Mai", campus: "STEAMe GARTEN 360 Giải Phóng", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "MN Hà Nội", campus: "Nam Thăng Long", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "MN Hoa Hồng", campus: "Mễ Trì Thượng", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "MN Làng Hạnh Phúc", campus: "Nam Từ Liêm", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "MN Những cánh diều bay", campus: "FK Minh Khai", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "MN Nụ cười bé thơ 1", campus: "Ngoại Giao Đoàn", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "MN Nụ cười trẻ thơ", campus: "kidssmile Hoàng Quốc Việt", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "MN Quốc Tế Việt Ý", campus: "Việt Ý An Hưng", amName: "Sandra", amEmail: "sandra.le@grapeseed.com" },
  { schoolName: "MN Tài Năng Nhí", campus: "TT1B Tây Nam Linh Đàm", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "MN Vườn Trí Tuệ", campus: "30 Lý Nam Đế", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Nắng Xuân", campus: "Đại Mỗ", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Ngôi nhà cây xanh", campus: "Đại Mỗ", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Nguồn Sáng", campus: "Mộ Lao", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Nhà Hát Nhỏ Hà Nội", campus: "NewDay Mon", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Nụ cười trẻ thơ 2", campus: "Ngoại Giao Đoàn", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Peakland", campus: "Anh Nhật", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Peakland", campus: "Peakland Preschool", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Peakland", campus: "Song Nhue", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Peakland", campus: "Star Montessori Preschool", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Peakland", campus: "Vinsmart GrapeSEED", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Phuong Hong", campus: "HH2E Duong Noi", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Sắc màu", campus: "Ngụy Như Kon Tum", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Sao Hà Nội", campus: "CASA_60 Nguyễn Đức Cảnh", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Sao Hà Nội", campus: "HN little star Minh Khai", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Sao Hà Nội", campus: "KIDS GARDEN_151 Nguyễn Đức Cảnh", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Sao Hà Nội", campus: "Ngoại Giao Đoàn Offline", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Sao Hà Nội", campus: "Ngoại Giao Đoàn_Online", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Trăng Đỏ", campus: "Cầu Giấy", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Trung tâm Ngoại ngữ Ishine", campus: "TT Ngoại ngữ Ishine", amName: "Selena", amEmail: "selena.tran@grapeseed.com" },
  { schoolName: "TTNN Oscar", campus: "Green Park", amName: "Claire", amEmail: "claire.pham@grapeseed.com" },
  { schoolName: "Tuổi Thần Tiên", campus: "KĐT Đại Thanh", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Tuổi Thần Tiên", campus: "Văn Điển", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "Tuổi Thơ Tài Năng", campus: "Tôn Đức Thắng", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Tuổi Thơ Tài Năng", campus: "Việt Hưng - CS 3", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Viet Han", campus: "KĐT Kim Văn", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Việt Hàn (Kim Giang)", campus: "Hoàng Đạo Thành", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "Việt Hàn (Kim Giang)", campus: "Online", amName: "Emma", amEmail: "emma.swanepoel@grapeseed.com" },
  { schoolName: "VSK", campus: "158 Võ Chí Công", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
  { schoolName: "VSK Sunshine", campus: "Cổ Nhuế", amName: "Vivian", amEmail: "vivian.pham@grapeseed.com" },
];

function findSchoolInfo(
  schoolName: string,
  campus: string
): SchoolInfo | null {
  return (
    SCHOOL_DIRECTORY.find(
      (s) =>
        s.schoolName === schoolName &&
        s.campus === campus
    ) ?? null
  );
}

function amKeyFromSchool(info: SchoolInfo): string {
  return `${info.amEmail}|${info.amName}`;
}

function parseAmKey(key: string): { email: string; name: string } {
  const [email, name] = key.split("|");
  return { email, name };
}

/* ------------------------------
   AM SUMMARY TYPES
--------------------------------- */

type SummaryStatus = "none" | "green" | "red";

// Add adminSummaryVn here
export interface AmSummaryRow {
  schoolName: string;
  campus: string;
  teacherName: string;
  status: "green" | "red" | "none"; // Or 'SummaryStatus' if you have that type defined
  nextSteps: string;
  adminSummaryVn?: string | null; // <--- ADD THIS LINE
}

type AmSummarySentMap = Record<string, number>; // key = `${amKey}::${monthKey}`

/* ------------------------------
   DATE HELPERS
--------------------------------- */

// Parse "YYYY-MM-DD" or similar into timestamp
function safeParseTimestamp(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// Month key for internal calculations
function monthKeyFromTs(ts: number | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  return `${String(m).padStart(2, "0")}.${y}`; // e.g. "11.2025"
}

/* ------------------------------
   META PERSISTENCE HELPER
--------------------------------- */
// src/DashboardShell.tsx

async function persistMergedLinkToObservationMeta(obsId: string, patch: any) {
  let nextMeta: any = {};

  // 1. Try to read from LocalStorage first
  const key = `${STORAGE_PREFIX}${obsId}`;
  const rawLocal = localStorage.getItem(key);

  if (rawLocal) {
    // Case A: We have local data. Update it.
    const parsed = JSON.parse(rawLocal);
    parsed.meta = { ...(parsed.meta || {}), ...patch };
    nextMeta = parsed.meta;
    localStorage.setItem(key, JSON.stringify(parsed));
  } else {
    // Case B: No local data? Fetch from DB so we don't crash.
    // This prevents the "disappearing badge" bug on fresh loads.
    const { data, error } = await supabase
      .from("observations")
      .select("id, status, meta, indicators, created_at, updated_at, observation_date, admin_summary_vn")
      .eq("id", obsId)
      .single();

    if (!error && data) {
      nextMeta = { ...(data.meta || {}), ...patch };
      // We don't necessarily need to write to localStorage here if the user hasn't opened it,
      // but we MUST have the 'nextMeta' to save to the DB below.
    } else {
      console.error("[persistMerged] Could not find obs to update:", obsId);
      return {}; // Fail safe
    }
  }

  // 2. Save to Supabase (The Source of Truth)
  // We use a simplified update here to ensure the patch sticks.
  // Note: We need to merge the new patch with the EXISTING DB meta to be safe,
  // but since 'nextMeta' above is built from (Local OR DB) + Patch, we are good.
  try {
    const { error } = await supabase
      .from("observations")
      .update({ meta: nextMeta })
      .eq("id", obsId);

    if (error) throw error;
    console.log("[persistMerged] Saved to DB:", patch);
  } catch (e) {
    console.error("[persistMerged] Supabase update failed", e);
    alert("Warning: Could not save status to database. Check internet connection.");
  }

  return nextMeta;
}

/* ------------------------------
   GROUPING HELPERS
--------------------------------- */
function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string
) {
  const buckets: Record<string, T[]> = {};
  items.forEach((item) => {
    const key = keyFn(item);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });

  return Object.entries(buckets).map(([key, list]) => ({
    key,
    label: key,
    items: list,
  }));
}

// ------------------------------
// SHEET NAME HELPERS
// ------------------------------
function excelSafeSheetName(input: string): string {
  const cleaned = String(input || "")
    .replace(/[:\\\/\?\*\[\]]/g, " ") // illegal chars
    .replace(/\s+/g, " ")
    .trim();

  const nonEmpty = cleaned.length > 0 ? cleaned : "Sheet";
  return nonEmpty.slice(0, 31);
}

function monthYearFromDate(dateStr?: string | null): string {
  if (!dateStr) return "00.0000";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "00.0000";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}.${year}`; // "12.2025"
}

/** TEACHER: "MM.YYYY" */
function buildTeacherSheetName(obs: DashboardObservationRow): string {
  const dateStr =
    (obs as any).meta?.date ||
    obs.isoDate ||
    null;

  return excelSafeSheetName(monthYearFromDate(dateStr));
}

/** ADMIN: "TeacherName MM.YYYY SupportType" */
function buildAdminSheetName(obs: DashboardObservationRow): string {
  const teacherName = String((obs as any).meta?.teacherName || obs.teacherName || "Teacher").trim();

  const rawSupport = String((obs as any).meta?.supportType || obs.supportType || "Visit").trim();
  const supportType =
    rawSupport === "Training" || rawSupport === "LVA" || rawSupport === "Visit"
      ? rawSupport
      : "Visit";

  const dateStr =
    (obs as any).meta?.date ||
    obs.isoDate ||
    null;

  const base = `${teacherName} ${monthYearFromDate(dateStr)} ${supportType}`;
  return excelSafeSheetName(base);
}

/* ------------------------------
   DATA LOAD HELPERS
--------------------------------- */
function readMetaFromLocalStorage(obsId: string): any | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${obsId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.meta ?? null;
  } catch {
    return null;
  }
}

function getStableMetaForRow(obs: DashboardObservationRow): any {
  // prefer row meta, fallback to localStorage meta (survives reload)
  return (obs as any).meta || readMetaFromLocalStorage(obs.id) || {};
}

function loadFullObservation(observationId: string): any | null {
  const key = `obs-v1-${observationId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeIndicators(full: any): any[] {
  const ind = full?.indicators;
  if (Array.isArray(ind)) return ind;
  if (Array.isArray(ind?.indicators)) return ind.indicators;
  return [];
}

function toMetaForExport(
  full: any,
  obs: DashboardObservationRow
): ObservationMetaForExport {
  const m = full?.meta || {};
  const rawSupport = (m.supportType || obs.supportType || "Visit") as any;
  const supportType =
    rawSupport === "Training" || rawSupport === "LVA" || rawSupport === "Visit"
      ? rawSupport
      : "Visit";

  return {
    teacherName: m.teacherName || obs.teacherName || "",
    schoolName: m.schoolName || obs.schoolName || "",
    campus: m.campus || obs.campus || "",
    unit: m.unit || obs.unit || "",
    lesson: m.lesson || obs.lesson || "",
    supportType,
    date: m.date || obs.isoDate || undefined,
  };
}

function toIndicatorsForExport(full: any): IndicatorStateForExport[] {
  const list = normalizeIndicators(full);

  return list.map((i: any) => ({
    id: String(i.id || ""),
    number: String(i.number || ""),
    title: String(i.title || ""),
    description: String(i.description || ""),
    good: !!i.good,
    growth: !!i.growth,
    commentText: String(i.commentText || ""),
    includeInTrainerSummary: i.includeInTrainerSummary === true,
  }));
}


function cleanTextForAdmin(text: string) {
  if (!text) return "";
  return text
    .split('\n') // Split into lines
    .map(line => {
      let clean = line.trim();
      // Remove (GA) (case insensitive)
      if (clean.toUpperCase().startsWith("(GA)")) {
        clean = clean.substring(4).trim(); 
      }
      // Remove Hyphen
      else if (clean.startsWith("-")) {
        clean = clean.substring(1).trim();
      }
      return clean;
    })
    .filter(Boolean) // Remove empty lines
    .join('\n'); // Join back together
}
// ✅ NEW: Helper to bulk-fetch defaults for a list of observations
async function enrichObservationsWithDefaults(rawObs: DashboardObservationRow[]) {
  if (rawObs.length === 0) return rawObs;

  // 1. Collect unique keys to query
  const schoolNames = [...new Set(rawObs.map(o => o.schoolName).filter(Boolean))];
  const teacherNames = [...new Set(rawObs.map(o => o.teacherName).filter(Boolean))];

  // 2. Bulk Fetch Schools (for Admin Workbooks)
  let schoolMap = new Map<string, { adminUrl: string; viewUrl: string }>();
  if (schoolNames.length > 0) {
    const { data: schools } = await supabase
      .from("schools")
      .select("school_name, admin_workbook_url, admin_workbook_view_url")
      .in("school_name", schoolNames);
    
    schools?.forEach((s: any) => {
      schoolMap.set(s.school_name, {
        adminUrl: s.admin_workbook_url,
        viewUrl: s.admin_workbook_view_url
      });
    });
  }

  // 3. Bulk Fetch Teachers (for Teacher Workbooks)
  let teacherMap = new Map<string, string>(); 
  if (teacherNames.length > 0) {
    const { data: teachers } = await supabase
      .from("teachers")
      .select("name, school_name, worksheet_url")
      .in("name", teacherNames);

    teachers?.forEach((t: any) => {
      // Create a unique key: "TeacherName|SchoolName" to avoid collisions
      const key = `${t.name}|${t.school_name}`; 
      teacherMap.set(key, t.worksheet_url);
    });
  }

  // 4. Merge Defaults into Observation Objects
  return rawObs.map(obs => {
    const sDefaults = schoolMap.get(obs.schoolName);
    const tKey = `${obs.teacherName}|${obs.schoolName}`;
    const tDefaultUrl = teacherMap.get(tKey);

    // Logic: Use existing Meta/Row value -> OR fallback to Default Table value -> OR null
    const finalTeacherUrl = 
      (obs as any).teacherWorkbookUrl ||
      obs.meta?.teacherWorkbookUrl || 
      tDefaultUrl || 
      null;

    const finalAdminUrl = 
      (obs as any).adminWorkbookUrl ||
      obs.meta?.adminWorkbookUrl || 
      sDefaults?.adminUrl || 
      null;

    const finalViewUrl = 
      (obs as any).adminViewOnlyUrl ||
      obs.meta?.adminWorkbookViewUrl || 
      sDefaults?.viewUrl || 
      null;

    // Return new object with enriched fields attached to top-level and meta
    return {
      ...obs,
      teacherWorkbookUrl: finalTeacherUrl,
      adminWorkbookUrl: finalAdminUrl,
      adminViewOnlyUrl: finalViewUrl,
      meta: {
        ...obs.meta,
        teacherWorkbookUrl: finalTeacherUrl,
        adminWorkbookUrl: finalAdminUrl,
        adminWorkbookViewUrl: finalViewUrl,
      }
    };
  });
}

/* ------------------------------
   COMPONENT
--------------------------------- */
export const DashboardShell: React.FC<DashboardProps> = ({
  onOpenObservation,
}) => {
  const { user } = useAuth();
  const trainerName = 
    user?.user_metadata?.full_name || 
    user?.user_metadata?.name || 
    user?.user_metadata?.display_name ||
    (user?.email ? user.email.split('@')[0] : "GrapeSEED Trainer");

  const [observations, setObservations] =
    useState<DashboardObservationRow[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>("month");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [searchText, setSearchText] = useState("");
  const [recentMergePanel, setRecentMergePanel] =
   useState<RecentMergePanel>(null);
// NEW: State for tracking Merge process status (Add these two lines)
const [mergingTeacherId, setMergingTeacherId] = useState<string | null>(null);
const [mergingAdminId, setMergingAdminId] = useState<string | null>(null);

const [isConflictModalOpen, setIsConflictModalOpen] = React.useState(false);
const [conflictLocalData, setConflictLocalData] = React.useState<any>(null);
const [conflictServerData, setConflictServerData] = React.useState<any>(null);

  // NEW: State for Edit Observation Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingObservation, setEditingObservation] = useState<DashboardObservationRow | null>(null);

  // NEW: central modal state for Teacher/Admin actions
  const [actionModal, setActionModal] = useState<{
    obsId: string;
    role: "teacher" | "admin";
  } | null>(null);

  // NEW: which groups are expanded (key = group.key)
  const [expandedGroups, setExpandedGroups] = useState<
    Record<string, boolean>
  >({});

  // AM summary UI state
  const [showAmSummary, setShowAmSummary] = useState(false);
  const [summaryMonth, setSummaryMonth] = useState<string>("");
  const [summaryAmKey, setSummaryAmKey] = useState<string>("");
  const [summaryRows, setSummaryRows] = useState<AmSummaryRow[]>([]);
  const [amSummarySentMap, setAmSummarySentMap] =
    useState<AmSummarySentMap>({});

    

  // --- EMAIL MODAL STATE ---
  const [emailModalState, setEmailModalState] = useState<{
    isOpen: boolean;
    mode: EmailMode;
    emailType: "pre" | "post" | "admin" | "am" | null;
    obsId?: string;     // Single ID
    obsIds?: string[];  // <--- ✅ ADD THIS (Plural)
    to: string[];
    cc: string[];
    subject: string;
    bodyHtml?: string;
    sandwichData?: { intro: string; tableHtml: string; outro: string };
  }>({
    isOpen: false,
    mode: "simple",
    emailType: null,
    obsId: undefined,
    to: [],
    cc: [],
    subject: "",
  });
  // Fetch helpers for email
  const fetchTeacherEmail = async (teacherName: string, schoolName: string) => {
    const { data } = await supabase
      .from("teachers")
      .select("email")
      .eq("name", teacherName)
      .eq("school_name", schoolName)
      .limit(1);
    return data?.[0]?.email || "";
  };

  const fetchSchoolEmails = async (schoolName: string, campus: string) => {
    const { data } = await supabase
      .from("schools")
      .select("admin_email, am_email")
      .eq("school_name", schoolName)
      .eq("campus_name", campus)
      .limit(1);
   return { 
    adminEmail: data?.[0]?.admin_email || "",
    amEmail: data?.[0]?.am_email || "" 
  };
  };



  const handlePush = async (id: string, overrideData?: any, force: boolean = false) => {
    try {
      console.log(`☁️ Attempting Smart Sync for: ${id} (Force: ${force})`);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("You must be logged in to sync.");
        return;
      }

      // 1. LOAD DATA (The Robust Way)
      // If we have override data (from modal), use it.
      // If not, try to get from IndexedDB (the Vault).
      let localData = overrideData;
      if (!localData) {
         const storageKey = `${STORAGE_PREFIX}${id}`;
         localData = await get(storageKey);
      }
      
      // 🟢 SMARTER LOGIC: If no local data exists, it means the user hasn't edited anything yet.
      // We shouldn't error out. We should just treat it as "Already Synced".
      if (!localData) {
        console.log("No local changes found. Fetching latest from server to verify...");
        // Just refresh the list to ensure UI is up to date (this runs the !parsed logic we fixed)
        window.location.reload(); 
        return;
      }

      // 2. CHECK FOR CONFLICTS (Unless Forced)
      if (!force) {
        const { data: serverRows } = await supabase
          .from("observations")
          .select("updated_at, teacher_name, school_name, indicators") 
          .eq("id", id);

        const serverRow = serverRows?.[0];
        
        if (serverRow) {
          const serverTime = new Date(serverRow.updated_at).getTime();
          // Safety: ensure lastSync exists, default to 0
          const localLastSync = localData.lastSync || 0;

          // 🛑 CONFLICT LOGIC:
          // Only show modal if Server is Newer AND we are trying to push older/different data
          // (Simple check: Server Time > Local Receipt Time)
          if (serverTime > localLastSync) {
             console.log("⚔️ Conflict Detected! Server is newer.");
             setConflictLocalData(localData);
             setConflictServerData(serverRow);
             setIsConflictModalOpen(true);
             return; // <--- STOP HERE. Modal takes over.
          }
        }
      } else {
        console.log("🛡️ Force Push enabled. Skipping server conflict check.");
      }

      // 3. PUSH TO SERVER
      console.log("🚀 No conflict. Pushing data...");
      
      // Construct Meta Safely to prevent DB errors
      const safeMeta = localData.meta || {
        teacherName: localData.teacherName || "",
        schoolName: localData.schoolName || "",
        campus: localData.campus || "",
        unit: localData.unit || "",
        lesson: localData.lesson || "",
        supportType: localData.supportType || "Visit",
        date: localData.date || new Date().toISOString()
      };
      
      const payload = {
        id: localData.id,
        trainer_id: user.id, 
        
        teacher_name: safeMeta.teacherName,
        school_name: safeMeta.schoolName,
        campus: safeMeta.campus,
        unit: safeMeta.unit,
        lesson: safeMeta.lesson,
        support_type: safeMeta.supportType,
        observation_date: safeMeta.date,

        meta: safeMeta,

        indicators: localData.indicators,
        status: localData.status,
        updated_at: new Date(localData.updatedAt || Date.now()).toISOString(),
        admin_summary_vn: localData.adminSummaryVN,
      };

      const { error } = await supabase.from("observations").upsert(payload);
      
      if (error) {
        console.error("Supabase Error Details:", error);
        throw error;
      }

      // 4. STAMP RECEIPT
      // 🟢 FIX: Update the local storage so it knows we are now 100% in sync
      const now = Date.now();
      const storageKey = `${STORAGE_PREFIX}${localData.id}`;
      const finalPayload = {
        ...localData,
        lastSync: now // <--- THE IMPORTANT PART
      };
      
      await set(storageKey, finalPayload);

      // 5. UPDATE UI INSTANTLY
      // @ts-ignore
      setObservations(prev => prev.map(obs => {
        if (obs.id === id) {
          return { 
            ...obs, 
            lastSync: now, 
            syncStatus: 'synced',
            updatedAt: localData.updatedAt 
          };
        }
        return obs;
      }));

      console.log("✅ Sync Complete!");

    } catch (err: any) {
      console.error("Sync failed:", err);
      alert("Sync failed: " + err.message);
    }
  };

const handleConflictResolved = async (mergedData: any) => {
    try {
      console.log("💾 Saving resolved data & Force Pushing...", mergedData);
      
      // 1. Save to Disk
      // 🟢 FIX: Ensure we write to the correct key
      const storageKey = `${STORAGE_PREFIX}${mergedData.id}`;
      await set(storageKey, mergedData);
      
      // 2. Close Modal
      setIsConflictModalOpen(false);

      // 3. 🟢 FORCE PUSH
      // Pass 'true' as the 3rd argument to skip the conflict check
      // because we JUST resolved the conflict!
      await handlePush(mergedData.id, mergedData, true);
      
    } catch (err) {
      console.error("❌ Failed to save resolved conflict:", err);
      alert("Error saving your changes. Please try again.");
    }
  };

  // 🟢 NEW: The Manual Pull Action
  const handlePull = async (obsId: string) => {
    // 1. Safety Check (Basic for Phase 3)
    // In Phase 4, this will open the "Visual Diff" modal instead.
    const confirm = window.confirm(
      "⚠️ Warning: This will overwrite your local copy with the version from the server.\n\nAre you sure?"
    );
    if (!confirm) return;

    try {
      console.log(`⬇️ Pulling observation ${obsId}...`);

      // 2. Fetch FULL data from Supabase
      const { data, error } = await supabase
        .from("observations")
        .select("*") // Get everything (indicators, meta, etc)
        .eq("id", obsId)
        .single();

      if (error) throw error;
      if (!data) throw new Error("Observation not found on server.");

      // 3. Update the Vault (IndexedDB)
      const storageKey = `${STORAGE_PREFIX}${obsId}`;
      
      // We explicitly set updatedAt to match the server so it shows as "Synced"
      const serverTime = new Date(data.updated_at).getTime();
      const payload = {
        ...data,
        updatedAt: serverTime, 
        lastSync: serverTime // Important: Mark as synced
      };

      await set(storageKey, payload);
      
      console.log("✅ Pull complete.");
      window.location.reload(); // Refresh to show new data

    } catch (err) {
      console.error("Pull failed:", err);
      alert("Could not download update. Check connection.");
    }
  };

React.useEffect(() => {
    if (!user) {
      setObservations([]);
      return;
    }

    const load = async () => {
      let dbData: any[] = [];
      
      // 🟢 PHASE 1: FETCH DATA (Network First -> IndexedDB Fallback)
      try {
        const { data, error } = await supabase
          .from("observations")
          .select(
            "id, status, meta, indicators, created_at, updated_at, observation_date, admin_summary_vn"
          )
          .eq("trainer_id", user.id)
          .order("observation_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (error) throw error;

        // ✅ SUCCESS: Save fresh data to "IndexedDB Vault"
        dbData = data ?? [];
        
        // Save list to Vault (Non-blocking)
        set("dashboard_backup_list", dbData).catch(err => 
          console.warn("Failed to save dashboard backup", err)
        );
        
      } catch (err) {
        // ❌ FAIL: Network Error? Load from "IndexedDB Vault"
        console.warn("[Dashboard] Offline mode detected. Loading backup...", err);
        
        try {
          const backup = await get<any[]>("dashboard_backup_list");
          if (backup) {
            console.log("📂 Loaded dashboard from IndexedDB");
            dbData = backup;
          } else {
            console.error("[Dashboard] No offline backup found.");
            // Fallback to localStorage (Migration support)
            const oldBackup = localStorage.getItem("dashboard_backup_list");
            if (oldBackup) dbData = JSON.parse(oldBackup);
          }
        } catch (readErr) {
          console.error("Failed to read from IndexedDB", readErr);
        }
      }

      // 🟢 PHASE 2: PROCESS ROWS (Merge with Local Edits)
      const rows: DashboardObservationRow[] = [];

      try {
        // Loop through every observation to check for local changes
        for (const dbRow of dbData) {
          const storageKey = `${STORAGE_PREFIX}${dbRow.id}`;
          let parsed: any = null;
          
          try {
            // Check IndexedDB for the specific observation data
            const localDraft = await get<any>(storageKey);
            
            if (localDraft) {
               parsed = localDraft;
            } else {
               // Fallback: Check localStorage
               const rawLocal = localStorage.getItem(storageKey);
               if (rawLocal) parsed = JSON.parse(rawLocal);
            }
          } catch (err) {
            console.error("Error parsing local data", err);
          }

          // If no local data exists, create a default object from DB data
          // If no local data exists, create a default object from DB data
          if (!parsed) {
            // 1. Calculate the Server Time first
            const dbTime = dbRow.updated_at
                ? new Date(dbRow.updated_at).getTime()
                : dbRow.created_at
                ? new Date(dbRow.created_at).getTime()
                : Date.now();

            parsed = {
              id: dbRow.id,
              meta: dbRow.meta ?? {},
              indicators: dbRow.indicators ?? [],
              status: dbRow.status ?? "draft",
              
              // 2. Set BOTH timestamps to the Server Time.
              // This tells the UI: "We are perfectly in sync with the server."
              updatedAt: dbTime,
              lastSync: dbTime, 
            };
          }

          // --- 🟢 SYNC STATUS LOGIC (Traffic Light) ---
          const localUpdatedAt = parsed.updatedAt || 0;
          const dbUpdatedAt = dbRow.updated_at ? new Date(dbRow.updated_at).getTime() : 0;
          
          let syncStatus: 'synced' | 'local-changes' | 'server-newer' | 'conflict' = 'synced';
          const BUFFER = 2000; // 2-second buffer for clock differences

          if (localUpdatedAt > dbUpdatedAt + BUFFER) {
             // ⬆️ Local is newer -> ORANGE PUSH
             syncStatus = 'local-changes';
          } else if (dbUpdatedAt > localUpdatedAt + BUFFER) {
             // ⬇️ Server is newer -> BLUE PULL
             syncStatus = 'server-newer';
          } else {
             // ✅ Timestamps match -> GREEN SYNCED
             syncStatus = 'synced';
          }
          // ---------------------------------------------

          // Normalize indicators
          const indicatorsArray = Array.isArray(parsed.indicators)
            ? parsed.indicators
            : Array.isArray(parsed.indicators?.indicators)
            ? parsed.indicators.indicators
            : [];

          const total = indicatorsArray.length;
          let good = 0;
          let growth = 0;
          let progress = 0;

          indicatorsArray.forEach((ind: any) => {
            const hasMark = ind.good || ind.growth;
            const hasComment = ind.commentText?.trim().length > 0;
            const hasInk = Array.isArray(ind.strokes) && ind.strokes.length > 0;

            if (hasMark || hasComment || hasInk) progress++;
            if (ind.good) good++;
            if (ind.growth) growth++;
          });

          let statusColor: StatusColor = "mixed";
          if (growth > 0 && good === 0) statusColor = "growth";
          else if (good > 0 && growth === 0) statusColor = "good";

          const obsDateStr: string | undefined =
            parsed.meta?.date ?? dbRow.observation_date ?? undefined;

          let rawDate: number | null = null;
          let displayDate = "";
          let isoDate: string | null = null;

          if (obsDateStr) {
            isoDate = obsDateStr;
            rawDate = safeParseTimestamp(obsDateStr);
            if (rawDate) {
              displayDate = new Date(rawDate).toLocaleDateString();
            }
          } else if (parsed.updatedAt) {
            rawDate = parsed.updatedAt;
            displayDate = new Date(parsed.updatedAt).toLocaleDateString();
          }

          rows.push({
            id: parsed.id,
            teacherName: parsed.meta.teacherName,
            schoolName: parsed.meta.schoolName,
            campus: parsed.meta.campus,
            unit: parsed.meta.unit,
            lesson: parsed.meta.lesson,
            supportType: parsed.meta.supportType,
            dateLabel: displayDate,
            isoDate,
            rawDate,
            status: parsed.status ?? "draft",
            progress,
            totalIndicators: total,
            statusColor,
            teacherWorkbookUrl: parsed.meta.teacherWorkbookUrl ?? parsed.meta.teacherSheetUrl ?? null,
            adminWorkbookUrl: parsed.meta.adminWorkbookUrl ?? parsed.meta.adminSheetUrl ?? null,
            adminViewOnlyUrl: parsed.meta.adminViewOnlyUrl ?? parsed.meta.adminWorkbookViewUrl ?? null,
            admin_summary_vn: dbRow.admin_summary_vn,
            syncStatus,
            meta: parsed.meta ?? {},
            lastSync: parsed.lastSync || 0,
            updatedAt: parsed.updatedAt || 0,
          });
        }
      } catch (err) {
        console.error("[Dashboard] Unexpected error processing observations", err);
      }

      // ✅ ENRICH: Bulk fetch defaults (Only if Online)
      let finalRows = rows;
      try {
        if (navigator.onLine) {
           finalRows = await enrichObservationsWithDefaults(rows);
        } else {
           console.log("⚠️ Offline: Skipping school/workbook enrichment.");
        }
      } catch (enrichErr) {
        console.warn("Enrichment failed (likely offline)", enrichErr);
      }
      
      setObservations(finalRows);

      // Load AM summary "sent" markers
      try {
        const raw = localStorage.getItem(SUMMARY_STATE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            setAmSummarySentMap(parsed as AmSummarySentMap);
          }
        }
      } catch (err) {
        console.error("Failed to load AM summary state", err);
      }
    };

    load();
  }, [user]);

  /* ------------------------------
      FILTER + SORT + GROUP
  --------------------------------- */

  const filteredAndSorted = React.useMemo(() => {
    let list = [...observations];

    // search
    const q = searchText.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        return (
          o.teacherName.toLowerCase().includes(q) ||
          o.schoolName.toLowerCase().includes(q) ||
          o.campus.toLowerCase().includes(q)
        );
      });
    }

    // sort
    list.sort((a, b) => {
      if (sortMode === "newest") {
        return (b.rawDate ?? 0) - (a.rawDate ?? 0);
      }
      if (sortMode === "oldest") {
        return (a.rawDate ?? 0) - (b.rawDate ?? 0);
      }
      if (sortMode === "teacher-az") {
        return a.teacherName.localeCompare(b.teacherName);
      }
      if (sortMode === "teacher-za") {
        return b.teacherName.localeCompare(a.teacherName);
      }
      return 0;
    });

    return list;
  }, [observations, searchText, sortMode]);

  // Assuming 'observations' and 'setObservations' are managed via useState in DashboardShell
// const [observations, setObservations] = useState<DashboardObservationRow[]>([]);

const handleSummarySaved = React.useCallback(
    (obsId: string, vnSummary: string | null) => {
        // This function is the KEY FIX. It updates the parent's state directly, 
        // forcing the AM Summary useEffect to re-run with the fresh data.
        setObservations(prev =>
            prev.map(o => 
                o.id === obsId 
                    ? { 
                        ...o, 
                        // Update the specific field on the observation object
                        admin_summary_vn: vnSummary 
                      }
                    : o
            )
        );
    },
    [setObservations]
);

// Handler for saving edited metadata
const handleSaveEditedObservation = useCallback(async (id: string, updatedMeta: Partial<DashboardObservationRow['meta']>) => {
  // 1. Update the local state (optimistic UI update)
  setObservations(prev =>
    prev.map(obs =>
      obs.id === id
        ? { ...obs,
            teacherName: updatedMeta.teacherName ?? obs.teacherName,
            schoolName: updatedMeta.schoolName ?? obs.schoolName,
            campus: updatedMeta.campus ?? obs.campus,
            unit: updatedMeta.unit ?? obs.unit,
            lesson: updatedMeta.lesson ?? obs.lesson,
            supportType: updatedMeta.supportType ?? obs.supportType,
            isoDate: updatedMeta.date ?? obs.isoDate,
            dateLabel: updatedMeta.date ? new Date(updatedMeta.date).toLocaleDateString() : obs.dateLabel,
            meta: { ...obs.meta, ...updatedMeta }
          }
        : obs
    )
  );

  // 2. Persist to DB (and local storage via persistMergedLinkToObservationMeta)
  // We need to construct the patch carefully, as persistMergedLinkToObservationMeta expects
  // the keys to be directly under 'meta'
  const patchForPersistence = {
    teacherName: updatedMeta.teacherName,
    schoolName: updatedMeta.schoolName,
    campus: updatedMeta.campus,
    unit: updatedMeta.unit,
    lesson: updatedMeta.lesson,
    supportType: updatedMeta.supportType,
    date: updatedMeta.date, // Use 'date' for ISO date string in meta
  };
  await persistMergedLinkToObservationMeta(id, patchForPersistence);

  setEditingObservation(null);
  setShowEditModal(false);
}, [setObservations]);

// --- Now, continue with the rest of your component's code ---

  const grouped = React.useMemo(() => {
    if (groupMode === "none") return null;

    if (groupMode === "month") {
      return groupBy(filteredAndSorted, (o) => {
        const mk = monthKeyFromTs(o.rawDate);
        return mk ?? "Unknown date";
      });
    }
    if (groupMode === "school") {
      return groupBy(filteredAndSorted, (o) => o.schoolName);
    }
    if (groupMode === "campus") {
      return groupBy(filteredAndSorted, (o) => o.campus);
    }

    return null;
  }, [filteredAndSorted, groupMode]);

  /* ------------------------------
      AM SUMMARY HELPERS
  --------------------------------- */

  // All distinct month keys that actually have data, sorted newest→oldest
  const availableMonths = React.useMemo(() => {
    const set = new Set<string>();
    observations.forEach((o) => {
      const mk = monthKeyFromTs(o.rawDate);
      if (mk) set.add(mk);
    });
    return Array.from(set).sort((a, b) => {
      // "11.2025" → [m,y]
      const [m1, y1] = a.split(".").map(Number);
      const [m2, y2] = b.split(".").map(Number);
      if (y1 !== y2) return y2 - y1;
      return m2 - m1;
    });
  }, [observations]);

  // All AMs that appear in *any* observation (we filter by month later)
  const allAms = React.useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();

    observations.forEach((o) => {
      const info = findSchoolInfo(o.schoolName, o.campus);
      if (!info) return;
      const key = amKeyFromSchool(info);
      if (!map.has(key)) {
        map.set(key, { name: info.amName, email: info.amEmail });
      }
    });

    return Array.from(map.entries()).map(([key, v]) => ({
      key,
      name: v.name,
      email: v.email,
    }));
  }, [observations]);

  // AMs that actually have schools supported in the chosen month
  const amsForSelectedMonth = React.useMemo(() => {
    if (!summaryMonth) return [];

    const seen = new Map<string, { name: string; email: string }>();

    observations.forEach((o) => {
      const mk = monthKeyFromTs(o.rawDate);
      if (mk !== summaryMonth) return;

      const info = findSchoolInfo(o.schoolName, o.campus);
      if (!info) return;
      const key = amKeyFromSchool(info);
      if (!seen.has(key)) {
        seen.set(key, { name: info.amName, email: info.amEmail });
      }
    });

    return Array.from(seen.entries()).map(([key, v]) => ({
      key,
      name: v.name,
      email: v.email,
    }));
  }, [observations, summaryMonth]);

  // Build summary rows when both month + AM are chosen
// Build summary rows when both month + AM are chosen
  React.useEffect(() => {
    if (!summaryMonth || !summaryAmKey) {
      setSummaryRows([]);
      return;
    }

    // 1. Use the MAIN interface defined at the top of your file.
    const rowMap = new Map<string, AmSummaryRow>();

    observations.forEach((o) => {
      // Basic filtering
      const mk = monthKeyFromTs(o.rawDate);
      if (mk !== summaryMonth) return;

      const info = findSchoolInfo(o.schoolName, o.campus);
      if (!info) return;
      const amKey = amKeyFromSchool(info);
      if (amKey !== summaryAmKey) return;

      // -----------------------------------------------------------------
      // Logic: Determine "Best Available" Summary Text
      // -----------------------------------------------------------------
      let collected = "";

      // A. Priority: Database translated summary (requires the load fix above!)
      if (o.admin_summary_vn) {
        collected = o.admin_summary_vn;
      } else {
        // B. Fallback: Local Storage English indicators
        const storageKey = `${STORAGE_PREFIX}${o.id}`;
        let details: any = null;
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) details = JSON.parse(raw);
        } catch (err) { /* ignore */ }

        const obsLabel = o.dateLabel || mk;

        if (details && Array.isArray(details.indicators)) {
          (details.indicators as any[]).forEach((ind) => {
            const comment = (ind.commentText ?? "").toString().trim();
            const hasComment = comment.length > 0;
            const explicitlyFlagged =
              ind.includeInTrainerSummary === true && hasComment;
            const legacyFlagged =
              ind.includeInTrainerSummary === undefined &&
              !!ind.growth &&
              hasComment;

            if (!explicitlyFlagged && !legacyFlagged) return;

            const number = ind.number ?? "";
            const line = `- [${obsLabel}] ${number}: ${comment}`;
            collected += (collected ? "\n" : "") + line;
          });
        }
      }

      // -----------------------------------------------------------------
      // Aggregate into Map
      // -----------------------------------------------------------------
      const key = `${o.teacherName}|${o.schoolName}|${o.campus}`;

      if (!rowMap.has(key)) {
        rowMap.set(key, {
          schoolName: o.schoolName,
          campus: o.campus,
          teacherName: o.teacherName,
          // 🛑 FIX: Cast specifically to 'any' or the specific union type to allow "none"
          status: "none" as any, 
          
          // Initial values
          nextSteps: collected,
          adminSummaryVn: collected,
        });
      } else {
        const existing = rowMap.get(key)!;

        // Helper to append text safely
        const appendText = (current: string, newText: string) =>
          newText ? [current, newText].filter(Boolean).join("\n") : current;

        rowMap.set(key, {
          ...existing,
          nextSteps: appendText(existing.nextSteps, collected),
          // Append to both so they stay in sync if multiple observations merge
          adminSummaryVn: appendText(existing.adminSummaryVn || "", collected),
        });
      }
    });

    // Sort by teacher name
    const rows = Array.from(rowMap.values()).sort((a, b) =>
      a.teacherName.localeCompare(b.teacherName)
    );

    setSummaryRows(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryMonth, summaryAmKey, observations]);

  // Build email body from current table state
  const emailBody = React.useMemo(() => {
    if (!summaryMonth || !summaryAmKey || summaryRows.length === 0) {
      return "";
    }

    const { name: amName } = parseAmKey(summaryAmKey);

    const headerLines = [
      `Dear ${amName},`,
      "",
      `Here is the GrapeSEED support summary for ${summaryMonth}.`,
      "",
      "School | Campus | Teacher | Status | Next steps",
      "------ | ------ | ------- | ------ | ----------",
    ];

    const rowLines = summaryRows.map((r) => {
      const statusLabel =
        r.status === "green"
          ? "Green"
          : r.status === "red"
          ? "Red"
          : "-";

      const oneLineNext =
        r.nextSteps?.replace(/\s+/g, " ").slice(0, 180) || "";
      return `${r.schoolName} | ${r.campus} | ${r.teacherName} | ${statusLabel} | ${oneLineNext}`;
    });

    const footerLines = [
      "",
      "If you have any questions or would like to discuss specific next steps, please let me know.",
      "",
      "Best regards,",
      "Brian",
    ];

    return [...headerLines, ...rowLines, ...footerLines].join("\n");
  }, [summaryRows, summaryMonth, summaryAmKey]);

  // Mark email as "sent" for (AM, month)
  const markSummarySent = () => {
    if (!summaryMonth || !summaryAmKey) return;

    const key = `${summaryAmKey}::${summaryMonth}`;
    const now = Date.now();
    const updated: AmSummarySentMap = {
      ...amSummarySentMap,
      [key]: now,
    };

    setAmSummarySentMap(updated);
    try {
      localStorage.setItem(SUMMARY_STATE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error("Failed to persist AM summary state", err);
    }
  };

  const sentInfo = React.useMemo(() => {
    if (!summaryMonth || !summaryAmKey) return null;
    const key = `${summaryAmKey}::${summaryMonth}`;
    const ts = amSummarySentMap[key];
    if (!ts) return null;
    return new Date(ts).toLocaleString();
  }, [amSummarySentMap, summaryAmKey, summaryMonth]);

  // Observation currently targeted by the Teacher/Admin action modal
  const modalObservation = React.useMemo(() => {
    if (!actionModal) return null;
    return observations.find((o) => o.id === actionModal.obsId) ?? null;
  }, [actionModal, observations]);

  /* ------------------------------
      HANDLERS
  --------------------------------- */

const handlePreCallEmail = async (obs: DashboardObservationRow) => {
    const teacherEmail = await fetchTeacherEmail(obs.teacherName, obs.schoolName);
    
    // Build HTML (Simple Link Version)
    const html = buildTeacherPreCallHtml({
      teacherName: obs.teacherName,
      schoolName: obs.schoolName,
      campus: obs.campus,
      trainerName: trainerName, // 🟢 UPDATED: Uses real name
      teacherWorkbookUrl: obs.teacherWorkbookUrl,
    });

    setEmailModalState({
      isOpen: true,
      mode: "simple",
       emailType: "pre", // <--- 1. Set Type
       obsId: obs.id, // <--- ✅ PASS THE ID HERE
      to: teacherEmail ? [teacherEmail] : [],
      subject: `GrapeSEED Support Pre-call: ${obs.teacherName}`,
      cc: [],
      bodyHtml: html,
    });
  };

  const handlePostCallEmail = async (obs: DashboardObservationRow) => {
    const teacherEmail = await fetchTeacherEmail(obs.teacherName, obs.schoolName);
    
    const html = buildTeacherPostCallHtml({
      teacherName: obs.teacherName,
      schoolName: obs.schoolName,
      campus: obs.campus,
      trainerName: trainerName, // 🟢 UPDATED: Uses real name
      teacherWorkbookUrl: obs.teacherWorkbookUrl,
    });

    setEmailModalState({
      isOpen: true,
      mode: "simple",
      emailType: "post", // <--- 1. Set Type
      obsId: obs.id, // <--- ✅ PASS THE ID HERE
      to: teacherEmail ? [teacherEmail] : [],
      cc: [],
      subject: `GrapeSEED Support Summary: ${obs.teacherName}`,
      bodyHtml: html,
    });
  };

  const handleAdminUpdateEmail = async (obs: DashboardObservationRow) => {
    // 1. Fetch Admin Email
    const { adminEmail, amEmail } = await fetchSchoolEmails(obs.schoolName, obs.campus);

    // 2. Identify the Target Month (YYYY-MM) from the clicked observation
    // obs.date is expected to be "YYYY-MM-DD"
    const targetMonthPrefix = obs.isoDate ? obs.isoDate.slice(0, 7) : ""; // "2025-12"

    // 3. Find Matches: Same School + Same Month
    const matches = observations.filter((o) => {
      if (o.schoolName !== obs.schoolName) return false;
      if (!o.isoDate) return false;
      return o.isoDate.startsWith(targetMonthPrefix);
    });

    // 4. Prepare Data
    let html = "";
    const isBulk = matches.length > 1;

    // Helper to format month name (e.g. "12/2025")
    const monthLabel = targetMonthPrefix 
      ? `${targetMonthPrefix.split("-")[1]}/${targetMonthPrefix.split("-")[0]}`
      : "Unknown Date";

    if (isBulk) {
      // BULK MODE
      html = buildAdminUpdateBulkHtml({
        adminName: "School Admin",
        schoolName: obs.schoolName,
        reportMonth: monthLabel,
        trainerName: trainerName, // 🟢 UPDATED
        adminWorkbookUrl: obs.adminWorkbookUrl,
        viewOnlyUrl: obs.adminViewOnlyUrl,
        teachers: matches.map(m => ({
          campus: m.campus,
          teacherName: m.teacherName,
          unit: m.unit,
          lesson: m.lesson,
          dateStr: m.isoDate ? m.isoDate.slice(5) : "" // "12-14"
        }))
      });
    } else {
      // SINGLE MODE (Legacy)
      html = buildAdminUpdateHtml({
        adminName: "School Admin",
        schoolName: obs.schoolName,
        campus: obs.campus,
        trainerName: trainerName, // 🟢 UPDATED
        teacherName: obs.teacherName,
        adminWorkbookUrl: obs.adminWorkbookUrl,
        viewOnlyUrl: obs.adminViewOnlyUrl
      });
    }

    // 5. Open Modal
    setEmailModalState({
      isOpen: true,
      mode: "simple",
      emailType: "admin",
      obsId: obs.id, // Primary ID
      obsIds: matches.map(m => m.id), // <--- Track ALL IDs for badging
      to: adminEmail ? [adminEmail] : [],
      cc: amEmail ? [amEmail] : [],
      subject: isBulk 
        ? `GrapeSEED Support Update: ${obs.schoolName} (${monthLabel})`
        : `GrapeSEED Support Update: ${obs.schoolName}`,
      bodyHtml: html,
    });
  };


const handleMergeTeacherWorkbook = async (obs: DashboardObservationRow) => {
    setMergingTeacherId(obs.id);
    setActionModal(null);

    // 1. Basic Validation
    // 🔴 REPLACED: const full = loadFullObservation(obs.id);
    // 🟢 FIXED: Fetch asynchronously from IndexedDB
    const full = await get(`${STORAGE_PREFIX}${obs.id}`);

    if (!full) { alert("Missing data (Check IndexedDB)"); setMergingTeacherId(null); return; }
    
    const workbookUrl = obs.teacherWorkbookUrl;
    if (!workbookUrl) { alert("No Workbook URL"); setMergingTeacherId(null); return; }

    try {
      // 2. Get Token
      const graphToken = await getGraphAccessToken();

      // 3. Prepare Data
      const exportMeta = toMetaForExport(full, obs);
      const exportIndicators = toIndicatorsForExport(full);
      const teacherModel = buildTeacherExportModel(exportMeta, exportIndicators);

      // 🚀 4. RUN CLIENT MERGE (No Server!)
      const result = await clientMergeTeacherSheet({
        token: graphToken,
        workbookUrl,
        sheetName: buildTeacherSheetName(obs),
        model: teacherModel
      });

      // 5. Success: Update Database
      const mergedAt = new Date().toISOString();
      const patch = {
        mergedTeacher: { url: result.sheetUrl, sheetName: result.sheetName, mergedAt },
        teacherWorkbookUrl: workbookUrl,
      };

      const nextMeta = await persistMergedLinkToObservationMeta(obs.id, patch);

      // Update UI
      setObservations((prev) =>
        prev.map((o) => (o.id === obs.id ? { ...o, meta: nextMeta } : o))
      );

      setRecentMergePanel({
        obsId: obs.id,
        kind: "teacher",
        sheetUrl: result.sheetUrl,
        sheetName: result.sheetName,
        mergedAt,
      });

      alert("Teacher merge succeeded!");

    } catch (err: any) {
      console.error("Client merge error:", err);
      alert(`Merge failed: ${err.message}`);
    } finally {
      setMergingTeacherId(null);
    }
  };

  // ✅ CLIENT-SIDE MERGE ADMIN HANDLER (With Translation Fix)
  const handleMergeAdminWorkbook = async (obs: DashboardObservationRow) => {
    setMergingAdminId(obs.id);
    setActionModal(null);

    // 🔴 REPLACED: const full = loadFullObservation(obs.id);
    // 🟢 FIXED: Fetch asynchronously from IndexedDB
    const full = await get(`${STORAGE_PREFIX}${obs.id}`);

    if (!full) { alert("Missing local data (Check IndexedDB)"); setMergingAdminId(null); return; }

    const adminWorkbookUrl = obs.adminWorkbookUrl;
    if (!adminWorkbookUrl) { alert("Admin workbook URL not found."); setMergingAdminId(null); return; }

    // Resolve School ID logic... (keep existing)
    let schoolId = (obs as any).schoolId || (obs as any).meta?.schoolId || null;
    if (!schoolId) {
       try {
         const { data } = await supabase.from("schools").select("id").eq("school_name", obs.schoolName).eq("campus_name", obs.campus).limit(1);
         if (data?.[0]) schoolId = data[0].id;
       } catch {}
    }

    try {
      const graphToken = await getGraphAccessToken();

      // Prepare Data
      const exportMeta = toMetaForExport(full, obs);
      const exportIndicators = toIndicatorsForExport(full);
      const adminModel = buildAdminExportModel(exportMeta, exportIndicators);

      // 👇👇 CRITICAL UPDATE: Clean the text before adding to model 👇👇
      if (obs.admin_summary_vn) {
        // Remove (GA) and Hyphens so Admin sheet looks clean
        adminModel.trainerSummary = cleanTextForAdmin(obs.admin_summary_vn);
      }
      
      const sheetName = buildAdminSheetName(obs);

      // Run Merge
      const result = await clientMergeAdminSheet({
        token: graphToken,
        workbookUrl: adminWorkbookUrl,
        sheetName,
        model: adminModel
      });

      // Update Database
      const mergedAt = new Date().toISOString();
      const newViewUrl = obs.adminViewOnlyUrl || result.viewUrl; 

      const patch = {
        mergedAdmin: { url: result.sheetUrl, sheetName: result.sheetName, mergedAt },
        adminWorkbookUrl,
        adminWorkbookViewUrl: newViewUrl, 
        schoolId,
      };

      const nextMeta = await persistMergedLinkToObservationMeta(obs.id, patch);

      // Update UI
      setObservations((prev) =>
        prev.map((o) => 
          o.id === obs.id 
            ? { ...o, meta: nextMeta, adminWorkbookUrl, adminViewOnlyUrl: newViewUrl } 
            : o
        )
      );

      setRecentMergePanel({
        obsId: obs.id,
        kind: "admin",
        sheetUrl: result.sheetUrl,
        sheetName: result.sheetName,
        mergedAt,
      });

      alert("Admin merge succeeded!");

    } catch (err: any) {
      console.error("Client admin merge error:", err);
      alert(`Admin merge failed: ${err.message}`);
    } finally {
      setMergingAdminId(null);
    }
  };


  // ✅ DELETE HANDLER
  const handleDeleteObservation = async (obs: DashboardObservationRow) => {
    // 1. Simple Confirmation Step
    const confirmed = window.confirm(
      `Are you sure you want to DELETE the observation for:\n${obs.teacherName}?\n\n⚠️ This action cannot be undone.`
    );
    
    if (!confirmed) return;

    try {
      // 2. Delete from Supabase
      const { error } = await supabase
        .from("observations") // Make sure this matches your table name
        .delete()
        .eq("id", obs.id);

      if (error) throw error;

      // 3. Update Local State (Remove the card instantly)
      setObservations((prev) => prev.filter((o) => o.id !== obs.id));

      // 4. Cleanup LocalStorage (Optional but recommended)
      // We try to remove the cached version to free up space
      try {
        localStorage.removeItem(`${STORAGE_PREFIX}${obs.id}`);
      } catch (e) {
        // Ignore local storage errors
      }

    } catch (err: any) {
      console.error("[Dashboard] delete error", err);
      alert(`Failed to delete observation: ${err.message}`);
    }
  };


  // NEW: toggle group expanded/collapsed
  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };


  // ✅ NEW: Callback when email is sent successfully
  const handleEmailSuccess = async () => {
    // 1. Determine targets (Bulk IDs or Single ID)
    const targetIds = emailModalState.obsIds && emailModalState.obsIds.length > 0
      ? emailModalState.obsIds
      : (emailModalState.obsId ? [emailModalState.obsId] : []);

    const type = emailModalState.emailType;

    if (targetIds.length === 0 || !type || type === "am") return;

    const timestamp = new Date().toISOString();
    let metaKey = "";
    if (type === "pre") metaKey = "emailSentPre";
    if (type === "post") metaKey = "emailSentPost";
    if (type === "admin") metaKey = "emailSentAdmin";

    if (!metaKey) return;

    // 2. Update UI (Optimistic Loop)
    setObservations((prev) =>
      prev.map((o) => {
        if (targetIds.includes(o.id)) {
          return {
            ...o,
            meta: { ...o.meta, [metaKey]: timestamp },
          };
        }
        return o;
      })
    );

    // 3. Save to DB (Parallel Loop)
    // We reuse the robust persist function we fixed earlier
    await Promise.all(
      targetIds.map((id) =>
        persistMergedLinkToObservationMeta(id, { [metaKey]: timestamp })
      )
    );
  };


  /* ------------------------------
      CARD RENDERER
  --------------------------------- */

  const renderRow = (
    obs: DashboardObservationRow,
    options?: { disableClick?: boolean; hideMergeLinks?: boolean }
  ) => {

    const handleOpenWorkspace = () => {
      if (options?.disableClick) return; // used by stack preview
      onOpenObservation({
        id: obs.id,
        teacherName: obs.teacherName,
        schoolName: obs.schoolName,
        campus: obs.campus,
        unit: obs.unit,
        lesson: obs.lesson,
        supportType: obs.supportType as "Training" | "LVA" | "Visit",
        date: obs.isoDate || "",
      });
    };

  const metaAny: any = getStableMetaForRow(obs);

    // No-argument version — clean and safe
    const openTeacherModal = () => {
      setActionModal({ obsId: obs.id, role: "teacher" });
    };

    const openAdminModal = () => {
      setActionModal({ obsId: obs.id, role: "admin" });
    };

    // ---- links derived from meta (persisted) or row (enriched defaults) ----
    const teacherWorkbookUrl = obs.teacherWorkbookUrl;
    const adminWorkbookUrl = obs.adminWorkbookUrl;
    const adminViewOnlyUrl = obs.adminViewOnlyUrl;

    const showLinks =
      !!teacherWorkbookUrl || !!adminViewOnlyUrl || !!adminWorkbookUrl;

    // -------------------------------------------------------------------------
    // 🟢 NEW: SMART SYNC UI LOGIC
    // -------------------------------------------------------------------------
    // Cast to 'any' to avoid TS errors if you haven't updated the Interface yet
    const safeObs = obs as any; 
    const lastSync = safeObs.lastSync || 0;
    const updatedAt = safeObs.updatedAt || 0;

    // It is synced if we have a record of syncing AND it happened after the last edit
    const isSynced = lastSync > 0 && lastSync >= updatedAt;

    let actionButton;

    if (isSynced) {
      // ✅ CASE A: Synced (Green Badge)
      actionButton = (
        <div 
          onClick={(e) => e.stopPropagation()}
          title={`Last Sync: ${new Date(lastSync).toLocaleTimeString()}`}
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            fontSize: "11px", fontWeight: "bold", 
            color: "#10b981", // Emerald-500
            background: "rgba(16, 185, 129, 0.1)", 
            border: "1px solid rgba(16, 185, 129, 0.3)",
            padding: "2px 8px", borderRadius: "4px", cursor: "default"
          }}
        >
          <span>✓ Synced</span>
        </div>
      );
    } else {
      // ☁️ CASE B: Not Synced (Blue Button)
      // Handles BOTH "Push" (Local changes) and "Sync/Pull" (Server changes)
      actionButton = (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePush(obs.id); // <--- This now triggers the Conflict Check!
          }}
          title="Sync with Server"
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            fontSize: "11px", fontWeight: "bold",
            color: "white",
            background: "#4f46e5", // Indigo-600 (Blue/Purple)
            border: "none",
            padding: "4px 10px", borderRadius: "4px", 
            cursor: "pointer", boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
          }}
        >
          <span>☁️ Sync Now</span>
        </button>
      );
    }
    // -------------------------------------------------------------------------

    return (
      <div
        key={obs.id}
        role="button"
        tabIndex={0}
        className="obs-row"
        onClick={handleOpenWorkspace}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpenWorkspace();
          }
        }}
      >
        <div
          className={`obs-status-strip ${
            obs.statusColor === "good"
              ? "obs-status-good"
              : obs.statusColor === "growth"
              ? "obs-status-growth"
              : "obs-status-mixed"
          }`}
        />

        <div className="obs-row-left" style={{ width: '100%' }}>
          <div className="obs-row-header"style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              width: '100%',
              marginBottom: '4px' 
            }}>
            <div className="obs-teacher">{obs.teacherName}</div>  
            {actionButton}            
          </div>

          <div className="obs-meta">
            {obs.schoolName} – {obs.campus} • Unit {obs.unit} – Lesson{" "}
            {obs.lesson} • {obs.supportType}
            
            {/* 👇 NEW: Email Status Badges 👇 */}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {metaAny.emailSentPre && (
                <span title={`Pre-call sent: ${new Date(metaAny.emailSentPre).toLocaleDateString()}`} 
                      style={{fontSize:10, padding:"2px 6px", borderRadius:4, background:"#dbeafe", color:"#1e40af", border:"1px solid #bfdbfe", display: "inline-flex", alignItems: "center", gap: 3}}>
                  <span>✉️</span> Pre
                </span>
              )}
              {metaAny.emailSentPost && (
                <span title={`Post-call sent: ${new Date(metaAny.emailSentPost).toLocaleDateString()}`} 
                      style={{fontSize:10, padding:"2px 6px", borderRadius:4, background:"#dcfce7", color:"#166534", border:"1px solid #bbf7d0", display: "inline-flex", alignItems: "center", gap: 3}}>
                  <span>✉️</span> Post
                </span>
              )}
              {metaAny.emailSentAdmin && (
                <span title={`Admin update sent: ${new Date(metaAny.emailSentAdmin).toLocaleDateString()}`} 
                      style={{fontSize:10, padding:"2px 6px", borderRadius:4, background:"#f3e8ff", color:"#6b21a8", border:"1px solid #e9d5ff", display: "inline-flex", alignItems: "center", gap: 3}}>
                  <span>✉️</span> Admin
                </span>
              )}
            </div>
             {/* 👆 END BADGES 👆 */}
        </div>

          {/* tags row + Teacher/Admin pills under it */}
          <div className="obs-tags-row">
            <div className="obs-tags">
              <span
                className={
                  obs.status === "saved"
                    ? "obs-tag obs-tag-completed"
                    : "obs-tag obs-tag-draft"
                }
              >
                {obs.status === "saved" ? "Completed" : "Draft"}
              </span>
              <span className="obs-progress">
                {obs.progress} / {obs.totalIndicators} indicators
              </span>
            </div>

            <div className="obs-pill-row">
              <button
                type="button"
                className="obs-pill-button"
                onClick={async (e) => {
                  e.stopPropagation();
                  openTeacherModal();
                }}
              >
                Teacher…
              </button>
              <button
                type="button"
                className="obs-pill-button"
                onClick={(e) => {
                  e.stopPropagation();
                  openAdminModal();
                }}
              >
                Admin…
              </button>
              {/* 🟢 NEW: DELETE BUTTON (Styled to match perfectly) */}
              <button
                type="button"
                className="obs-pill-button"
                // We only override color/border to signal "Danger"
                style={{ 
                  marginLeft: '8px',
                  color: '#d32f2f',       // Standard Danger Red
                  borderColor: '#d32f2f', // Red border to match text
                  backgroundColor: 'transparent' // Ensure it doesn't have a weird background
                }}
                title="Delete Observation"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteObservation(obs);
                }}
              >
                {/* Trash Icon + Text (Optional: remove "Delete" text if you want icon only) */}
                <i className="fa fa-trash" style={{ marginRight: '4px' }}></i>
                Delete
              </button>
              {/* 🟢 NEW: EDIT METADATA BUTTON */}
              <button
                type="button"
                className="obs-pill-button"
                style={{
                  marginLeft: '8px',
                  color: '#007bff',
                  borderColor: '#007bff',
                  backgroundColor: 'transparent'
                }}
                title="Edit Observation Details"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingObservation(obs);
                  setShowEditModal(true);
                }}
              >
                <i className="fa fa-edit" style={{ marginRight: '4px' }}></i>
                Edit
              </button>
              {/* 🟢 END EDIT METADATA BUTTON */}
              {/* 🟢 END NEW BUTTON */}
            </div>
          </div>

        {/* ✅ ONLY 3 STRIPS (persistent workbook links) */}
        {!options?.hideMergeLinks && showLinks && (
            <div className="obs-merge-links" onClick={(e) => e.stopPropagation()}>
              {/* Teacher workbook */}
              {teacherWorkbookUrl && (
                <div className="obs-merge-row">
                  <span className="obs-merge-label">Teacher workbook</span>
                  <div className="obs-merge-actions">
                    <button
                      type="button"
                      className="obs-merge-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(
                          teacherWorkbookUrl,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      }}
                    >
                      Open ⧉
                    </button>
                    <button
                      type="button"
                      className="obs-merge-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard?.writeText?.(teacherWorkbookUrl);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Admin workbook (view-only) */}
              {adminViewOnlyUrl && (
                <div className="obs-merge-row">
                  <span className="obs-merge-label">Admin workbook (view-only)</span>
                  <div className="obs-merge-actions">
                    <button
                      type="button"
                      className="obs-merge-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(adminViewOnlyUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      View ⧉
                    </button>
                    <button
                      type="button"
                      className="obs-merge-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard?.writeText?.(adminViewOnlyUrl);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Admin workbook (edit) */}
              {adminWorkbookUrl && (
                <div className="obs-merge-row">
                  <span className="obs-merge-label">Admin workbook</span>
                  <div className="obs-merge-actions">
                    <button
                      type="button"
                      className="obs-merge-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(adminWorkbookUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Open ⧉
                    </button>
                    <button
                      type="button"
                      className="obs-merge-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard?.writeText?.(adminWorkbookUrl);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

       {/* 🟢 START: INSERT THIS PROGRESS BAR BLOCK HERE 🟢 */}
          {(mergingTeacherId === obs.id || mergingAdminId === obs.id) && (
            <div style={{ marginTop: '12px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
              
              {/* Status Label */}
              <div style={{ fontSize: '12px', color: '#007bff', marginBottom: '4px', fontWeight: 'bold' }}>
                {mergingTeacherId === obs.id ? (
                    <>
                      <i className="fa fa-spinner fa-spin" style={{marginRight: '6px'}}></i>
                      Merging Teacher Workbook...
                    </>
                ) : (
                    <>
                      <i className="fa fa-spinner fa-spin" style={{marginRight: '6px'}}></i>
                      Merging Admin Workbook...
                    </>
                )}
              </div>

              {/* Native HTML5 Indeterminate Progress Bar */}
              <progress 
                max="100" 
                style={{ 
                  width: '100%', 
                  height: '3px', /* 🟢 CHANGED: 6px -> 3px for a sleeker look */
                  borderRadius: '2px',
                  accentColor: '#007bff' /* Makes the bar blue */
                }} 
              />
              
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                Communicating with Microsoft Graph...
              </div>
            </div>
          )}
          {/* 🟢 END: PROGRESS BAR BLOCK 🟢 */}


        </div>

        <div className="obs-date">{obs.dateLabel}</div>
      </div>
    );
  };

  // grouped renderer with collapsed stack
  const renderGroup = (group: {
    key: string;
    label: string;
    items: DashboardObservationRow[];
  }) => {
    const isExpanded = expandedGroups[group.key] ?? false;
    const count = group.items.length;
    // const latest = group.items[0]; // unused variable
    return (
      <div key={group.key} className="obs-group">
        {/* Group header row */}
        <button
          type="button"
          className="obs-group-header"
          onClick={() => toggleGroupExpanded(group.key)}
        >
          <div className="obs-group-header-main">
            <div className="obs-group-title">{group.label}</div>
            <div className="obs-group-meta">
              {count} {count === 1 ? "observation" : "observations"}
            </div>
          </div>
          <div className="obs-group-chevron">
            {isExpanded ? "▾" : "▸"}
          </div>
        </button>

        {/* Expanded: show full list */}
        {isExpanded ? (
          <div className="obs-group-body">
            {group.items.map((obs) => renderRow(obs))}
          </div>
        ) : (
          <div
            className="obs-group-stack"
            onClick={() => toggleGroupExpanded(group.key)}
          >
            <div className="obs-group-stack-layer obs-group-stack-layer--behind" />
            <div className="obs-group-stack-layer obs-group-stack-layer--middle" />

            <div className="obs-group-stack-main">
              {/* latest card, but no click + no merge links */}
              {renderRow(group.items[0], {
                disableClick: true,
                hideMergeLinks: true,
              })}

              {group.items.length > 1 && (
                <div className="obs-stack-count-overlay">
                  +{group.items.length - 1} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Observations</div>
            <div className="card-subtitle">
              Tap an observation to continue, or create a new one.
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-group">
              <span>Search</span>
              <input
                className="input search-input"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Teacher, school, campus…"
              />
            </div>

            <div className="toolbar-group">
              <span>Group by</span>
              <select
                className="select"
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
              >
                <option value="none">None</option>
                <option value="month">Month</option>
                <option value="school">School</option>
                <option value="campus">Campus</option>
              </select>
            </div>

            <div className="toolbar-group">
              <span>Sort</span>
              <select
                className="select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="teacher-az">Teacher A–Z</option>
                <option value="teacher-za">Teacher Z–A</option>
              </select>
            </div>

            <div className="toolbar-group">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // default month = newest available
                  if (!summaryMonth && availableMonths[0]) {
                    setSummaryMonth(availableMonths[0]);
                  }
                  setShowAmSummary(true);
                }}
                disabled={observations.length === 0}
              >
                AM Summary…
              </button>
            </div>
          </div>
        </div>

        <div className="obs-list">
          {groupMode === "none" || !grouped
            ? filteredAndSorted.map((obs) => renderRow(obs))
            : grouped.map(renderGroup)}
        </div>
      </div>

      {/* ---------- TEACHER / ADMIN ACTION MODAL ---------- */}
      {actionModal && modalObservation && (
        <div
          className="obs-action-modal-backdrop"
          onClick={() => setActionModal(null)}
        >
          <div className="obs-action-modal" onClick={(e) => e.stopPropagation()}>
            <div className="obs-action-modal-header">
              <div className="obs-action-modal-title">
                {actionModal.role === "teacher"
                  ? "Teacher actions"
                  : "Admin actions"}
              </div>
              <div className="obs-action-modal-subtitle">
                {modalObservation.teacherName} – {modalObservation.schoolName} •{" "}
                {modalObservation.campus}
              </div>
            </div>

            <div className="obs-action-modal-body">
              {actionModal.role === "teacher" ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setActionModal(null);
                      handlePreCallEmail(modalObservation);
                    }}
                  >
                    Pre call email
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setActionModal(null);
                      handlePostCallEmail(modalObservation);
                    }}
                  >
                    Post call email
                  </button>
                  {/* TEACHER BUTTON */}
                  {/* 🟢 FIXED TEACHER BUTTON */}
                  <button
                    type="button"
                    className="btn"
                    // Disable if THIS specific observation is currently merging
                    disabled={mergingTeacherId === modalObservation.id}
                    onClick={() => {
                      // 1. Close modal immediately (so user sees the progress bar on the card)
                      setActionModal(null);
                      // 2. Start the process
                      handleMergeTeacherWorkbook(modalObservation);
                    }}
                  >
                    {/* Show spinner only if THIS observation is merging (though modal usually closes fast) */}
                    {mergingTeacherId === modalObservation.id ? (
                      <>
                        <i className="fa fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>
                        Merging...
                      </>
                    ) : (
                      "Merge teacher workbook"
                    )}
                  </button>
                </>
              ) : (
                <>
                  {/* ADMIN BUTTON */}
                  {/* 🟢 FIXED ADMIN BUTTON */}
                  <button
                    type="button"
                    className="btn"
                    disabled={mergingAdminId === modalObservation.id}
                    onClick={() => {
                      setActionModal(null);
                      handleMergeAdminWorkbook(modalObservation);
                    }}
                  >
                    {mergingAdminId === modalObservation.id ? (
                      <>
                        <i className="fa fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>
                        Merging...
                      </>
                    ) : (
                      "Merge admin workbook"
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setActionModal(null);
                      handleAdminUpdateEmail(modalObservation);
                    }}
                  >
                    Admin update email
                  </button>
                </>
              )}
            </div>

            <div className="obs-action-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setActionModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- AM SUMMARY MODAL ---------- */}
      {showAmSummary && (
        <div className="am-summary-backdrop">
          <div className="am-summary-modal">
            <div className="am-summary-header">
              <div>
                <div className="am-summary-title">Monthly summary for AMs</div>
                <div className="am-summary-sub">
                  Choose a month and Account Manager, review the table, then copy
                  the email body into Outlook.
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setShowAmSummary(false)}
              >
                Close
              </button>
            </div>

            <div className="am-summary-controls">
              <div className="toolbar-group">
                <span>Month</span>
                <select
                  className="select"
                  value={summaryMonth}
                  onChange={(e) => {
                    setSummaryMonth(e.target.value);
                    setSummaryAmKey(""); // reset AM when month changes
                  }}
                >
                  <option value="">Select…</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="toolbar-group">
                <span>Account Manager</span>
                <select
                  className="select"
                  value={summaryAmKey}
                  onChange={(e) => setSummaryAmKey(e.target.value)}
                  disabled={!summaryMonth}
                >
                  <option value="">
                    {summaryMonth ? "Select…" : "Choose month first"}
                  </option>
                  {amsForSelectedMonth.map((am) => (
                    <option key={am.key} value={am.key}>
                      {am.name} ({am.email})
                    </option>
                  ))}
                </select>
              </div>

              {sentInfo && (
                <div className="am-summary-sent">Marked as sent on {sentInfo}</div>
              )}
            </div>

            {summaryRows.length > 0 && (
              <>
                <div className="am-summary-table-wrapper">
                  <table className="am-summary-table">
                    <thead>
                      <tr>
                        <th>School</th>
                        <th>Campus</th>
                        <th>Teacher</th>
                        <th style={{ width: "100px" }}>Status</th>
                        {/* Widen this column slightly */}
                        <th style={{ width: "40%" }}>Next steps / Key issues</th>
                      </tr>
                    </thead>
                    <tbody>
                          {summaryRows.map((row, idx) => (
      <tr key={`${row.schoolName}-${row.teacherName}-${idx}`}>
        <td>{row.schoolName}</td>
        <td>{row.campus}</td>
        <td>{row.teacherName}</td>
        <td>
          <select
            className="select select-compact"
            value={row.status}
            onChange={(e) => {
              const value = e.target.value as any;
              setSummaryRows((prev) =>
                prev.map((r, i) =>
                  i === idx ? { ...r, status: value } : r
                )
              );
            }}
          >
            <option value="none">–</option>
            <option value="green">Green</option>
            <option value="red">Red</option>
          </select>
        </td>
        <td>
          {/* 🟢 LOGIC UPDATE: Only show Blue Box if text DIFFERS from current edit */}
          {(row as any).adminSummaryVn &&
            (row as any).adminSummaryVn.trim() !== row.nextSteps.trim() && (
              <div
                style={{
                  marginBottom: 8,
                  padding: 8,
                  background: "rgba(56, 189, 248, 0.1)",
                  borderRadius: 6,
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  fontSize: 11,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <strong style={{ color: "#0ea5e9" }}>
                    Original (VN):
                  </strong>
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#0ea5e9",
                      fontSize: 10,
                      textDecoration: "underline",
                    }}
                    onClick={() => {
                      // Reset: overwrite textarea with original VN text
                      // (This will hide this blue box immediately)
                      setSummaryRows((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                nextSteps: (row as any).adminSummaryVn,
                              }
                            : r
                        )
                      );
                    }}
                  >
                    Reset to Original ↓
                  </button>
                </div>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    color: "var(--text-muted)",
                  }}
                >
                  {(row as any).adminSummaryVn}
                </div>
              </div>
            )}

          <textarea
            className="input"
            style={{ width: "100%", fontSize: 12 }}
            placeholder="Add notes for AM..."
            value={row.nextSteps}
            onChange={(e) => {
              const value = e.target.value;
              setSummaryRows((prev) =>
                prev.map((r, i) =>
                  i === idx ? { ...r, nextSteps: value } : r
                )
              );
            }}
            rows={3}
          />
        </td>
      </tr>
    ))}
                    </tbody>
                  </table>
                </div>

                {/* EMAIL PREVIEW & SEND SECTION */}
                <div className="am-summary-email-section">
                  <div className="am-summary-email-header">
                    <span>Final Step: Email</span>
                  </div>

                  <div
                    style={{
                      padding: 16,
                      background: "#f3f4f6",
                      borderRadius: 8,
                      textAlign: "center",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        color: "#6b7280",
                        marginBottom: 12,
                      }}
                    >
                      Review the table above. Click below to generate the email,
                      add your message, and send via Outlook.
                    </p>

                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ backgroundColor: "#2563eb", color: "white" }}
                      disabled={summaryRows.length === 0}
                      onClick={() => {
                        const { email, name } = parseAmKey(summaryAmKey);

                        // Generate Table HTML for the "Sandwich"
                        const tableHtml = `
                          <table style="border-collapse: collapse; width: 100%; font-size: 14px; border: 1px solid #d1d5db;">
                            <thead style="background-color: #f3f4f6;">
                              <tr>
                                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left;">School</th>
                                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left;">Campus</th>
                                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left;">Teacher</th>
                                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left;">Status</th>
                                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left;">Next Steps / Summary</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${summaryRows
                                .map((r) => {
                                  const bg =
                                    r.status === "green"
                                      ? "#dcfce7"
                                      : r.status === "red"
                                      ? "#fee2e2"
                                      : "#ffffff";
                                  const text =
                                    r.status === "green"
                                      ? "#166534"
                                      : r.status === "red"
                                      ? "#991b1b"
                                      : "#374151";
                                  const statusLabel =
                                    r.status === "green"
                                      ? "GREEN"
                                      : r.status === "red"
                                      ? "RED"
                                      : "-";

                                  // Logic: Prefer user-edited 'nextSteps'.
                                  // If empty, fallback to 'adminSummaryVn'.
                                  // If both exist and differ, show both (optional logic).
                                  const vnSum = (r as any).adminSummaryVn || "";
                                  const notes = r.nextSteps || "";
                                  let finalContent = "";

                                  if (notes && vnSum && notes !== vnSum) {
                                    // Show editable notes first, then reference original summary below
                                    finalContent = `<div>${notes}</div><div style="margin-top:8px; padding-top:8px; border-top:1px dashed #ccc; color:#555; font-size:13px;"><em>Admin Summary:</em><br/>${vnSum}</div>`;
                                  } else if (notes) {
                                    finalContent = notes;
                                  } else {
                                    finalContent = vnSum;
                                  }

                                  // Convert newlines to breaks for HTML email
                                  finalContent = finalContent.replace(
                                    /\n/g,
                                    "<br/>"
                                  );

                                  return `
                                  <tr style="background-color: ${bg};">
                                    <td style="padding:8px; border:1px solid #e5e7eb;">${r.schoolName}</td>
                                    <td style="padding:8px; border:1px solid #e5e7eb;">${r.campus}</td>
                                    <td style="padding:8px; border:1px solid #e5e7eb;">${r.teacherName}</td>
                                    <td style="padding:8px; border:1px solid #e5e7eb; color: ${text}; font-weight: bold;">${statusLabel}</td>
                                    <td style="padding:8px; border:1px solid #e5e7eb;">${finalContent}</td>
                                  </tr>`;
                                })
                                .join("")}
                            </tbody>
                          </table>
                        `;

                        setEmailModalState({
                          isOpen: true,
                          mode: "sandwich",
                          emailType: "am",
                          to: email ? [email] : [],
                          cc: [],
                          subject: `GrapeSEED Support Summary - ${summaryMonth}`,
                          sandwichData: {
                            intro: `Dear ${name},\n\nHere is the GrapeSEED support summary for ${summaryMonth}. Please see the details below.`,
                            tableHtml: tableHtml,
                            outro:
                              "If you have any questions, please let me know.\n\nBest regards,\nGrapeSEED Trainer",
                          },
                        });
                      }}
                    >
                      Draft & Send Email...
                    </button>
                  </div>

                  <div className="am-summary-footer" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={markSummarySent}
                      disabled={!summaryMonth || !summaryAmKey}
                    >
                      Mark summary as sent
                    </button>
                    {sentInfo && (
                      <span className="am-summary-sent-inline">
                        Marked: {sentInfo}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {summaryMonth && summaryAmKey && summaryRows.length === 0 && (
              <div className="am-summary-empty">
                No observations for this AM in {summaryMonth}.
              </div>
            )}
          </div>
        </div>
      )}
      {/* 👇 THIS IS THE MISSING PIECE 👇 */}
      <EmailComposeModal 
        isOpen={emailModalState.isOpen}
        onClose={() => setEmailModalState(prev => ({ ...prev, isOpen: false }))}
        onSuccess={handleEmailSuccess}
        mode={emailModalState.mode}
        initialTo={emailModalState.to}
        initialCc={emailModalState.cc} // <--- PASS THIS PROP
        initialSubject={emailModalState.subject}
        initialBodyHtml={emailModalState.bodyHtml}
        sandwichData={emailModalState.sandwichData}
      />
      {/* 👆 MAKE SURE THIS IS HERE 👆 */}

      {/* ---------- EDIT OBSERVATION MODAL ---------- */}
      <EditObservationModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        observation={editingObservation}
        onSave={handleSaveEditedObservation}
      />
      {/* 🟢 ADD THIS SECTION HERE 🟢 */}
      {/* This is the "Boss Fight" modal for conflicts */}
      <ConflictResolutionModal 
         isOpen={isConflictModalOpen}
         onClose={() => setIsConflictModalOpen(false)}
         onResolve={handleConflictResolved}
         localData={conflictLocalData}
         serverData={conflictServerData}
      />
    </>
  );
};