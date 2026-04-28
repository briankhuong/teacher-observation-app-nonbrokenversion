// src/DashboardShell.tsx
import React, { useState, useCallback, useRef, useEffect } from "react";
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

import { clientMergeTeacherSheet, clientMergeAdminSheet } from './utils/clientExcelMerge';
import { EditObservationModal } from './components/EditObservationModal';
import { get, set, keys, del } from 'idb-keyval';
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { ConflictResolutionModal } from "./components/ConflictResolutionModal";
import { loadObservationFromDb, saveObservationToDb } from "./db/observations";
import { Bell, Activity, RefreshCw, Upload } from "lucide-react";
import { isGrapeSeedTokenValid } from './utils/authHelpers';
import { GrapeSeedLoginModal } from './components/GrapeSeedLoginModal';
import type { TeacherEntry } from "./emailTemplates/adminUpdateBulk";
import type { PerformanceRating } from "./constants";

// ✅ CORRECT (Matches your screenshots & Vercel settings)
const MERGE_SERVER_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const SUMMARY_STATE_KEY = "obs-am-summary-v1";
const STORAGE_PREFIX = "obs-v1-";

type StatusColor = "good" | "mixed" | "growth";
type GroupMode = "none" | "month" | "school" | "campus";
type SortMode = "newest" | "oldest" | "teacher-az" | "teacher-za";

// --- Skeleton Component (Dark Mode) ---
const SkeletonRow = () => (
  <div className="obs-row" style={{ pointerEvents: "none", opacity: 0.6 }}>
    <div className="obs-status-strip" style={{ background: "#4a5568" }} />
    <div className="obs-row-left" style={{ width: "100%" }}>
      <div className="obs-row-header" style={{ marginBottom: "8px" }}>
        {/* Fake Text Bars (Dark Theme: Faint White) */}
        <div style={{ width: "30%", height: "16px", background: "rgba(255,255,255,0.1)", borderRadius: "4px" }}></div>
      </div>
      <div className="obs-meta">
        <div style={{ width: "50%", height: "12px", background: "rgba(255,255,255,0.05)", borderRadius: "4px" }}></div>
      </div>
      <div className="obs-tags-row" style={{ marginTop: "12px" }}>
        <div style={{ width: "60px", height: "20px", background: "rgba(255,255,255,0.1)", borderRadius: "12px" }}></div>
      </div>
    </div>
  </div>
);

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
  highlightObservationId?: string | null;
  onHighlightComplete?: () => void;
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
  let fullLocalData: any = null;

  // 1. Try to read from IndexedDB first (primary storage)
  const idbKey = `${STORAGE_PREFIX}${obsId}`;
  fullLocalData = await get(idbKey);

  if (fullLocalData) {
    // Update the meta in the local copy
    fullLocalData.meta = { ...(fullLocalData.meta || {}), ...patch };
    nextMeta = fullLocalData.meta;
  } else {
    // Fallback to localStorage for migration
    const key = `${STORAGE_PREFIX}${obsId}`;
    const rawLocal = localStorage.getItem(key);
    
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      parsed.meta = { ...(parsed.meta || {}), ...patch };
      nextMeta = parsed.meta;
      fullLocalData = parsed;
      localStorage.setItem(key, JSON.stringify(parsed));
    } else {
      // No local data, fetch from DB
      const { data, error } = await supabase
        .from("observations")
        .select("id, status, meta, indicators, created_at, updated_at, observation_date, admin_summary_vn")
        .eq("id", obsId)
        .single();

      if (!error && data) {
        nextMeta = { ...(data.meta || {}), ...patch };
        fullLocalData = {
          id: data.id,
          meta: nextMeta,
          indicators: data.indicators || [],
          status: data.status || "draft",
          updatedAt: new Date(data.updated_at).getTime(),
          lastSync: new Date(data.updated_at).getTime(),
        };
      } else {
        console.error("[persistMerged] Could not find obs to update:", obsId);
        return {};
      }
    }
  }

  // 2. Save to Supabase
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
    return nextMeta;
  }

  // 3. Fetch the server's updated_at to sync timestamps
  const { data: updatedRow, error: fetchError } = await supabase
    .from("observations")
    .select("updated_at")
    .eq("id", obsId)
    .single();

  const serverUpdatedAt = fetchError ? Date.now() : new Date(updatedRow.updated_at).getTime();

  // 4. Update local IndexedDB with the correct timestamps
  if (fullLocalData) {
    fullLocalData.lastSync = serverUpdatedAt;
    fullLocalData.updatedAt = serverUpdatedAt;
    await set(idbKey, fullLocalData);
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

  const schoolNames = [...new Set(rawObs.map(o => o.schoolName).filter(Boolean))];
  const teacherNames = [...new Set(rawObs.map(o => o.teacherName).filter(Boolean))];

  let schoolData: any[] = [];
  let teacherData: any[] = [];

  // 1. FETCH DATA (Online vs Offline Strategy)
  if (navigator.onLine) {
    // Online: Query Supabase
    if (schoolNames.length > 0) {
      const { data } = await supabase
        .from("schools")
        .select("school_name, admin_workbook_url, admin_workbook_view_url")
        .in("school_name", schoolNames);
      schoolData = data || [];
    }
    if (teacherNames.length > 0) {
      const { data } = await supabase
        .from("teachers")
        .select("name, school_name, worksheet_url, grapeseed_id")
        .in("name", teacherNames);
      teacherData = data || [];
    }
  } else {
    // Offline: Query IndexedDB
    try {
      const allSchools = (await get<any[]>("offline_schools")) || [];
      const allTeachers = (await get<any[]>("offline_teachers")) || [];
      
      // Filter in memory (mimic the DB query)
      schoolData = allSchools.filter(s => schoolNames.includes(s.school_name));
      teacherData = allTeachers.filter(t => teacherNames.includes(t.name));
    } catch (e) {
      console.warn("Failed to load offline defaults", e);
    }
  }

  // 2. Build Maps
  let schoolMap = new Map<string, { adminUrl: string; viewUrl: string }>();
  schoolData.forEach((s: any) => {
    schoolMap.set(s.school_name, {
      adminUrl: s.admin_workbook_url,
      viewUrl: s.admin_workbook_view_url
    });
  });

  let teacherMap = new Map<string, string>(); 
  teacherData.forEach((t: any) => {
    const key = `${t.name}|${t.school_name}`; 
    teacherMap.set(key, t.worksheet_url);
  });

  // 3. Merge Defaults
  return rawObs.map(obs => {
    const sDefaults = schoolMap.get(obs.schoolName);
    const tKey = `${obs.teacherName}|${obs.schoolName}`;
    const tDefaultUrl = teacherMap.get(tKey);

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
  highlightObservationId,
  onHighlightComplete,
}) => {
  const { user } = useAuth();
  const trainerName = 
    user?.user_metadata?.full_name || 
    user?.user_metadata?.name || 
    user?.user_metadata?.display_name ||
    (user?.email ? user.email.split('@')[0] : "GrapeSEED Trainer");

  const [observations, setObservations] =
    useState<DashboardObservationRow[]>([]);
  // Stats sidebar data
  const [schoolsAll, setSchoolsAll] = useState<any[]>([]);
  const [teachersAll, setTeachersAll] = useState<any[]>([]);
  const [searchText, setSearchText] = useState("");
  const [recentMergePanel, setRecentMergePanel] =
   useState<RecentMergePanel>(null);

   const [loading, setLoading] = useState(true); // 🟢 Tracks initial cache load

// 🟢 NEW: State for the Sync Action Dashboard
// --- DashboardShell.tsx (Approx Line 420) ---
const [isActionDashboardOpen, setIsActionDashboardOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
const [isPulseLoading, setIsPulseLoading] = useState(false); // 🆕 Track background loading
const [lastPulseTime, setLastPulseTime] = useState<number | null>(null); // 🆕 Session gate
const [syncPulseResults, setSyncPulseResults] = useState<{
  newCampuses: any[];
  disabledCampuses: any[];
  classlessClasses: any[];
  nameMismatches: any[];
  newTeachers: any[];
  teacherTagIssues: any[];
  disconnectedCampuses: any[];
}>(() => {
  // 🟢 PERSISTENT INITIALIZER
  // This runs exactly once when the component first loads
  const cached = localStorage.getItem("syncPulseResults");
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.error("Failed to parse cached sync pulse results:", e);
    }
  }

  // Fallback to empty arrays if no cache exists
  return {
    newCampuses: [],
    disabledCampuses: [],
    classlessClasses: [],
    nameMismatches: [],
    newTeachers: [],
    teacherTagIssues: [],
    disconnectedCampuses: []
  };
});

const lastHighlightedRef = useRef<string | null>(null);

const [pendingObservation, setPendingObservation] = useState<DashboardObservationRow | null>(null);
const [showLoginModal, setShowLoginModal] = useState(false);


// ✅ FULL UPDATE: Unified Resolution Logic with Data Cloning & UI Cleanup
const handleResolveConflict = async (type: string, data: any) => {
  try {
    if (!user?.id) return;

    // --- 1. DATABASE UPDATES ---
    
    if (type === 'newCampus') {
      console.log("🛠 Cloning data for New Campus:", data.name);
      
      // FETCH TEMPLATE: Get parent school details from DB to clone AM/Workbook info
      const { data: templateRows } = await supabase
        .from("schools")
        .select("am_name, am_email, admin_workbook_url, admin_workbook_view_url")
        .eq("school_name", data.parent_school_name)
        .eq("trainer_id", user.id)
        .limit(1);

      // Destructure with defaults (Ensures no 'undefined' properties hit Supabase)
      const { 
        am_name = null, 
        am_email = null, 
        admin_workbook_url = null, 
        admin_workbook_view_url = null 
      } = (templateRows?.[0] || {}) as any;

      const { error } = await supabase.from("schools").insert({
        school_name: data.parent_school_name,
        campus_name: data.name,
        campus_id: data.id,
        official_code: data.official_code,
        trainer_id: user.id,
        disabled: false,
        // ✅ SOURCE: CLONED FROM DB
        am_name,
        am_email,
        admin_workbook_url,
        admin_workbook_view_url,
        // ✅ SOURCE: MAPPED FROM API
        address: data.fullAddress || null,
        admin_phone: data.phone || null
      }).select('id');

      if (error) throw error;
      alert(`✨ Successfully added ${data.name} to ${data.parent_school_name}`);
    } 
    
else if (type === 'nameMismatch') {
  // 🟢 ENHANCED LOGIC: Check if we also need to "Heal" the ID
  const updatePayload: any = { campus_name: data.api_name };
  
  if (data.needs_id) {
    updatePayload.campus_id = data.needs_id;
  }

  const { error } = await supabase.from("schools")
    .update(updatePayload)
    .eq("id", data.db_record.id).select('id');

  if (error) throw error;
  
  const msg = data.needs_id 
    ? `✅ Repaired Legacy Record! Name updated to ${data.api_name} and ID stamped.`
    : `✅ Updated name to: ${data.api_name}`;
    
  alert(msg);
}

    else if (type === 'deactivateCampus') {
       const { error } = await supabase.from("schools")
         .update({ disabled: true })
         .eq("id", data.id);
       
       if (error) throw error;
       alert("🛑 Campus deactivated.");
    }

   else if (type === 'linkCampus') {
  console.log("🔗 Attempting to Link Legacy Record...");

  // 1. Try the update first
  const { error } = await supabase.from("schools")
    .update({ 
      campus_id: data.api_item.id,
      campus_name: data.api_item.name, 
      address: data.api_item.fullAddress || null, 
      admin_phone: data.api_item.phone || null,
      disabled: false                      
    })
    .eq("id", data.db_id);

  if (error) {
    // 2. Handle Unique Constraint Conflict (Test 1)
    if (error.code === '23505') {
      const confirmDelete = window.confirm(
        `A campus named "${data.api_item.name}" already exists.\n\n` +
        `To link this record, the existing duplicate must be removed. ` +
        `Would you like to DELETE the old record and proceed?`
      );

      if (confirmDelete) {
        // User said YES: Delete the duplicate and try again
        await supabase.from("schools")
          .delete()
          .eq("trainer_id", user.id) // 👈 Changed from userId to user.id
          .eq("campus_name", data.api_item.name);

        // Retry the update now that the path is clear
        await supabase.from("schools")
          .update({ 
            campus_id: data.api_item.id,
            campus_name: data.api_item.name,
            disabled: false 
          })
          .eq("id", data.db_id);

        alert("✅ Duplicate removed and record linked successfully!");
      } else {
        return; // User said NO: Exit safely
      }
    } else {
      throw error;
    }
  } else {
    alert(`🔗 Linked successfully! Record updated to ${data.api_item.name}`);
  }
}

else if (type === 'deactivateCampus') {
  console.log("🗑️ Deactivating Ghost Campus...");
  
  // We simply set disabled to true in the DB
  const { error } = await supabase
    .from("schools")
    .update({ disabled: true })
    .eq("id", data.id);

  if (error) throw error;
  alert(`🗑️ "${data.campus_name}" has been deactivated.`);
}

// --- DashboardShell.tsx (Inside handleResolveConflict) ---

// --- DashboardShell.tsx (Approx Line 520) ---
else if (type === 'newTeacher') {
  console.log("👤 Surgically Syncing Teacher:", data.name);
  
  const response = await fetch(`${MERGE_SERVER_BASE}/api/sync-surgical`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      userId: user.id, 
      teacherData: data
      // 🆕 Token is no longer passed from here!
    })
  });

  if (!response.ok) throw new Error("Surgical Sync failed");
  alert(`👤 ${data.name} has been added to the database!`);
}

// Inside handleResolveConflict...
else if (type === 'teacherTagIssue') {
  console.log("🏷️ Fixing tags for:", data.name);
  const response = await fetch(`${MERGE_SERVER_BASE}/api/sync-surgical`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      userId: user.id, 
      teacherData: {
        grapeseed_id: data.gseed_id, // Ensure server sends gseed_id
        name: data.name,
        school_id: data.school_id, // Needed for surgical sync
        // ... include other necessary fields
      }
    })
  });
  if (!response.ok) throw new Error("Tag Re-Sync failed");
  alert(`🏷️ Tags for ${data.name} have been updated!`);
}


    // --- 2. UI CLEANUP SECTION ---
    
    setSyncPulseResults(prev => {
      // Map the resolve type to the correct array in our state
    const listKey = 
    type === 'newCampus' ? 'newCampuses' : 
    type === 'deactivateCampus' ? 'disabledCampuses' : 
    type === 'linkCampus' ? 'disconnectedCampuses' : 
    type === 'newTeacher' ? 'newTeachers' : 
    type === 'teacherTagIssue' ? 'teacherTagIssues' : // 🆕 Added
    'nameMismatches';

      return {
        ...prev,
        [listKey]: (prev as any)[listKey].filter((item: any) => {
          /* 🛑 CRITICAL FIX FOR ISSUE #1:
             Name mismatches and Disconnected items nest the ID differently.
             New Campuses and Deactivations have the ID at the top level.
          */
          let itemId, resolvedId;
          
        if (type === 'nameMismatch') {
              itemId = item.db_record.id;
              resolvedId = data.db_record.id;
            } else if (type === 'linkCampus') {
              itemId = item.db_record.id;
              resolvedId = data.db_id;
            } else if (type === 'newTeacher') {
              // 🆕 TEACHER CLEANUP FIX
              itemId = item.grapeseed_id;
              resolvedId = data.grapeseed_id;
            } else {
              itemId = item.id;
              resolvedId = data.id;
            }
          
          return itemId !== resolvedId;
        })
      };
    });

  } catch (err) {
    console.error("Resolution Error:", err);
    alert("Resolution failed: " + (err as any).message);
  }
};

// ✅ BRIDGE: Calls your existing server-side Pulse Engine
const runSyncPulse = async () => {
  if (!user?.id) return;

  try {
    // 1. Show the user something is happening
    console.log("📡 Calling /api/pulse-audit...");
    
    // 2. Call the endpoint you ALREADY HAVE in your server file
    const response = await fetch(`${MERGE_SERVER_BASE}/api/pulse-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    if (!response.ok) throw new Error("Audit failed");

    // 3. Get the results (newCampuses, nameMismatches, etc.)
    const auditData = await response.json();
    // 4. Load the gun (State) and pull the trigger (Modal)
    setSyncPulseResults(auditData);
    setIsActionDashboardOpen(true);
    // 🟢 NEW: Manual trigger also updates the cache
  localStorage.setItem("syncPulseResults", JSON.stringify(auditData));

  } catch (err) {
    console.error("Pulse Check Failed:", err);
    alert("Could not run Pulse Audit. Check console.");
  }
};


const handleCheckPulseSilent = useCallback(async () => {
  const storedPulse = localStorage.getItem("lastPulseTime");
  const lastPulseTs = storedPulse ? parseInt(storedPulse) : 0;
  const timeSinceLastPulse = Date.now() - lastPulseTs;
  const pulseInterval = 3600000; // 60 minutes
  
  const isFresh = timeSinceLastPulse < pulseInterval;

  if (!user?.id || !navigator.onLine || isFresh || isPulseLoading) {
    if (isFresh && !isPulseLoading) {
        // 🟢 DEBUG LOG: Tells you exactly why it's NOT running
        const minsRemaining = Math.ceil((pulseInterval - timeSinceLastPulse) / 60000);
        console.log(`🕵️ Watchman: Audit is fresh. Next background check in ~${minsRemaining} mins. Skipping fetch.`);
    }
    return;
  }

  setIsPulseLoading(true);
  console.log("🕵️ Background Watchman: Persistent gate open. Starting scheduled audit...");

  try {
    const response = await fetch(`${MERGE_SERVER_BASE}/api/pulse-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id })
    });
    
    if (response.ok) {
      const data = await response.json();
      const now = Date.now();

      setSyncPulseResults(data);
      setLastPulseTime(now); 

    // 🟢 NEW: Save BOTH the time and the results
      localStorage.setItem("lastPulseTime", now.toString()); 
      localStorage.setItem("syncPulseResults", JSON.stringify(data));
      
      console.log("🕵️ Background Watchman: Audit complete. Persistence locked for 60 mins.");
    }
  } catch (err) {
    console.warn("Silent Pulse failed:", err);
  } finally {
    setIsPulseLoading(false);
  }
}, [user?.id, isPulseLoading]);
// The Auto-Trigger

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const importedData = JSON.parse(text);

      // Handle both single observation and array
      const observationsToImport = Array.isArray(importedData) ? importedData : [importedData];

      for (const obs of observationsToImport) {
        if (!obs.id) continue;

        // Check if already exists (optional prompt)
        const existing = await get(`${STORAGE_PREFIX}${obs.id}`);
        if (existing) {
          if (!confirm(`Observation ${obs.id} already exists. Overwrite?`)) continue;
        }

        // Save to IndexedDB
        await set(`${STORAGE_PREFIX}${obs.id}`, obs);
      }

      alert(`Imported ${observationsToImport.length} observation(s). Refreshing...`);
      window.location.reload(); // simple refresh to show new data
    } catch (err) {
      console.error('Import error', err);
      alert('Invalid backup file. Please select a valid JSON export.');
    } finally {
      setImporting(false);
      // Reset file input
      e.target.value = '';
    }
  };

React.useEffect(() => {
  handleCheckPulseSilent();
}, [handleCheckPulseSilent]);

// Fetch schools & teachers for stats sidebar
React.useEffect(() => {
  if (!user?.id) return;
  const loadResources = async () => {
    // Schools
          const { data: sData } = await supabase
        .from("schools")
        .select("school_name, campus_name, disabled, exclusive, visit_count")
        .eq("trainer_id", user.id);
    if (sData) setSchoolsAll(sData);

    // Teachers
    const { data: tData } = await supabase
      .from("teachers")
      .select("name, school_name, campus, tags, needs_review, latest_performance, grapeseed_id")
      .eq("trainer_id", user.id);
    if (tData) setTeachersAll(tData);
  };
  loadResources();
}, [user?.id]);


const [trainerSettings, setTrainerSettings] = React.useState<{
    booking_url?: string;
    phone_number?: string;
  } | null>(null);

  // Fetch settings when user logs in
  React.useEffect(() => {
    if (!user?.id) return; // ✅ Safety check on ID
    const fetchSettings = async () => {
      const { data } = await supabase
        .from("trainer_settings")
        .select("booking_url, phone_number")
        .eq("trainer_id", user.id)
        .single();
      if (data) setTrainerSettings(data);
    };
    fetchSettings();
  }, [user?.id]); // ✅ FIXED: Changed [user] to [user?.id]

// 🟢 START: Cache Teachers & Schools for Offline Mode 🟢
  // This runs automatically in the background when the user is online.
  React.useEffect(() => {
    // 1. Exit if offline or no user
    if (!user?.id || !navigator.onLine) return;

    const cacheOfflineResources = async () => {
      // 🟢 OPTIMIZATION: Check if we already have data to prevent iPad lag on reload
      const existingSchools = await get("offline_schools");
      if (existingSchools && existingSchools.length > 0) {
        console.log("📱 Cache exists. Skipping background sync to save resources.");
        return; 
      }

      try {
        // 2. Fetch Schools (Strictly Filtered by Trainer ID)
        // Note: If RLS is enabled on Supabase, this will return [] unless a policy exists!
        const { data: schools, error: sError } = await supabase
          .from("schools")
          .select("id, school_name, campus_name, admin_workbook_url, admin_workbook_view_url, trainer_id")
          .eq("trainer_id", user.id)
          .order("school_name");

        if (sError) throw sError;

        const safeSchools = schools || [];
        console.log(`🔥 Fetched ${safeSchools.length} schools from database.`);

        // 3. Save to Offline Cache (Overwrites old data)
        await set("offline_schools", safeSchools);

        // 4. Fetch Teachers (Only if we have schools)
        // This prevents leaking teachers (and thus schools) from the Owner
        if (safeSchools.length > 0) {
            const mySchoolNames = safeSchools.map(s => s.school_name);
            
            const { data: teachers, error: tError } = await supabase
              .from("teachers")
              .select("id, grapeseed_id, name, school_name, campus, email, worksheet_url")
              .in("school_name", mySchoolNames) // 🟢 Only fetch teachers for MY schools
              .order("name");
            
            if (!tError) {
              await set("offline_teachers", teachers || []); 
              console.log(`🔥 Fetched ${teachers?.length || 0} teachers.`);
            }
        } else {
            // If I have no schools, I should have no teachers in the cache
            console.warn("⚠️ No schools found for this user. Offline list may revert to default/owner list.");
            await set("offline_teachers", []);
        }

        console.log("✅ Offline resources updated successfully.");
      } catch (err) {
        console.warn("⚠️ Failed to cache offline resources:", err);
      }
    };

    cacheOfflineResources();
  }, [user?.id]); 
  // 🟢 END BLOCK 🟢

  
// NEW: State for tracking Merge process status (Add these two lines)
const [mergingTeacherId, setMergingTeacherId] = useState<string | null>(null);
const [showPerformanceModal, setShowPerformanceModal] = useState(false);
const [pendingSyncObs, setPendingSyncObs] = useState<DashboardObservationRow | null>(null);
const [recentlyDeletedIds, setRecentlyDeletedIds] = useState<Set<string>>(new Set());
const [mergingAdminId, setMergingAdminId] = useState<string | null>(null);
const [syncingObservationId, setSyncingObservationId] = useState<string | null>(null);

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
// Bulk admin modal state
  const [showBulkAdminModal, setShowBulkAdminModal] = useState(false);
  const [bulkSchool, setBulkSchool] = useState<string>("");
  const [bulkMonth, setBulkMonth] = useState<string>("");
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMerging, setBulkMerging] = useState(false);
  const [bulkMergeProgress, setBulkMergeProgress] = useState<{ current: number; total: number; currentTeacher?: string }>({ current: 0, total: 0 });

  const [summaryMonth, setSummaryMonth] = useState<string>("");
  const [summaryAmKey, setSummaryAmKey] = useState<string>("");
  const [summaryRows, setSummaryRows] = useState<AmSummaryRow[]>([]);
  const [amSummarySentMap, setAmSummarySentMap] =
    useState<AmSummarySentMap>({});

  
    
 // Helper to merge Server Cache + Local Offline Files
async function getMergedDashboardData(userId: string) {
  // 1. Get the last known list from the server (The "Catalog")
  const serverCache = (await get('dashboard-cache')) || [];

  // 2. Scan for ALL local files we created/edited (The "Books on the shelf")
  const allKeys = await keys();
  const observationKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith('obs-v1-')
  );

  // 3. Load the actual data for these local files
  const localFiles = await Promise.all(observationKeys.map((k) => get(k)));

  // 4. Format local files to look like database rows
  const formattedLocalRows = localFiles.map((obs: any) => ({
    id: obs.id,
    teacher_name: obs.meta.teacherName,
    school_name: obs.meta.schoolName,
    campus: obs.meta.campus,
    unit: obs.meta.unit,
    lesson: obs.meta.lesson,
    support_type: obs.meta.supportType,
    observation_date: obs.meta.date,
    status: obs.status,
    updated_at: new Date(obs.updatedAt).toISOString(),
    created_at: new Date(obs.updatedAt).toISOString(), // Fallback
    is_offline_copy: true, // 🟢 Flag so we can show an icon
  }));

  // 5. Merge! (Local files overwrite Server files if IDs match)
  const combinedMap = new Map();
  
  // Add server items first
  serverCache.forEach((item: any) => combinedMap.set(item.id, item));
  
  // Overwrite/Add local items
  formattedLocalRows.forEach((item: any) => combinedMap.set(item.id, item));

  // Convert back to array and sort by date
  return Array.from(combinedMap.values()).sort(
    (a: any, b: any) => new Date(b.observation_date).getTime() - new Date(a.observation_date).getTime()
  );
}   

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
    // .trim() removes spaces from start/end; .ilike makes it case-insensitive
    const { data } = await supabase
      .from("teachers")
      .select("email")
      .ilike("name", teacherName.trim())
      .ilike("school_name", schoolName.trim())
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
            setSyncingObservationId(id);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("You must be logged in to sync.");
        return;
      }

      // 1. LOAD DATA
      let localData = overrideData;
      if (!localData) {
         const storageKey = `${STORAGE_PREFIX}${id}`;
         localData = await get(storageKey);
      }
      
      if (!localData) {
        console.log("No local changes found. Fetching latest from server to verify...");
        window.location.reload(); 
        return;
      }

            // 🟢 GUARDRAIL: PERFORMANCE RATING – show modal instead of redirecting
      if (!localData.performance_rating) {
        const obsRow = observations.find(o => o.id === id);
        setPendingSyncObs(obsRow || null);
        setShowPerformanceModal(true);
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
          const localLastSync = localData.lastSync || 0;

          if (serverTime > localLastSync) {
             console.log("⚔️ Conflict Detected! Server is newer.");
             setConflictLocalData(localData);
             setConflictServerData(serverRow);
             setIsConflictModalOpen(true);
             return; 
          }
        }
      } else {
        console.log("🛡️ Force Push enabled. Skipping server conflict check.");
      }

      // 3. PUSH TO SERVER
      console.log("🚀 No conflict. Pushing data...");
      
      const safeMeta = localData.meta || {
        teacherName: localData.teacherName || "",
        schoolName: localData.schoolName || "",
        campus: localData.campus || "",
        unit: localData.unit || "",
        lesson: localData.lesson || "",
        supportType: localData.supportType || "Visit",
        date: localData.date || new Date().toISOString()
      };

      // 🟢 FIX 1: Robust Teacher ID Extraction
      // Checks: Root -> Meta -> Legacy camelCase
      const finalTeacherId = 
        localData.teacher_id || 
        safeMeta.teacher_id || 
        localData.teacherId || 
        null;

      if (!finalTeacherId) {
        console.warn("⚠️ Warning: Syncing observation without a valid teacher_id");
      }

      // 🟢 FIX 2: Grapeseed ID Extraction
      const finalGsId = 
        localData.grapeseed_id || 
        safeMeta.grapeseed_id || 
        null;
      
      const payload = {
        id: localData.id,
        trainer_id: user.id, 
        
        // 🟢 MAPPED CORRECTLY
        teacher_id: finalTeacherId,
        grapeseed_id: finalGsId, // Saves to the new column

        teacher_name: safeMeta.teacherName,
        school_name: safeMeta.schoolName,
        campus: safeMeta.campus,
        unit: safeMeta.unit,
        lesson: safeMeta.lesson,
        support_type: safeMeta.supportType,
        observation_date: safeMeta.date,

        meta: { 
            ...safeMeta, 
            teacher_id: finalTeacherId, // Ensure meta stays in sync
            grapeseed_id: finalGsId 
        },

        indicators: localData.indicators,
        status: localData.status,
        updated_at: new Date(localData.updatedAt || Date.now()).toISOString(),
        admin_summary_vn: localData.adminSummaryVN,
        performance_rating: localData.performance_rating || null,
      };

      const { error } = await supabase.from("observations").upsert(payload).select('id');
      
      if (error) {
        console.error("Supabase Error Details:", error);
        throw error;
      }

      // 🟢 NEW: CRM BROADCAST
      const flaggedIndicators = (localData.indicators || [])
        .filter((ind: any) => ind.includeInTrainerSummary)
        .map((ind: any) => ind.title);

      if (finalGsId) {
        const { error: rpcError } = await supabase.rpc('sync_teacher_crm_metadata', {
          target_grapeseed_id: finalGsId,
          new_performance: localData.performance_rating || null,
          flagged_indicators: flaggedIndicators
        });
        if (rpcError) console.error("CRM Broadcast failed:", rpcError);
      }

// 4. FETCH THE SERVER’S UPDATED_AT (source of truth)
// 4. FETCH THE SERVER’S UPDATED_AT (source of truth)
const { data: updatedRow, error: fetchError } = await supabase
  .from("observations")
  .select("updated_at")
  .eq("id", localData.id)
  .single();

const serverUpdatedAt = fetchError ? Date.now() : new Date(updatedRow.updated_at).getTime();

// 5. STAMP RECEIPT USING SERVER TIME
const storageKey = `${STORAGE_PREFIX}${localData.id}`;
const finalPayload = {
  ...localData,
  teacher_id: finalTeacherId,
  grapeseed_id: finalGsId,
  meta: { ...localData.meta, teacher_id: finalTeacherId, grapeseed_id: finalGsId },
  lastSync: serverUpdatedAt,
  updatedAt: serverUpdatedAt   // both equal, no drift
};
await set(storageKey, finalPayload);

// 6. Refresh the whole dashboard to ensure UI matches the fresh IndexedDB data
await refreshDashboard();
// Force correct rawDate for this observation from meta.date
const obsRow = observations.find(o => o.id === id);
if (obsRow && obsRow.isoDate) {
  const correctTs = new Date(obsRow.isoDate).getTime();
  if (!isNaN(correctTs)) {
    setObservations(prev => prev.map(o => 
      o.id === id ? { ...o, rawDate: correctTs, dateLabel: new Date(correctTs).toLocaleDateString() } : o
    ));
  }
}

console.log("✅ Sync Complete and dashboard refreshed!");

    } catch (err: any) {
      console.error("Sync failed:", err);
      alert("Sync failed: " + err.message);
    } finally {
      setSyncingObservationId(null);
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


// 🟢 CORE LOGIC: CACHE-FIRST LOADING + GHOST MERGE
  React.useEffect(() => {
    if (!user?.id) { setObservations([]); return; }

    const load = async () => {
      const processAndDisplay = async (sourceData: any[], isNetworkSource: boolean) => {
        const rows: DashboardObservationRow[] = [];
        const processedIds = new Set<string>();
        const pendingDeletes = (await get<string[]>("pending_deletes")) || [];

        // --- PHASE A: PROCESS SERVER/CACHE ROWS ---
        for (const dbRow of sourceData) {
          if (pendingDeletes.includes(dbRow.id)) continue;
          if (recentlyDeletedIds.has(dbRow.id)) continue;
          processedIds.add(dbRow.id);

          const storageKey = `${STORAGE_PREFIX}${dbRow.id}`;
          let parsed: any = null;
          try {
            const localDraft = await get<any>(storageKey);
            if (localDraft) parsed = localDraft;
            else {
               const rawLocal = localStorage.getItem(storageKey);
               if (rawLocal) parsed = JSON.parse(rawLocal);
            }
          } catch (err) { console.error("Error parsing local data", err); }

          if (!parsed) {
            const dbTime = dbRow.updated_at ? new Date(dbRow.updated_at).getTime() : Date.now();
            parsed = {
              id: dbRow.id,
              meta: dbRow.meta ?? {},
              indicators: dbRow.indicators ?? [],
              status: dbRow.status ?? "draft",
              updatedAt: dbTime,
              lastSync: dbTime, 
            };
          }

        // 🟢 FIX 3 (Edit Zombie): "Trust The Receipt"
          const localUpdatedAt = parsed.updatedAt || 0;
          const lastSync = parsed.lastSync || 0;
          const dbUpdatedAt = dbRow.updated_at ? new Date(dbRow.updated_at).getTime() : 0;
          
          // Increased to 10s to absorb Windows PC system clock drift
          const BUFFER = 10000; 
          
          let syncStatus: 'synced' | 'local-changes' | 'server-newer';
           
          if (localUpdatedAt > lastSync) {
            // Local changes always win
            syncStatus = 'local-changes';
          } else if (dbUpdatedAt > (lastSync + BUFFER)) {
            // Server changed AFTER last successful sync + buffer allowance
            syncStatus = 'server-newer';
          } else {
            syncStatus = 'synced';
          }

          // Stats
          const indicatorsArray = Array.isArray(parsed.indicators) ? parsed.indicators : [];
          const total = indicatorsArray.length;
          let good = 0, growth = 0, progress = 0;
          indicatorsArray.forEach((ind: any) => {
            if (ind.good || ind.growth || ind.commentText?.trim()) progress++;
            if (ind.good) good++;
            if (ind.growth) growth++;
          });
          let statusColor: StatusColor = (growth > 0 && good === 0) ? "growth" : (good > 0 && growth === 0) ? "good" : "mixed";

          // Date
          let rawDate = parsed.updatedAt || Date.now();
          let displayDate = new Date(rawDate).toLocaleDateString();
          if (parsed.meta?.date) {
             const ts = safeParseTimestamp(parsed.meta.date);
             if (ts) { rawDate = ts; displayDate = new Date(ts).toLocaleDateString(); }
          }

          rows.push({
            id: parsed.id,
            teacherName: parsed.meta.teacherName || "Unknown",
            schoolName: parsed.meta.schoolName || "Unknown",
            campus: parsed.meta.campus || "",
            unit: parsed.meta.unit || "",
            lesson: parsed.meta.lesson || "",
            supportType: parsed.meta.supportType || "Visit",
            dateLabel: displayDate,
            isoDate: parsed.meta?.date,
            rawDate,
            status: parsed.status ?? "draft",
            progress,
            totalIndicators: total,
            statusColor,
            teacherWorkbookUrl: parsed.meta.teacherWorkbookUrl ?? null,
            adminWorkbookUrl: parsed.meta.adminWorkbookUrl ?? null,
            adminViewOnlyUrl: parsed.meta.adminViewOnlyUrl ?? null,
            admin_summary_vn: dbRow.admin_summary_vn,
            syncStatus,
            meta: parsed.meta ?? {},
            lastSync: parsed.lastSync || 0,
            updatedAt: parsed.updatedAt || 0,
          });
        }

      // --- PHASE B: SCAN LOCAL FILES (GHOSTS) ---
        try {
          const allKeys = await keys();
          const sourceIdSet = new Set(sourceData.map((d) => d.id));
          const ghostsFound: string[] = []; 

          const keysToFetch = allKeys.filter((k) => {
            if (typeof k !== "string" || !k.startsWith(STORAGE_PREFIX)) return false;
            const id = k.replace(STORAGE_PREFIX, "");
            if (processedIds.has(id)) return false; 
            if (pendingDeletes.includes(id)) return false; 
            return true;
          });

          const offlineFiles = await Promise.all(keysToFetch.map((key) => get<any>(key)));

          for (const localData of offlineFiles) {
            if (!localData) continue;

            const isMissingFromSource = !sourceIdSet.has(localData.id);
            
            // 🟢 FIX: Immediate Ghost Detection (No Buffer)
            if (isMissingFromSource) {
               const lastSync = localData.lastSync || 0;
               const updatedAt = localData.updatedAt || 0;
               
               // 1. Check for unsaved changes (Dirty)
               const isDirty = updatedAt > lastSync;

               // 🟢 THE CONDITION:
               // Trigger immediately if:
               // - Loading from Network
               // - WAS synced before (lastSync > 0)
               // - NO new local edits (!isDirty)
               // *Buffer removed per request*
               if (isNetworkSource && lastSync > 0 && !isDirty) {
                   ghostsFound.push(localData.id);
                   continue; // Skip adding to dashboard rows
               }
            }

            // Stats
            const indicatorsArray = Array.isArray(localData.indicators) ? localData.indicators : [];
            const stats = indicatorsArray.reduce((acc: any, ind: any) => {
               if (ind.good || ind.growth || ind.commentText?.trim()) acc.progress++;
               if (ind.good) acc.good++;
               if (ind.growth) acc.growth++;
               return acc;
             }, { good: 0, growth: 0, progress: 0 });

            let statusColor: StatusColor = (stats.growth > 0 && stats.good === 0) ? "growth" : (stats.good > 0 && stats.growth === 0) ? "good" : "mixed";

            let rawDate = localData.updatedAt || Date.now();
            let displayDate = new Date(rawDate).toLocaleDateString();
            if (localData.meta?.date) {
              const ts = safeParseTimestamp(localData.meta.date);
              if (ts) { rawDate = ts; displayDate = new Date(ts).toLocaleDateString(); }
            }

            // 🟢 FIX 4 (Resurrection Zombie): Trust Receipt for Ghosts too
            // If we just synced it (lastSync >= updatedAt), show Green immediately.
            const isLocalSynced = (localData.lastSync || 0) >= (localData.updatedAt || 0);

            rows.push({
              id: localData.id,
              teacherName: localData.meta?.teacherName || "Unknown",
              schoolName: localData.meta?.schoolName || "Unknown",
              campus: localData.meta?.campus || "",
              unit: localData.meta?.unit || "",
              lesson: localData.meta?.lesson || "",
              supportType: localData.meta?.supportType || "Visit",
              dateLabel: displayDate,
              isoDate: localData.meta?.date,
              rawDate,
              status: localData.status || "draft",
              progress: stats.progress,
              totalIndicators: indicatorsArray.length,
              statusColor,
              teacherWorkbookUrl: localData.meta?.teacherWorkbookUrl || null,
              adminWorkbookUrl: localData.meta?.adminWorkbookUrl || null,
              adminViewOnlyUrl: localData.meta?.adminViewOnlyUrl || null,
              admin_summary_vn: localData.adminSummaryVN || null,
              syncStatus: isLocalSynced ? 'synced' : 'local-changes', // 🟢 Dynamic Status
              meta: localData.meta || {},
              lastSync: localData.lastSync || 0,
              updatedAt: localData.updatedAt || 0,
            });
          }

          // Warning UI
          if (isNetworkSource && ghostsFound.length > 0 && navigator.onLine) {
             setTimeout(async () => {
               const confirmDelete = window.confirm(
                  `We found ${ghostsFound.length} observation(s) that were deleted from the server.\n\n` + 
                  `Since you haven't edited them, do you want to remove them from this device?`
               );
               
               if (confirmDelete) {
                  const currentPending = (await get<string[]>("pending_deletes")) || [];
                  await set("pending_deletes", [...new Set([...currentPending, ...ghostsFound])]);
                  await Promise.all(ghostsFound.map(id => del(`${STORAGE_PREFIX}${id}`)));
                  setObservations(prev => prev.filter(o => !ghostsFound.includes(o.id)));
               } else {
                  // 🟢 FIX 1 (Infinite Loop): Reset lastSync to 0.
                  await Promise.all(ghostsFound.map(async (id) => {
                     const key = `${STORAGE_PREFIX}${id}`;
                     const data = await get<any>(key);
                     if(data) { 
                         data.updatedAt = Date.now(); 
                         data.lastSync = 0; 
                         await set(key, data); 
                     }
                  }));
                  window.location.reload();
               }
             }, 500);
          }
        } catch (err) { console.error("Error processing local/ghost files", err); }

        // --- PHASE C: ENRICH & SET ---
        let finalRows = rows;
        try {
           finalRows = await enrichObservationsWithDefaults(rows);
        } catch (e) {}
        
        finalRows.sort((a, b) => (b.rawDate || 0) - (a.rawDate || 0));
        setObservations(finalRows);
        setLoading(false);
      };

      // 1. Instant Load
      try {
        const backup = await get<any[]>("dashboard_backup_list");
        if (backup && backup.length > 0) await processAndDisplay(backup, false);
      } catch (e) { }

      // 2. Background Sync
      try {
        let pendingDeletes = (await get<string[]>("pending_deletes")) || [];
        if (navigator.onLine && pendingDeletes.length > 0) {
           const { data: deletedRows, error } = await supabase
             .from("observations")
             .delete()
             .in("id", pendingDeletes)
             .select("id");
           if (!error && deletedRows && deletedRows.length > 0) {
             // Successfully deleted at least some
             const remaining = pendingDeletes.filter(id => !deletedRows.some((row: any) => row.id === id));
             if (remaining.length === 0) {
               await del("pending_deletes");
             } else {
               // Keep only the ones that didn't delete (maybe due to permissions)
               await set("pending_deletes", remaining);
             }
             // Also remove local files for those deleted
             await Promise.all(deletedRows.map((row: any) => del(`${STORAGE_PREFIX}${row.id}`)));
           } else if (error) {
             console.warn("Batch delete failed", error);
           }
        }

        const { data, error } = await supabase
          .from("observations")
          .select("id, status, meta, indicators, created_at, updated_at, observation_date, admin_summary_vn")
          .eq("trainer_id", user.id)
          .order("observation_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (!error && data) {
           await set("dashboard_backup_list", data);
           await processAndDisplay(data, true);
        }
      } catch (err) { console.error("Background sync failed", err); } 
      finally { setLoading(false); }

      try {
        const raw = localStorage.getItem(SUMMARY_STATE_KEY);
        if (raw) setAmSummarySentMap(JSON.parse(raw));
      } catch {}
    };

    load();
  }, [user?.id]);

  // 🟢 HELPER: Process & Merge Logic (Extracting this makes the useEffect cleaner)
async function processRows(dbRows: any[], pendingDeletes: string[]) {
    const processedIds = new Set<string>();
    const rows: DashboardObservationRow[] = [];

    // Step A: Process Server Rows
    for (const row of dbRows) {
        if (pendingDeletes.includes(row.id)) continue;
        if (recentlyDeletedIds.has(row.id)) continue;
        processedIds.add(row.id);

        const storageKey = `${STORAGE_PREFIX}${row.id}`;
        let localData = await get<any>(storageKey);
        
        // Fallback to localStorage if IDB fails
        if (!localData) {
            try { const raw = localStorage.getItem(storageKey); if (raw) localData = JSON.parse(raw); } catch {}
        }

        // Merge: Local wins if exists
        const finalData = localData || {
           id: row.id,
           meta: row.meta || {},
           indicators: row.indicators || [],
           status: row.status || "draft",
           updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
           lastSync: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        };

        // Calc Sync Status (Standardized with processAndDisplay)
        const localTime = finalData.updatedAt || 0;
        const lastSync = finalData.lastSync || 0;
        const serverTime = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        const BUFFER = 10000; // 10s buffer for Windows clock drift
        
        let syncStatus = 'synced';
        if (localTime > lastSync) {
          syncStatus = 'local-changes';
        } else if (serverTime > (lastSync + BUFFER)) {
          syncStatus = 'server-newer';
        }

        // Stats Calculation
        const inds = Array.isArray(finalData.indicators) ? finalData.indicators : [];
        let good = 0, growth = 0, progress = 0;
        inds.forEach((i: any) => {
           if (i.good) good++;
           if (i.growth) growth++;
           if (i.good || i.growth || i.commentText) progress++;
        });
        const statusColor = (growth > 0 && good === 0) ? "growth" : (good > 0 && growth === 0) ? "good" : "mixed";

        rows.push({
           id: finalData.id,
           teacherName: finalData.meta.teacherName || "Unknown",
           schoolName: finalData.meta.schoolName || "Unknown",
           campus: finalData.meta.campus || "",
           unit: finalData.meta.unit || "",
           lesson: finalData.meta.lesson || "",
           supportType: finalData.meta.supportType || "Visit",
           dateLabel: new Date(finalData.updatedAt).toLocaleDateString(),
           isoDate: finalData.meta.date,
           rawDate: finalData.updatedAt,
           status: finalData.status,
           progress, 
           totalIndicators: inds.length,
           statusColor: statusColor as StatusColor,
           teacherWorkbookUrl: finalData.meta.teacherWorkbookUrl,
           adminWorkbookUrl: finalData.meta.adminWorkbookUrl,
           adminViewOnlyUrl: finalData.meta.adminViewOnlyUrl,
           admin_summary_vn: row.admin_summary_vn,
           meta: finalData.meta,
           lastSync: finalData.lastSync,
           updatedAt: finalData.updatedAt,
           syncStatus
        });
    }

    // Step B: Ghost Loop (Find Local-Only items)
    try {
        const allKeys = await keys();
        const obsKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(STORAGE_PREFIX));
        for (const k of obsKeys) {
            const id = (k as string).replace(STORAGE_PREFIX, "");
            // If server didn't send it, and we didn't delete it -> It's a Ghost
            if (processedIds.has(id) || pendingDeletes.includes(id)) continue;
            
            const local = await get<any>(k);
            if (!local) continue;

            rows.push({
               id: local.id,
               teacherName: local.meta.teacherName || "Unknown",
               schoolName: local.meta.schoolName || "Unknown",
               campus: local.meta.campus || "",
               unit: local.meta.unit, lesson: local.meta.lesson,
               supportType: local.meta.supportType,
               dateLabel: new Date(local.updatedAt).toLocaleDateString(),
               isoDate: local.meta.date,
               rawDate: local.updatedAt,
               status: local.status || "draft",
               progress: 0, totalIndicators: 0, statusColor: "mixed",
               teacherWorkbookUrl: local.meta.teacherWorkbookUrl,
               adminWorkbookUrl: local.meta.adminWorkbookUrl,
               adminViewOnlyUrl: null, admin_summary_vn: null,
               meta: local.meta,
               lastSync: 0, updatedAt: local.updatedAt, 
               syncStatus: 'local-changes' // Force Blue Cloud
            });
        }
    } catch(e) {}

    // Enrich with School Data
    return await enrichObservationsWithDefaults(rows);
  }
  // 🟢 NEW: Refresh the dashboard data from the latest IndexedDB and Supabase
  const refreshDashboard = useCallback(async () => {
    if (!user?.id) return;
    try {
      const pendingDeletes = (await get<string[]>("pending_deletes")) || [];
      const { data, error } = await supabase
        .from("observations")
        .select("id, status, meta, indicators, created_at, updated_at, observation_date, admin_summary_vn")
        .eq("trainer_id", user.id)
        .order("observation_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (!error && data) {
        await set("dashboard_backup_list", data);
        const rows = await processRows(data, pendingDeletes);
        setObservations(rows);
      }
    } catch (err) {
      console.warn("Dashboard refresh failed", err);
    }
  }, [user?.id]);

  /* ------------------------------
      FILTER + SORT + GROUP
  --------------------------------- */
const stats = React.useMemo(() => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0‑based
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  // --- Schools breakdown ---
  const exclusiveSchools = new Set<string>();
  const sharedSchools = new Set<string>();
  (schoolsAll as Array<{ school_name: string; campus_name: string; disabled: boolean; exclusive: string | null }>).forEach(s => {
    if (!s.disabled) {
      if (s.exclusive === 'exclusive') exclusiveSchools.add(s.school_name);
      else if (s.exclusive === 'shared') sharedSchools.add(s.school_name);
    }
  });

  // --- Teachers (active + mutual) ---
  type TeacherStatsRow = { name: string; school_name: string; campus: string; tags: string[] | null; needs_review: boolean; latest_performance: string | null; grapeseed_id: string | null };

  const campusExclusive = new Map<string, string | null>();
  (schoolsAll as Array<{ school_name: string; campus_name: string; exclusive: string | null }>).forEach(s => {
    const key = `${s.school_name}||${s.campus_name}`;
    campusExclusive.set(key, s.exclusive);
  });

  let activeTeachersCount = 0;
  let mutualTeachersCount = 0;
  let thriving = 0, functioning = 0, developing = 0;
    (teachersAll as TeacherStatsRow[]).forEach(t => {
    const tags: string[] = Array.isArray(t.tags) ? t.tags : [];
    const isInactive = tags.some((tag: string) => tag.toLowerCase() === 'inactive');
    if (isInactive || t.needs_review) return;

    const key = `${t.school_name}||${t.campus}`;
    const exclusive = campusExclusive.get(key);
    if (exclusive === 'exclusive' || exclusive === 'shared') {
      // Mutual check (same logic as TeachersScreen)
      const otherTags = tags.filter((tag: string) => tag !== 'No tag' && tag.toLowerCase() !== 'inactive');
      if (otherTags.length > 0) {
        mutualTeachersCount++;
      } else {
        // Only increment active count for non-mutual, solo teachers
        activeTeachersCount++;
      }

      // Performance (count for all active, including mutual)
      if (t.latest_performance === 'Thriving') thriving++;
      else if (t.latest_performance === 'Functioning') functioning++;
      else if (t.latest_performance === 'Developing') developing++;
    }
  });

  const totalForPerf = thriving + functioning + developing;
  const perfPct = (val: number) => totalForPerf > 0 ? Math.round((val / totalForPerf) * 100) : 0;

  // --- Observations this month ---
  const visitedSchools = new Set<string>();
  const visitedTeachers = new Set<string>();
  let lvaCount = 0;

  observations.forEach(o => {
    const iso = o.isoDate;
    if (!iso || !iso.startsWith(monthStr)) return;
    if (o.supportType === 'Visit') {
      visitedSchools.add(o.schoolName);
      visitedTeachers.add(o.teacherName);
    } else if (o.supportType === 'LVA') {
      lvaCount++;
    }
  });

  // Sum visit_count for active exclusive & shared schools
  let totalVisitCount = 0;
  (schoolsAll as Array<{ disabled: boolean; exclusive: string | null; visit_count: number | null }>).forEach(s => {
    if (!s.disabled && (s.exclusive === 'exclusive' || s.exclusive === 'shared')) {
      totalVisitCount += Number(s.visit_count) || 0;
    }
  });

  return {
    year,
    month: now.toLocaleString('default', { month: 'long' }),
    exclusiveSchools: exclusiveSchools.size,
    sharedSchools: sharedSchools.size,
    activeTeachers: activeTeachersCount,
    mutualTeachers: mutualTeachersCount,
    totalVisitCount,
    visitedSchools: visitedSchools.size,
    visitedTeachers: visitedTeachers.size,
    lvaCount,
    thriving: { count: thriving, pct: perfPct(thriving) },
    functioning: { count: functioning, pct: perfPct(functioning) },
    developing: { count: developing, pct: perfPct(developing) },
  };
}, [schoolsAll, teachersAll, observations]);
const filteredAndSorted = React.useMemo(() => {
    const flattenText = (text: string | null | undefined): string => {
      if (!text) return "";
      return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .trim();
    };

    let list = [...observations];

    // Search logic
    const q = searchText.trim().toLowerCase();
    if (q) {
      const flattenedQuery = flattenText(q);
      const searchWords = flattenedQuery.split(/\s+/);
      list = list.filter((o) => {
        const targetName = flattenText(o.teacherName);
        const targetSchool = flattenText(o.schoolName);
        const targetCampus = flattenText(o.campus);
        const combinedTarget = `${targetName} ${targetSchool} ${targetCampus}`;
        return searchWords.every(word => combinedTarget.includes(word));
      });
    }

    // Always sort by newest (rawDate descending)
    list.sort((a, b) => (b.rawDate ?? 0) - (a.rawDate ?? 0));

    return list;
  }, [observations, searchText]);
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

// Handler for saving edited metadata (No Auto-Sync, just marks as 'Push Needed')
const handleSaveEditedObservation = useCallback(async (id: string, updatedMeta: Partial<DashboardObservationRow['meta']>) => {
  const storageKey = `${STORAGE_PREFIX}${id}`;
  
  // 1. Try to get the Current Full Data from IDB (The "Local File")
  let currentData = await get<any>(storageKey);

  // 2. FALLBACK: If not in IDB, try to find it in the "Backup List" (Server Cache)
  // This fixes the "Error: Could not find observation" when editing a fresh server item
  if (!currentData) {
    try {
      const backupList = (await get<any[]>("dashboard_backup_list")) || [];
      const backupItem = backupList.find((item) => item.id === id);
      
      if (backupItem) {
        currentData = {
          id: backupItem.id,
          meta: backupItem.meta || {},
          indicators: backupItem.indicators || [], // Critical: Don't lose indicators!
          status: backupItem.status || "draft",
          updatedAt: backupItem.updated_at ? new Date(backupItem.updated_at).getTime() : Date.now(),
          lastSync: backupItem.updated_at ? new Date(backupItem.updated_at).getTime() : 0,
        };
      }
    } catch (e) {
      console.warn("Failed to check backup list", e);
    }
  }

  // 3. FALLBACK: If still missing and Online, fetch specific row from Supabase
  if (!currentData && navigator.onLine) {
    try {
       const { data, error } = await supabase.from("observations").select("*").eq("id", id).single();
       if (data && !error) {
          currentData = {
             ...data,
             updatedAt: new Date(data.updated_at).getTime(),
             lastSync: new Date(data.updated_at).getTime(),
          };
       }
    } catch (e) {}
  }

  // 4. Safety Abort
  if (!currentData) {
     alert("Error: Could not find the full observation data to save.\n\nTry refreshing the page.");
     return;
  }

  // 5. Prepare the Update (Mark as Dirty)
  // 🟢 FIX: Ensure 'now' is strictly greater than lastSync, even if the Windows PC clock 
  // is lagging behind the server time pulled during the fallbacks above.
  const rawNow = Date.now();
  const safeLastSync = currentData.lastSync || 0;
  const now = Math.max(rawNow, safeLastSync + 1000); 

  const updatedData = {
     ...currentData,
     meta: {
        ...currentData.meta,
        ...updatedMeta
     },
     // Update top-level fields for sorting/searching
     teacherName: updatedMeta.teacherName ?? currentData.teacherName ?? currentData.meta.teacherName,
     schoolName: updatedMeta.schoolName ?? currentData.schoolName ?? currentData.meta.schoolName,
     campus: updatedMeta.campus ?? currentData.campus ?? currentData.meta.campus,
     unit: updatedMeta.unit ?? currentData.unit ?? currentData.meta.unit,
     lesson: updatedMeta.lesson ?? currentData.lesson ?? currentData.meta.lesson,
     supportType: updatedMeta.supportType ?? currentData.supportType ?? currentData.meta.supportType,
     
     // 🟢 CRITICAL: This triggers the "Sync Now" button
     updatedAt: now, 
     // Do NOT update lastSync yet! (lastSync < updatedAt = Blue Button)
     syncStatus: 'local-changes' 
  };

  // 6. Save to IndexedDB (Creates the physical "Local File" so Phase 3 sees it)
  await set(storageKey, updatedData);

  // 7. Update UI Instantly (Turn button blue immediately)
  setObservations(prev =>
    prev.map(obs =>
      obs.id === id
        ? { 
            ...obs, 
            ...updatedData, 
            dateLabel: new Date(updatedData.updatedAt).toLocaleDateString(),
            syncStatus: 'local-changes', // Force UI refresh
            updatedAt: now // Ensure sort logic sees the new time
          }
        : obs
    )
  );

  // 8. Close Modal (No Auto-Sync)
  console.log("✅ Metadata saved locally. Sync button should appear.");
  setEditingObservation(null);
  setShowEditModal(false);
}, [setObservations]);

const grouped = React.useMemo(() => {
  // Always group by month
  return groupBy(filteredAndSorted, (o) => {
    const mk = monthKeyFromTs(o.rawDate);
    return mk ?? "Unknown date";
  });
}, [filteredAndSorted]);
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
const availableSchools = React.useMemo(() => {
  return [...new Set(observations.map(o => o.schoolName).filter(Boolean))];
}, [observations]);

const availableMonthsForBulk = React.useMemo(() => {
  return [...new Set(
    observations
      .map(o => monthKeyFromTs(o.rawDate))
      .filter((m): m is string => m !== null)
  )];
}, [observations]);

const filteredObservationsForBulk = React.useMemo(() => {
  if (!bulkSchool || !bulkMonth) return [];
  return observations.filter(o => 
    o.schoolName === bulkSchool && 
    monthKeyFromTs(o.rawDate) === bulkMonth
  );
}, [observations, bulkSchool, bulkMonth]);

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
     trainerName,
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
      bookingUrl: trainerSettings?.booking_url,
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
    // 🟢 1. CHECK TOKEN VALIDITY USING YOUR NEW HELPER
    if (!isGrapeSeedTokenValid()) {
      console.warn("⚠️ GrapeSEED Token Missing or Expired. Opening login...");
      setPendingObservation(obs); // Save what we were doing
      setShowLoginModal(true);    // Pop the gate
      return;                     // Stop execution here
    }

    const gsToken = localStorage.getItem('grapeseed_token');
    const teacherEmail = await fetchTeacherEmail(obs.teacherName, obs.schoolName);
    let visitationId = null;
    let schoolId = null;   // <-- new variable for official code

    // 🟢 2. PROCEED WITH LINK FETCHING
    try {
      const { data: schoolData } = await supabase
        .from('schools')
        .select('official_code, campus_id')
        .eq('school_name', obs.schoolName)
        .eq('campus_name', obs.campus || '')
        .maybeSingle();

      if (schoolData?.official_code) {
        schoolId = schoolData.official_code;   // <-- store the official code
        const dateObj = new Date((obs as any).createdAt || (obs as any).created_at || new Date());
        const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        const apiType = obs.supportType === 'LVA' ? 'LVA' : 'Visit';

        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
        const matchResponse = await fetch(`${API_BASE_URL}/api/match-visitation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schoolCode: schoolId,
            monthKey: monthKey,
            type: apiType,
            userToken: gsToken,
            campusId: schoolData.campus_id
          })
        });

        if (matchResponse.ok) {
          const matchData = await matchResponse.json();
          if (matchData.match?.linkId) {
            visitationId = matchData.match.linkId;
          }
        } else if (matchResponse.status === 401) {
          console.warn("⚠️ GrapeSEED Token Expired mid-flight. Re-authenticating...");
          localStorage.removeItem('grapeseed_token');
          setPendingObservation(obs);
          setShowLoginModal(true);
          return; // 🟢 STOP before opening the email modal
        }
      }
    } catch (err) {
      console.error("Failed to silently fetch visitation ID:", err);
    }

    // 🟢 3. BUILD HTML AND OPEN MODAL
    const html = buildTeacherPostCallHtml({
      teacherName: obs.teacherName,
      schoolName: obs.schoolName,
      campus: obs.campus,
      trainerName: trainerName, 
      teacherWorkbookUrl: obs.teacherWorkbookUrl,
      visitationId: visitationId,
      schoolId: schoolId   // <-- add the official code
    });

    setEmailModalState({
      isOpen: true,
      mode: "simple",
      emailType: "post", 
      obsId: obs.id, 
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
        phoneNumber: trainerSettings?.phone_number,
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

// Bulk merge admin workbooks (sequential)
const handleBulkAdminMerge = async () => {
  if (bulkSelectedIds.size === 0) {
    alert("Please select at least one teacher.");
    return;
  }
  setBulkMerging(true);
  let successCount = 0;
  let failCount = 0;
  const selectedObs = observations.filter(o => bulkSelectedIds.has(o.id));
  try {
    for (let i = 0; i < selectedObs.length; i++) {
      const obs = selectedObs[i];
      setBulkMergeProgress({
        current: i + 1,
        total: selectedObs.length,
        currentTeacher: obs.teacherName,
      });
      try {
        await handleMergeAdminWorkbook(obs, true);
        successCount++;
      } catch (err) {
        console.error(`Merge failed for ${obs.teacherName}:`, err);
        failCount++;
      }
    }
  } finally {
    setBulkMerging(false);
    setBulkMergeProgress({ current: 0, total: 0 });
  }
  alert(`Merge complete: ${successCount} succeeded, ${failCount} failed.`);
  setShowBulkAdminModal(false);
};

// Bulk admin update email
const handleBulkAdminEmail = async () => {
  if (bulkSelectedIds.size === 0) {
    alert("Please select at least one teacher.");
    return;
  }
  const selectedObs = observations.filter(o => bulkSelectedIds.has(o.id));
  // Collect unique admin emails (per campus) and unique AM emails
  const adminEmailSet = new Set<string>();
  const amEmailSet = new Set<string>();
  const teachersForTable: TeacherEntry[] = [];

  for (const obs of selectedObs) {
    const { adminEmail, amEmail } = await fetchSchoolEmails(obs.schoolName, obs.campus);
    if (adminEmail) adminEmailSet.add(adminEmail);
    if (amEmail) amEmailSet.add(amEmail);
    teachersForTable.push({
      campus: obs.campus,
      teacherName: obs.teacherName,
      unit: obs.unit,
      lesson: obs.lesson,
      dateStr: obs.isoDate ? obs.isoDate.slice(5) : "", // "MM-DD"
    });
  }

  const toEmails = Array.from(adminEmailSet);
  const ccEmails = Array.from(amEmailSet);
  if (toEmails.length === 0 && ccEmails.length === 0) {
    alert("No admin or AM email addresses found for the selected teachers.");
    return;
  }

  // Use the first selected observation's admin workbook URL (same for all if same school)
  const firstObs = selectedObs[0];
  const adminWorkbookUrl = firstObs.adminWorkbookUrl;
  const viewOnlyUrl = firstObs.adminViewOnlyUrl;

  const monthLabel = bulkMonth.replace(".", "/"); // e.g. "12.2025" -> "12/2025"

  const html = buildAdminUpdateBulkHtml({
    adminName: "School Admin", // generic, but we'll address to first admin? Or just generic
    schoolName: bulkSchool,
    reportMonth: monthLabel,
    trainerName: trainerName,
    adminWorkbookUrl: adminWorkbookUrl,
    viewOnlyUrl: viewOnlyUrl,
    teachers: teachersForTable,
  });

  setEmailModalState({
    isOpen: true,
    mode: "simple",
    emailType: "admin",
    obsId: undefined,
    obsIds: selectedObs.map(o => o.id),
    to: toEmails,
    cc: ccEmails,
    subject: `GrapeSEED Support Update: ${bulkSchool} (${monthLabel})`,
    bodyHtml: html,
  });
  setShowBulkAdminModal(false);
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
      const teacherModel = buildTeacherExportModel(exportMeta, exportIndicators, trainerName);

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
const handleMergeAdminWorkbook = async (obs: DashboardObservationRow, silent: boolean = false) => {
    setMergingAdminId(obs.id);
    setActionModal(null);

    // 1. Try to get from IndexedDB first
    let full = await get(`${STORAGE_PREFIX}${obs.id}`);

    // 2. If missing, try to fetch from Supabase (online only)
    if (!full) {
        if (!navigator.onLine) {
            alert(`Cannot merge admin workbook for ${obs.teacherName}: observation data not available offline. Please go online or open the observation first.`);
            setMergingAdminId(null);
            return;
        }
        
        console.log(`📡 Fetching full observation ${obs.id} from server...`);
        try {
            const { data, error } = await supabase
                .from("observations")
                .select("*")
                .eq("id", obs.id)
                .single();
            
            if (error || !data) throw new Error("Observation not found on server");
            
            // Build a full local object from server data
            full = {
                id: data.id,
                meta: data.meta || {},
                indicators: data.indicators || [],
                status: data.status || "draft",
                updatedAt: new Date(data.updated_at).getTime(),
                lastSync: new Date(data.updated_at).getTime(),
                adminSummaryVN: data.admin_summary_vn,
                performance_rating: data.performance_rating,
            };
            
            // Save to IndexedDB for future use
            await set(`${STORAGE_PREFIX}${obs.id}`, full);
            console.log(`✅ Saved observation ${obs.id} to IndexedDB`);
        } catch (err) {
            console.error("Failed to fetch observation from server:", err);
            alert(`Could not load observation data for ${obs.teacherName}. Please open the observation once to sync it locally, then try again.`);
            setMergingAdminId(null);
            return;
        }
    }

    // 3. Continue with the existing merge logic (the rest of the function stays the same)
    const adminWorkbookUrl = obs.adminWorkbookUrl;
    if (!adminWorkbookUrl) { alert("Admin workbook URL not found."); setMergingAdminId(null); return; }

    // Resolve School ID logic...
    let schoolId = (obs as any).schoolId || (obs as any).meta?.schoolId || null;
    if (!schoolId) {
       try {
         const { data } = await supabase.from("schools").select("id").eq("school_name", obs.schoolName).eq("campus_name", obs.campus).limit(1);
         if (data?.[0]) schoolId = data[0].id;
       } catch {}
    }

    try {
      const graphToken = await getGraphAccessToken();

      const exportMeta = toMetaForExport(full, obs);
      const exportIndicators = toIndicatorsForExport(full);
      const adminModel = buildAdminExportModel(exportMeta, exportIndicators, trainerName);

      if (obs.admin_summary_vn) {
        adminModel.trainerSummary = obs.admin_summary_vn;
      }
      
      const sheetName = buildAdminSheetName(obs);

      const result = await clientMergeAdminSheet({
        token: graphToken,
        workbookUrl: adminWorkbookUrl,
        sheetName,
        model: adminModel
      });

      const mergedAt = new Date().toISOString();
      const newViewUrl = obs.adminViewOnlyUrl || result.viewUrl; 

      const patch = {
        mergedAdmin: { url: result.sheetUrl, sheetName: result.sheetName, mergedAt },
        adminWorkbookUrl,
        adminWorkbookViewUrl: newViewUrl, 
        schoolId,
      };

      const nextMeta = await persistMergedLinkToObservationMeta(obs.id, patch);

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

if (!silent) {
  alert("Admin merge succeeded!");
}

    } catch (err: any) {
      console.error("Client admin merge error:", err);
      alert(`Admin merge failed: ${err.message}`);
    } finally {
      setMergingAdminId(null);
    }
};


  const handleDeleteObservation = async (obs: DashboardObservationRow) => {
    const confirmed = window.confirm(
      `Are you sure you want to DELETE the observation for:\n${obs.teacherName}?\n\n⚠️ This action cannot be undone.`
    );
    if (!confirmed) return;

    // Immediately add to pending deletes to hide from UI and future syncs
    const pendingDeletes = (await get<string[]>("pending_deletes")) || [];
    if (!pendingDeletes.includes(obs.id)) {
      await set("pending_deletes", [...pendingDeletes, obs.id]);
    }
    // Remove from UI optimistically
    setObservations((prev) => prev.filter((o) => o.id !== obs.id));

    // If online, try to delete from server now
    if (navigator.onLine) {
      try {
        const { data: deletedRows, error } = await supabase
          .from("observations")
          .delete()
          .eq("id", obs.id)
          .select("id");

        if (error) throw error;

        if (!deletedRows || deletedRows.length === 0) {
          // Delete failed on server – revert by removing from pending deletes
          const updatedPending = (await get<string[]>("pending_deletes")) || [];
          const filtered = updatedPending.filter((id) => id !== obs.id);
          await set("pending_deletes", filtered);
          alert(
            "Failed to delete observation from server. It may reappear until the issue is resolved.\n\n" +
            "Please check your permissions and try again."
          );
          // Re-add the observation to UI (since server still has it)
          await refreshDashboard();
          return;
        }

        // Delete succeeded – also clean local files
        await del(`${STORAGE_PREFIX}${obs.id}`).catch(() => {});
        const backup = (await get<any[]>("dashboard_backup_list")) || [];
        await set("dashboard_backup_list", backup.filter((item) => item.id !== obs.id));
        console.log("✅ Deleted from server and local.");

      } catch (err) {
        console.error("Online delete error:", err);
        // Keep ID in pending_deletes so it will be retried on next sync or reload
        alert(
          "Could not connect to server. The observation will be deleted automatically when you go online."
        );
      }
    } else {
      // Offline: already in pending_deletes, will be processed when back online
      alert("You are offline. The observation will be deleted from the server when you reconnect.");
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
     await refreshDashboard();
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
    // 🟢 NEW: SMART SYNC UI LOGIC (with loading state)
    // -------------------------------------------------------------------------
    const isSynced = obs.syncStatus === 'synced';
    const lastSync = obs.lastSync || 0; // keep for tooltip display only
 
    let actionButton;

    if (syncingObservationId === obs.id) {
      // 🟢 SYNCING STATE (Spinner)
      actionButton = (
        <div 
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            fontSize: "11px", fontWeight: "bold", 
            color: "#4f46e5",
            background: "rgba(79, 70, 229, 0.1)", 
            border: "1px solid rgba(79, 70, 229, 0.3)",
            padding: "2px 8px", borderRadius: "4px"
          }}
        >
          <svg className="animate-spin" style={{ width: "12px", height: "12px" }} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>Syncing...</span>
        </div>
      );
    } else if (isSynced) {
      // ✅ CASE A: Synced (Green Badge)
      actionButton = (
        <div 
          onClick={(e) => e.stopPropagation()}
          title={`Last Sync: ${new Date(lastSync).toLocaleTimeString()}`}
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            fontSize: "11px", fontWeight: "bold", 
            color: "#10b981",
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
      actionButton = (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePush(obs.id);
          }}
          title="Sync with Server"
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            fontSize: "11px", fontWeight: "bold",
            color: "white",
            background: "#4f46e5",
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
  id={`obs-row-${obs.id}`}
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

// Auto‑scroll to highlighted observation when coming back from workspace
useEffect(() => {
  if (!highlightObservationId || !onHighlightComplete) return;
  if (lastHighlightedRef.current === highlightObservationId) return;

  const targetObs = observations.find(o => o.id === highlightObservationId);
  if (!targetObs) return;

  // Always expand the group containing this observation (grouping is always by month)
  const monthKey = monthKeyFromTs(targetObs.rawDate);
  if (monthKey) {
    setExpandedGroups(prev => ({
      ...prev,
      [monthKey]: true,
    }));
  }

  // Allow time for the DOM to update after group expansion
  setTimeout(() => {
    const element = document.getElementById(`obs-row-${highlightObservationId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Temporary highlight (remove after 2 seconds)
      element.classList.add('obs-row-highlight');
      setTimeout(() => {
        element.classList.remove('obs-row-highlight');
      }, 2000);
    }
    lastHighlightedRef.current = highlightObservationId;
    onHighlightComplete();
  }, 100);
}, [highlightObservationId, observations, onHighlightComplete]);
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
            <div className="toolbar-group">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const schools = [...new Set(observations.map(o => o.schoolName).filter(Boolean))];
                const months = [...new Set(
                  observations
                    .map(o => monthKeyFromTs(o.rawDate))
                    .filter((m): m is string => m !== null)
                )];
                setBulkSchool(schools[0] || "");
                setBulkMonth(months[0] || "");
                setBulkSelectedIds(new Set());
                setShowBulkAdminModal(true);
              }}
              disabled={observations.length === 0}
            >
              Bulk Admin…
            </button>
          </div>     


            {/* 🆕 Import button */}
            <div className="toolbar-group">
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title="Import observations from backup"
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Upload size={16} /> Import
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileImport}
                accept=".json"
                style={{ display: 'none' }}
              />
            </div>

            {/* --- Bell Icon with Red Dot next to Online Badge --- */}
                {/* 🔔 LUCIDE NOTIFICATION BELL */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: '8px' }}>
                  <div 
                    style={{ position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center' }} 
                    onClick={() => setIsActionDashboardOpen(true)}
                  >
                    <Bell size={20} color={Object.values(syncPulseResults).some(arr => arr.length > 0) ? "#dc2626" : "#64748b"} />
                    
                    {/* Red Dot Logic */}
                    {Object.values(syncPulseResults).some(arr => arr.length > 0) && (
                      <span style={{
                        position: 'absolute',
                        top: '-2px',
                        right: '-2px',
                        height: '8px',
                        width: '8px',
                        backgroundColor: '#dc2626',
                        borderRadius: '50%',
                        border: '1px solid white'
                      }} />
                    )}
                  </div>
                </div>

              {/* ⚡️ MINIMALIST PULSE TRIGGER */}
              <div className="toolbar-group" style={{ marginLeft: '4px' }}>
                <button
                  type="button"
                  title="Force Sync Pulse"
                  style={{ 
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#0d9488'
                  }}
                  onClick={runSyncPulse}
                >
                  <Activity size={20} />
                </button>
              </div>
          </div>
        </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div className="obs-list" style={{ flex: 1 }}>
            {/* existing obs-list content remains exactly the same */}
            {loading && observations.length === 0 ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              <>
                {grouped.map(renderGroup)}
                {!loading && observations.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
                    No observations found.
                  </div>
                )}
              </>
            )}
          </div>

          {/* 🟢 NEW: Stats Sidebar */}
          <div style={{
            width: '260px',
            marginTop: '0',
            position: 'sticky',
            top: '16px',
            background: 'var(--card-bg, #1e293b)',
            borderRadius: '12px',
            border: '1px solid #334155',
            padding: '16px',
            fontSize: '13px',
            color: 'var(--text-main, #f8fafc)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: '16px', fontSize: '14px' }}>
              📊 {stats.month} {stats.year}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>🏫 Active Schools</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.exclusiveSchools}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
                Shared: {stats.sharedSchools}
              </div>
            </div>

                        <div style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>👩‍🏫 Active Teachers</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.activeTeachers}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
                Mutual: {stats.mutualTeachers}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>📅 Visits per Year</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.totalVisitCount}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                planned visits (active schools)
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>✅ Visits Done</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.visitedSchools}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                unique schools this month
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>👤 Teachers Visited</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.visitedTeachers}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                unique teachers this month
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>🎥 Videos Analyzed</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.lvaCount}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                LVA this month
              </div>
            </div>

            <div style={{ marginBottom: '0' }}>
              <div style={{ fontWeight: 600 }}>📈 Performance</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                <div><span style={{ color: '#22c55e', fontWeight: 700 }}>{stats.thriving.count}</span> <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({stats.thriving.pct}%) Thriving</span></div>
                <div><span style={{ color: '#3b82f6', fontWeight: 700 }}>{stats.functioning.count}</span> <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({stats.functioning.pct}%) Functioning</span></div>
                <div><span style={{ color: '#ef4444', fontWeight: 700 }}>{stats.developing.count}</span> <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({stats.developing.pct}%) Developing</span></div>
              </div>
            </div>
          </div>
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

     {/* Bulk Admin Modal */}
{showBulkAdminModal && (
  <div className="modal-backdrop" onClick={() => setShowBulkAdminModal(false)} style={{ zIndex: 1100 }}>
    <div className="modal-panel" style={{ width: "700px", maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title">Bulk Admin Actions</div>
        <button type="button" className="btn" onClick={() => setShowBulkAdminModal(false)}>×</button>
      </div>
      <div className="modal-body" style={{ overflowY: "auto" }}>
        <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
          <div className="toolbar-group" style={{ flex: 1 }}>
            <span>School</span>
            <select
              className="select"
              value={bulkSchool}
              onChange={(e) => {
                setBulkSchool(e.target.value);
                setBulkSelectedIds(new Set());
              }}
            >
              <option value="">Select school</option>
              {availableSchools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="toolbar-group" style={{ flex: 1 }}>
            <span>Month</span>
            <select
              className="select"
              value={bulkMonth}
              onChange={(e) => {
                setBulkMonth(e.target.value);
                setBulkSelectedIds(new Set());
              }}
              disabled={!bulkSchool}
            >
              <option value="">Select month</option>
              {availableMonthsForBulk.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {bulkSchool && bulkMonth && (
          <>
            <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={filteredObservationsForBulk.length > 0 && bulkSelectedIds.size === filteredObservationsForBulk.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setBulkSelectedIds(new Set(filteredObservationsForBulk.map(o => o.id)));
                    } else {
                      setBulkSelectedIds(new Set());
                    }
                  }}
                />
                Select all ({filteredObservationsForBulk.length})
              </label>
              <span style={{ fontSize: "12px", color: "#666" }}>{bulkSelectedIds.size} selected</span>
            </div>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", maxHeight: "400px", overflowY: "auto" }}>
              {filteredObservationsForBulk.map(obs => (
                <label key={obs.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={bulkSelectedIds.has(obs.id)}
                    onChange={(e) => {
                      const newSet = new Set(bulkSelectedIds);
                      if (e.target.checked) newSet.add(obs.id);
                      else newSet.delete(obs.id);
                      setBulkSelectedIds(newSet);
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{obs.teacherName}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>{obs.campus} • Unit {obs.unit} – Lesson {obs.lesson} • {obs.isoDate ? new Date(obs.isoDate).toLocaleDateString() : obs.dateLabel}</div>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {bulkMerging && (
          <div style={{ marginTop: "16px", padding: "12px", background: "#f3f4f6", borderRadius: "6px" }}>
            <div>Merging: {bulkMergeProgress.current} of {bulkMergeProgress.total}</div>
            <div style={{ fontSize: "12px", color: "#4b5563" }}>Current: {bulkMergeProgress.currentTeacher}</div>
            <progress key={bulkMergeProgress.current} value={bulkMergeProgress.current} max={bulkMergeProgress.total} style={{ width: "100%", marginTop: "8px" }} />
          </div>
        )}
      </div>
      <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
        <button
          type="button"
          className="btn"
          onClick={() => setShowBulkAdminModal(false)}
          disabled={bulkMerging}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleBulkAdminMerge}
          disabled={bulkSelectedIds.size === 0 || bulkMerging}
          style={{ background: "#4f46e5", color: "white" }}
        >
          {bulkMerging ? "Merging..." : "Merge Admin Workbooks"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleBulkAdminEmail}
          disabled={bulkSelectedIds.size === 0 || bulkMerging}
          style={{ background: "#10b981", color: "white" }}
        >
          Send Admin Update Email
        </button>
      </div>
    </div>
  </div>
)} 
    <ActionDashboardModal
          isOpen={isActionDashboardOpen}
          onClose={() => setIsActionDashboardOpen(false)}
          results={syncPulseResults} // 👈 Passes the state we populated in Step 1
          onResolve={handleResolveConflict}
    />

        {/* 🟢 GRAPESEED LOGIN GATE (Auto-Resumes Email) */}
        <GrapeSeedLoginModal
          isOpen={showLoginModal}
          onClose={() => {
            setShowLoginModal(false);
            setPendingObservation(null);
          }}
          onSuccess={(token) => {
            setShowLoginModal(false);
            if (pendingObservation) {
              handlePostCallEmail(pendingObservation);
              setPendingObservation(null);
            }
          }}
        />
            {/* ---------- PERFORMANCE RATING MODAL (replaces confirm toast) ---------- */}
      {showPerformanceModal && pendingSyncObs && (
        <div className="modal-backdrop" onClick={() => setShowPerformanceModal(false)} style={{ zIndex: 1200 }}>
          <div className="modal-panel" style={{ maxWidth: '450px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Performance Rating Required</div>
              <button className="btn" onClick={() => setShowPerformanceModal(false)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ marginBottom: '16px', fontSize: '14px' }}>
                Please set a performance level for <strong>{pendingSyncObs.teacherName}</strong> before syncing.
                This helps other trainers understand the teacher's current level.
              </p>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '13px' }}>
                  Performance Rating
                </label>
                <select
                  id="performance-select"
                  className="select"
                  style={{ width: '100%' }}
                  defaultValue=""
                >
                  <option value="" disabled>Select rating...</option>
                  <option value="Developing">Developing</option>
                  <option value="Functioning">Functioning</option>
                  <option value="Thriving">Thriving</option>
                </select>
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn" onClick={() => setShowPerformanceModal(false)}>Cancel</button>
<button
  className="btn"
  style={{ background: '#4f46e5', color: 'white' }}
  onClick={async () => {
    const select = document.getElementById('performance-select') as HTMLSelectElement;
    const rating = select.value as PerformanceRating;
    if (!rating) {
      alert('Please select a performance rating.');
      return;
    }
    
    const obs = pendingSyncObs;
    if (!obs) return;
    
    const storageKey = `${STORAGE_PREFIX}${obs.id}`;
    let fullData = await get(storageKey);
    if (!fullData) {
      fullData = {
        id: obs.id,
        meta: obs.meta || {},
        indicators: [],
        status: obs.status,
        updatedAt: obs.updatedAt || Date.now(),
        lastSync: obs.lastSync || 0,
      };
    }
    
    fullData.performance_rating = rating;
    // 🟢 Also update the first indicator so the workspace sees it
    if (fullData.indicators && fullData.indicators.length > 0) {
      fullData.indicators = [...fullData.indicators];
      fullData.indicators[0] = { ...fullData.indicators[0], performance_rating: rating };
    } else {
      // If no indicators, initialize with a placeholder
      const { INITIAL_INDICATORS } = await import("./constants");
      fullData.indicators = [{ ...INITIAL_INDICATORS[0], performance_rating: rating }];
    }
    fullData.updatedAt = Date.now();
    
    await set(storageKey, fullData);
    
    setShowPerformanceModal(false);
    setPendingSyncObs(null);
    
    await handlePush(obs.id, fullData, true);
  }}
>
  Set Rating & Sync Now
</button>
            </div>
          </div>
        </div>
      )}  
    </>
  );
};

/* -------------------------------------------------- */
/* ACTION DASHBOARD MODAL (Sync v2 - Fully Revised)   */
/* -------------------------------------------------- */
export const ActionDashboardModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  results: {
    newCampuses: any[];
    disabledCampuses: any[];
    classlessClasses: any[];
    nameMismatches: any[];
    newTeachers: any[];
    teacherTagIssues: any[];
    disconnectedCampuses: any[];
  };
  onResolve: (type: string, data: any) => Promise<void>;
}> = ({ isOpen, onClose, results, onResolve }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    newCampuses: true,
    newTeachers: true, // Default open the "New" categories
  });

  if (!isOpen) return null;

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Helper to render accordion sections
  const renderSection = (
    key: string,
    title: string,
    items: any[],
    icon: string,
    color: string,
    renderItem: (item: any) => React.ReactNode
  ) => {
    if (!items || items.length === 0) return null;
    const isExpanded = expanded[key];

    return (
      <div
        className="obs-group"
        style={{ marginBottom: "12px", border: `1px solid ${color}33` }}
      >
        <button
          type="button"
          className="obs-group-header"
          onClick={() => toggle(key)}
          style={{ background: isExpanded ? `${color}08` : "transparent" }}
        >
          <div className="obs-group-header-main">
            <div className="obs-group-title" style={{ color }}>
              {icon} {title}
            </div>
            <div className="obs-group-meta">{items.length} issues</div>
          </div>
          <div className="obs-group-chevron">{isExpanded ? "▾" : "▸"}</div>
        </button>
        {isExpanded && (
          <div className="obs-group-body" style={{ padding: "8px" }}>
            {items.map(renderItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal-panel"
        style={{ width: "600px", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">✨ Sync Action Dashboard</div>
          <button type="button" className="btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body" style={{ overflowY: "auto" }}>
          {/* Section 1: New Campuses */}
          {renderSection(
            "newCampuses",
            "New Campuses Found",
            results.newCampuses,
            "✨",
            "#0d9488",
            (item) => (
              <div
                key={item.id || item.name}
                className="detail-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid #eee",
                  paddingBottom: "8px",
                  marginBottom: "8px",
                }}
              >
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: "11px", color: "#666" }}>
                    Found in school: {item.parent_school_name}
                  </div>
                </div>
                <button
                  className="obs-pill-button"
                  style={{ color: "#0d9488", borderColor: "#0d9488" }}
                  onClick={() => onResolve("newCampus", item)}
                >
                  Add to DB
                </button>
              </div>
            )
          )}
          {/* Section 2: Name Mismatches */}
          {renderSection(
            "nameMismatches",
            "Campus Name Mismatches",
            results.nameMismatches,
            "🔗",
            "#2563eb",
            (item) => (
              <div
                key={item.db_record.id}
                className="detail-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid #eee",
                  paddingBottom: "8px",
                  marginBottom: "8px",
                }}
              >
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontSize: "11px", color: "#666" }}>
                    DB: {item.db_record.campus_name}
                  </div>
                  <div style={{ fontWeight: 600, color: "#2563eb" }}>
                    API: {item.api_name}
                  </div>
                </div>
                <button
                  className="obs-pill-button"
                  style={{ color: "#2563eb", borderColor: "#2563eb" }}
                  onClick={() => onResolve("nameMismatch", item)}
                >
                  {item.mismatch_type === 'id_mismatch' ? 'Update Connection/ID' : 'Update Name'}
                </button>
              </div>
            )
          )}
          {renderSection(
            "newTeachers",
            "New Teachers Found",
            results.newTeachers,
            "👤",
            "#8b5cf6",
            (item) => (
              <div key={item.grapeseed_id} className="detail-row" style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #eee", paddingBottom: "12px", marginBottom: "12px" }}>
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {item.name} 
                    {item.is_handshake && <span style={{fontSize:'9px', color:'#2563eb', background:'#eff6ff', padding:'2px 6px', borderRadius:'10px', border:'1px solid #dbeafe'}}>LINK READY</span>}
                  </div>
                  <div style={{ fontSize: "11px", color: "#666" }}>{item.email}</div>
                  
                  {/* 🟢 THE REASON TAG */}
                  <div style={{ fontSize: "10px", color: "#6d28d9", background: "#f5f3ff", padding: "2px 6px", borderRadius: "4px", display: "inline-block", marginTop: "4px", border: "1px solid #ddd6fe" }}>
                    <strong>Reason:</strong> {item.reason}
                  </div>

                  {/* 🟢 TARGET DESTINATION */}
                  <div style={{ fontSize: "10px", color: "#475569", marginTop: "4px" }}>
                    📍 Destination: <strong>{item.parent_school_name}</strong> {item.campus_name ? `(${item.campus_name})` : ""}
                  </div>
                </div>
                
                <button
                  className="obs-pill-button"
                  style={{ color: "#8b5cf6", borderColor: "#8b5cf6", fontWeight: "600" }}
                  onClick={() => onResolve("newTeacher", item)}
                >
                  {item.is_handshake ? "Link Now" : "Import"}
                </button>
              </div>
            )
          )}
          {/* Section 4: Teacher Tag Issues (Comparison Mode) */}
          {renderSection(
            "teacherTagIssues",
            "Teacher Tag Mismatches",
            results.teacherTagIssues,
            "🏷️",
            "#ec4899",
            (item) => {
              const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
              const portalUrl = item.teacherUrl || `https://schools.grapeseed.com/regions/${VIETNAM_REGION_ID}/schools/${item.official_code || "unknown"}/teachers`;

              // 🔴 Logic to handle error state styling
              const isError = item.is_error === true;

              return (
                <div key={item.id} className="detail-row" style={{ display: "flex", flexDirection: "column", gap: "4px", borderBottom: "1px solid #eee", paddingBottom: "12px", marginBottom: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: "11px", color: "#666" }}>{item.school_name}</div>
                      
                      {/* 🟢 VISUAL COMPARISON BLOCK */}
                      <div style={{ 
                        fontSize: "11px", 
                        marginTop: "6px", 
                        padding: "6px", 
                        background: isError ? "#fff1f2" : "#f8fafc", 
                        borderRadius: "4px", 
                        border: isError ? "1px solid #fecdd3" : "1px solid #e2e8f0" 
                      }}>
                        <div style={{ marginBottom: '2px', color: isError ? "#991b1b" : "#64748b" }}>
                          <strong>My teacher list:</strong> {Array.isArray(item.current_tags) && item.current_tags.length > 0 ? item.current_tags.join(", ") : <em>(Empty)</em>}
                        </div>
                        
                        {isError ? (
                          <div style={{ color: "#b91c1c", fontWeight: 600 }}>
                            <strong>⚠️ Audit Failure:</strong> {item.expected[0]}
                          </div>
                        ) : (
                          <div style={{ color: "#dc2626" }}>
                            <strong>GrapeSEED portal:</strong> {Array.isArray(item.expected) ? item.expected.join(", ") : "No tag"}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: '12px' }}>
                      <button
                        className="obs-pill-button"
                        style={{ color: "#666", borderColor: "#ccc", padding: "4px 8px", fontSize: "10px" }}
                        onClick={() => window.open(portalUrl, "_blank")}
                      >
                        Portal ⧉
                      </button>
                      
                      {/* Only show Sync & Clear if it's a real mismatch, not a network error */}
                      {!isError && (
                        <button
                          className="obs-pill-button"
                          style={{ color: "#ec4899", borderColor: "#ec4899" }}
                          onClick={() => onResolve("teacherTagIssue", item)}
                        >
                          Sync & Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
          )}
          {renderSection(
            "classlessClasses",
            "Missing Teacher Assignments",
            results.classlessClasses,
            "⚠️",
            "#d97706",
            (item) => (
              <div key={item.id} className="detail-row" style={{ display: "flex", alignItems: "center" /* ... existing styles */ }}>
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: "11px", color: "#666" }}>
                    {item.school_name} - {item.campus_name}
                  </div>
                </div>
                <button
                  className="obs-pill-button"
                  onClick={() => window.open(item.teacherUrl, "_blank")}
                >
                  View in GS
                </button>
              </div>
            )
          )}
          {/* Section: Disconnected Campuses (The "Fuzzy" Case) */}
          {renderSection(
            "disconnectedCampuses",
            "Disconnected Campuses (ID or Name Mismatch)", // Updated header for accuracy
            results.disconnectedCampuses || [],
            "📡",
            "#f59e0b",
            (item) => (
              <div key={item.db_record.id} className="detail-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    {/* PATCH: Dynamic ID Label Logic */}
                    Found in your DB {item.db_record.campus_id ? `(Invalid ID: ${item.db_record.campus_id})` : '(No ID)'}:
                  </div>
                  <div style={{ fontWeight: 600 }}>{item.db_record.campus_name}</div>
                </div>

                {/* Logic: Suggestion vs Dropdown */}
                {item.suggestions && item.suggestions.length > 0 ? (
                  <div style={{ background: '#fffbeb', padding: '8px', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#b45309', marginBottom: '4px' }}>
                      {item.suggestions.length === 1 ? "💡 Suggestion:" : "❓ Multiple potential matches:"}
                    </div>
                    
                    {item.suggestions.length === 1 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px' }}>Link to <strong>{item.suggestions[0].name}</strong>?</span>
                        <button 
                          className="obs-pill-button" 
                          style={{ color: '#b45309', borderColor: '#b45309' }}
                          onClick={() => onResolve("linkCampus", { db_id: item.db_record.id, api_item: item.suggestions[0] })}
                        >
                          Link & Fix
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select 
                          className="select select-compact" 
                          id={`select-${item.db_record.id}`}
                          style={{ flexGrow: 1 }}
                        >
                          {item.suggestions.map((s: any) => (
                            <option key={s.id} value={JSON.stringify(s)}>{s.name}</option>
                          ))}
                        </select>
                        <button 
                          className="obs-pill-button"
                          onClick={() => {
                            const el = document.getElementById(`select-${item.db_record.id}`) as HTMLSelectElement;
                            onResolve("linkCampus", { db_id: item.db_record.id, api_item: JSON.parse(el.value) });
                          }}
                        >
                          Link
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: '#dc2626', fontStyle: 'italic' }}>
                    No similar names found in GrapeSEED.
                  </div>
                )}
                
                <button 
                  style={{ alignSelf: 'flex-start', fontSize: '10px', color: '#dc2626', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                  onClick={() => onResolve("deactivateCampus", item.db_record)}
                >
                  I'm sure this is a ghost - Deactivate
                </button>
              </div>
            )
          )}
          {renderSection(
            "disabledCampuses",
            "Ghost / Disabled Campuses (Not in GrapeSEED)",
            results.disabledCampuses || [],
            "🗑️",
            "#dc2626", // Red for deletion/deactivation
            (item) => (
              <div 
                key={item.id} 
                className="detail-row" 
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee' }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.campus_name}</div>
                  <div style={{ fontSize: '10px', color: '#666' }}>
                    ID: {item.campus_id || 'No ID'} | Code: {item.official_code}
                  </div>
                </div>
                <button 
                  className="obs-pill-button"
                  style={{ color: '#dc2626', borderColor: '#dc2626' }}
                  onClick={() => onResolve("deactivateCampus", item)}
                >
                  Deactivate
                </button>
              </div>
            )
          )}
          {/* Info Footer */}
          <div
            style={{
              padding: "16px",
              textAlign: "center",
              color: "#666",
              fontSize: "11px",
              background: "#f9fafb",
              borderRadius: "8px",
              marginTop: "16px",
            }}
          >
            <strong>Note:</strong> Resolving these issues updates your Supabase
            database to match the official GrapeSEED Portal data.
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Close Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};