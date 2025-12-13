// src/DashboardShell.tsx
import React, { useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./supabaseClient";
import { ObservationCard } from "./components/ObservationCard";
import {
  buildTeacherExportModel,
  type ObservationMetaForExport,
  type IndicatorStateForExport,
} from "./exportTeacherModel";
import { getGraphAccessToken } from "./msal/getGraphToken";
import { buildAdminExportModel } from "./exportAdminModel";

const MERGE_SERVER_BASE =
  import.meta.env.VITE_MERGE_SERVER_BASE || "http://localhost:4000";

const SUMMARY_STATE_KEY = "obs-am-summary-v1";

type StatusColor = "good" | "mixed" | "growth";
type GroupMode = "none" | "month" | "school" | "campus";
type SortMode = "newest" | "oldest" | "teacher-az" | "teacher-za";

interface DashboardObservationRow {
  id: string;
  teacherName: string;
  schoolName: string;
  campus: string;
  unit: string;
  lesson: string;
  supportType: "Training" | "LVA" | "Visit";
  dateLabel: string;
  isoDate: string | null;
  rawDate: number | null;
  status: "draft" | "saved";
  progress: number;
  totalIndicators: number;
  statusColor: StatusColor;

  // workbook URLs (can be cached on row OR resolved from tables)
  teacherWorkbookUrl?: string | null;
  adminWorkbookUrl?: string | null;

  // IMPORTANT: keep meta available on dashboard rows
  meta?: any;
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
    /** Actual observation date from meta ("YYYY-MM-DD") */
    date: string;
  }) => void;
}

/* ------------------------------
   SCHOOL → AM MAPPING
   TODO: replace with your real school list.
--------------------------------- */

interface SchoolInfo {
  schoolName: string;
  campus: string;
  amName: string;
  amEmail: string;
}

/**
 * TEMP PLACEHOLDER:
 * Fill this from your real school list (same names/campus strings
 * that appear in observation meta).
 */
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

interface AmSummaryRow {
  schoolName: string;
  campus: string;
  teacherName: string;
  status: SummaryStatus;
  nextSteps: string;
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

async function persistMergedLinkToObservationMeta(obsId: string, patch: any) {
 // 1) localStorage (immediate + survives reload)
 const key = `${STORAGE_PREFIX}${obsId}`;
 const raw = localStorage.getItem(key);
 if (!raw) throw new Error("No local observation found in localStorage for this obsId.");
 const parsed = JSON.parse(raw);
 parsed.meta = parsed.meta || {};
 parsed.meta = { ...parsed.meta, ...patch };
 localStorage.setItem(key, JSON.stringify(parsed));
 // 2) Supabase (optional but recommended)
 // If your observations table has a 'meta' jsonb column:
 try {
   await supabase
     .from("observations")
     .update({ meta: parsed.meta })
     .eq("id", obsId);
 } catch (e) {
   console.warn("[persistMergedLinkToObservationMeta] Supabase update failed (local ok)", e);
 }
 return parsed.meta;
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
function buildTeacherSheetName(meta: { date?: string }): string {
  if (!meta?.date) return "Teacher Report";

  const d = new Date(meta.date);
  if (Number.isNaN(d.getTime())) return "Teacher Report";

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  // Teacher naming convention you said is already working: "MM.YYYY"
  return `${month}.${year}`;
}
/* ------------------------------
   COMPONENT
--------------------------------- */
const STORAGE_PREFIX = "obs-v1-";
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

export const DashboardShell: React.FC<DashboardProps> = ({
  onOpenObservation,
}) => {
  const { user } = useAuth();

  const [observations, setObservations] =
    useState<DashboardObservationRow[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>("month");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [searchText, setSearchText] = useState("");
  const [recentMergePanel, setRecentMergePanel] =
   useState<RecentMergePanel>(null);

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

  /* ------------------------------
     LOAD OBSERVATIONS + SUMMARY META
  --------------------------------- */
  React.useEffect(() => {
    if (!user) {
      setObservations([]);
      return;
    }

    const load = async () => {
      const rows: DashboardObservationRow[] = [];

      try {
        // 1) Load observations from Supabase for this trainer
        const { data, error } = await supabase
          .from("observations")
          .select(
            "id, status, meta, indicators, created_at, updated_at, observation_date"
          )
          .eq("trainer_id", user.id)
          .order("observation_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (error) {
          console.error("[DB] load observations error", error);
        }

        (data ?? []).forEach((dbRow: any) => {
          // Prefer full data from localStorage (workspace), fallback to DB meta
          const storageKey = `${STORAGE_PREFIX}${dbRow.id}`;
          let parsed: any = null;

          try {
            const rawLocal = localStorage.getItem(storageKey);
            if (rawLocal) {
              parsed = JSON.parse(rawLocal);
            }
          } catch (err) {
            console.error(
              "Error parsing stored observation from localStorage:",
              storageKey,
              err
            );
          }

          if (!parsed) {
            parsed = {
              id: dbRow.id,
              meta: dbRow.meta ?? {},
              indicators: dbRow.indicators ?? [],
              status: dbRow.status ?? "draft",
              updatedAt: dbRow.updated_at
                ? new Date(dbRow.updated_at).getTime()
                : dbRow.created_at
                ? new Date(dbRow.created_at).getTime()
                : Date.now(),
            };
          }

          // Normalize indicators into an array no matter what shape old data has
          const indicatorsArray = Array.isArray(parsed.indicators)
            ? parsed.indicators
            : Array.isArray(parsed.indicators?.indicators)
            ? parsed.indicators.indicators
            : [];

          // total indicators = length of normalized array
          const total = indicatorsArray.length;

          let good = 0;
          let growth = 0;
          let progress = 0;

          indicatorsArray.forEach((ind: any) => {
            const hasMark = ind.good || ind.growth;
            const hasComment = ind.commentText?.trim().length > 0;
            const hasInk =
              Array.isArray(ind.strokes) && ind.strokes.length > 0;

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

          teacherWorkbookUrl: parsed.meta.teacherWorkbookUrl ?? null,
          adminWorkbookUrl: parsed.meta.adminWorkbookUrl ?? null,

          meta: parsed.meta ?? {}, // ✅ add this
        });
        });
      } catch (err) {
        console.error("[Dashboard] unexpected error loading observations", err);
      }

      setObservations(rows);

      // Load AM summary "sent" markers (unchanged)
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
  React.useEffect(() => {
    if (!summaryMonth || !summaryAmKey) {
      setSummaryRows([]);
      return;
    }

    // key: teacher|school|campus
    const rowMap = new Map<string, AmSummaryRow>();

    observations.forEach((o) => {
      const mk = monthKeyFromTs(o.rawDate);
      if (mk !== summaryMonth) return;

      const info = findSchoolInfo(o.schoolName, o.campus);
      if (!info) return;
      const amKey = amKeyFromSchool(info);
      if (amKey !== summaryAmKey) return;

      // load the full observation from storage so we can pull indicator notes
      const storageKey = `${STORAGE_PREFIX}${o.id}`;
      let details: any = null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) details = JSON.parse(raw);
      } catch (err) {
        console.error("Failed to load full observation:", storageKey, err);
      }

      const obsLabel = o.dateLabel || mk;
      let collected = "";

      if (details && Array.isArray(details.indicators)) {
        (details.indicators as any[]).forEach((ind) => {
          const comment = (ind.commentText ?? "").toString().trim();
          const hasComment = comment.length > 0;

          // Prefer explicit trainer-summary checkbox
          const explicitlyFlagged =
            ind.includeInTrainerSummary === true && hasComment;

          // Fallback for old observations (no checkbox yet):
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

      const key = `${o.teacherName}|${o.schoolName}|${o.campus}`;

      if (!rowMap.has(key)) {
        rowMap.set(key, {
          schoolName: o.schoolName,
          campus: o.campus,
          teacherName: o.teacherName,
          status: "none",
          nextSteps: collected,
        });
      } else {
        const existing = rowMap.get(key)!;
        const appended = collected
          ? [existing.nextSteps, collected].filter(Boolean).join("\n")
          : existing.nextSteps;
        rowMap.set(key, {
          ...existing,
          nextSteps: appended,
        });
      }
    });

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

  const handlePreCallEmail = (obs: DashboardObservationRow) => {
    console.log("[Pre-call email] for obs", obs.id);
    // TODO: plug real pre-call email logic here
  };

  const handlePostCallEmail = (obs: DashboardObservationRow) => {
    console.log("[Post-call email] for obs", obs.id);
    // TODO: plug real post-call email logic here
  };

// Helper: quick & dirty sheet name for this test.
// Later we’ll replace with your real naming rules.
// ------------------------------
// Excel-safe worksheet name (Graph/Excel rules)
// ------------------------------
function excelSafeSheetName(input: string): string {
  const cleaned = String(input || "")
    .replace(/[:\\\/\?\*\[\]]/g, " ") // illegal chars
    .replace(/\s+/g, " ")
    .trim();

  const nonEmpty = cleaned.length > 0 ? cleaned : "Sheet";
  return nonEmpty.slice(0, 31);
}

function persistMergedToLocalStorage(observationId: string, patch: any) {
  try {
    const key = `obs-v1-${observationId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.meta = parsed.meta || {};
    parsed.meta = { ...parsed.meta, ...patch };
    localStorage.setItem(key, JSON.stringify(parsed));
  } catch (e) {
    console.warn("[persistMergedToLocalStorage] failed", e);
  }
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

// ------------------------------
// Load full observation from localStorage
// (this is REQUIRED to build export models that contain indicator rows)
// ------------------------------
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

// Types from your teacher export module
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


const hydrateTeacherWorkbookUrlIfMissing = async (obs: DashboardObservationRow) => {
  const metaAny: any = getStableMetaForRow(obs);
  const existing =
    (obs as any).teacherWorkbookUrl ??
    metaAny?.teacherWorkbookUrl ??
    metaAny?.teacherWorksheetUrl ??
    null;

  if (existing) return existing;

  try {
    const { data, error } = await supabase
      .from("teachers")
      .select("worksheet_url")
      .eq("name", obs.teacherName)
      .eq("school_name", obs.schoolName)
      .eq("campus", obs.campus)
      .limit(1);

    if (error) {
      console.error("[hydrateTeacherWorkbookUrlIfMissing] teachers lookup error", error);
      return null;
    }

    const url = (data?.[0] as any)?.worksheet_url ?? null;
    if (!url) return null;

    // ✅ Persist into observation meta so it survives reload
    const patch = { teacherWorkbookUrl: url };
    const nextMeta = await persistMergedLinkToObservationMeta(obs.id, patch);

    // ✅ Update dashboard row immediately
    setObservations((prev) =>
      prev.map((o) => (o.id === obs.id ? { ...o, meta: nextMeta, teacherWorkbookUrl: url } : o))
    );

    return url;
  } catch (e) {
    console.error("[hydrateTeacherWorkbookUrlIfMissing] unexpected error", e);
    return null;
  }
};

const handleMergeTeacherWorkbook = async (obs: DashboardObservationRow) => {
  console.log("=====================================================");
  console.log("[MERGE teacher] obs:", obs);

  // 0) Load full observation so we can export actual indicator rows
  const full = loadFullObservation(obs.id);
  if (!full) {
    alert(
      "Missing local observation data (localStorage).\nOpen this observation once in Workspace, then try Merge again."
    );
    return;
  }

  // 1) Resolve teacher workbook URL (teachers table is source of truth)
  let workbookUrl: string | null =
    (obs as any).teacherWorksheetUrl ||
    (obs as any).teacherWorkbookUrl ||
    (obs as any).meta?.teacherWorksheetUrl ||
    (obs as any).meta?.teacherWorkbookUrl ||
    null;

  if (!workbookUrl) {
    try {
      const { data, error } = await supabase
        .from("teachers")
        .select("worksheet_url")
        .eq("name", obs.teacherName)
        .eq("school_name", obs.schoolName)
        .eq("campus", obs.campus)
        .limit(1);

      if (error) {
        console.error("[MERGE teacher] teachers lookup error", error);
      } else if (data?.[0]?.worksheet_url) {
        workbookUrl = data[0].worksheet_url;
      }
    } catch (e) {
      console.error("[MERGE teacher] teachers lookup unexpected error", e);
    }
  }

  if (!workbookUrl) {
    alert("Teacher workbook URL not found. (teachers.worksheet_url is empty)");
    return;
  }

  // 2) Sheet name (NO prompt)
  const sheetName = buildTeacherSheetName(obs);

  // 3) Graph token (REQUIRED)
  let graphToken = "";
  try {
    graphToken = await getGraphAccessToken();
  } catch (e: any) {
    console.error("[MERGE teacher] getGraphAccessToken failed", e);
    alert(e?.message || "Microsoft not connected. Click Connect Microsoft first.");
    return;
  }

  // 4) Build REAL export model (this is why content was missing before)
  const exportMeta = toMetaForExport(full, obs);
  const exportIndicators = toIndicatorsForExport(full);
  const teacherModel = buildTeacherExportModel(exportMeta, exportIndicators);

  const body = {
    workbookUrl,
    sheetName,
    model: teacherModel,
    observationId: obs.id,
  };

  try {
    console.log("[Dashboard] Calling /api/merge-teacher with", body);

    const resp = await fetch(`${MERGE_SERVER_BASE}/api/merge-teacher`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${graphToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    console.log("[Dashboard] merge-teacher response", json);

    if (!resp.ok || !json.ok) throw new Error(json.error || `HTTP ${resp.status}`);

    const sheetUrl: string = typeof json.sheetUrl === "string" ? json.sheetUrl : "";

    const mergedAt = new Date().toISOString();
    const patch = {
      mergedTeacher: {
        url: sheetUrl,
        sheetName: json.sheetName || sheetName,
        mergedAt,
      },
      teacherWorkbookUrl: workbookUrl, // helps UI keep link visible
    };

    const nextMeta = await persistMergedLinkToObservationMeta(obs.id, patch);

    setObservations((prev) =>
      prev.map((o) => (o.id === obs.id ? { ...o, meta: nextMeta, teacherWorkbookUrl: workbookUrl } : o))
    );

    setRecentMergePanel({
  obsId: obs.id,
  kind: "teacher",
  sheetUrl,
  sheetName: json.sheetName || sheetName,
  mergedAt,
});

    alert(`Teacher merge succeeded.\n\nSheet URL:\n${sheetUrl}`);
  } catch (err) {
    console.error("[Dashboard] merge-teacher error", err);
    alert("Teacher merge failed – check the console for details.");
  }
};
const handleMergeAdminWorkbook = async (obs: DashboardObservationRow) => {
  console.log("=====================================================");
  console.log("[MERGE admin] obs:", obs);

  // 0) Load full observation for real export model
  const full = loadFullObservation(obs.id);
  if (!full) {
    alert(
      "Missing local observation data (localStorage).\nOpen this observation once in Workspace, then try Merge again."
    );
    return;
  }

  // 1) Resolve from schools table (source of truth)
  let adminWorkbookUrl: string | null = null;
  let schoolId: string | null = null;

  // ✅ IMPORTANT: declare OUTSIDE try so it's visible later
  let viewOnlyUrlFromSchool: string | null = null;

  try {
    const { data, error } = await supabase
      .from("schools")
      // ✅ MUST match your real column names EXACTLY:
      // admin_workbook_url
      // admin_workbook_view_url  (NO hyphens)
      .select("id, admin_workbook_url, admin_workbook_view_url")
      .eq("school_name", obs.schoolName)
      .eq("campus_name", obs.campus)
      .limit(1);

    console.log("[MERGE admin] schools lookup:", { data, error });

    if (error) {
      console.error("[MERGE admin] schools lookup error", error);
    }

    if (!error && data?.[0]) {
      schoolId = (data[0] as any).id ?? null;
      adminWorkbookUrl = (data[0] as any).admin_workbook_url ?? null;

      // ✅ this is the view-only URL from schools table
      viewOnlyUrlFromSchool = (data[0] as any).admin_workbook_view_url ?? null;
    }
  } catch (e) {
    console.error("[MERGE admin] schools lookup unexpected error", e);
  }

  // 1b) Optional fallback (if you still want it)
  adminWorkbookUrl =
    adminWorkbookUrl ||
    (obs as any).adminWorkbookUrl ||
    (obs as any).schoolAdminWorkbookUrl ||
    (obs as any).meta?.adminWorkbookUrl ||
    (obs as any).meta?.schoolAdminWorkbookUrl ||
    null;

  schoolId =
    schoolId ||
    (obs as any).school_id ||
    (obs as any).schoolId ||
    (obs as any).meta?.schoolId ||
    null;

  if (!adminWorkbookUrl) {
    alert("This observation's school does not have an admin workbook URL set yet.");
    return;
  }
  if (!schoolId) {
    alert("Missing schoolId for this observation's school (schools.id not found).");
    return;
  }

  // 2) Sheet name (NO prompt)
  // Make sure buildAdminSheetName exists (we’ll fix that next if needed)
  const sheetName = buildAdminSheetName(obs);

  // 3) Graph token (REQUIRED)
  let graphToken = "";
  try {
    graphToken = await getGraphAccessToken();
  } catch (e: any) {
    console.error("[MERGE admin] getGraphAccessToken failed", e);
    alert(e?.message || "Microsoft not connected. Click Connect Microsoft first.");
    return;
  }

  // 4) Build REAL admin export model
  const exportMeta = toMetaForExport(full, obs);
  const exportIndicators = toIndicatorsForExport(full);
  const adminModel = buildAdminExportModel(exportMeta, exportIndicators);

  const body = {
    workbookUrl: adminWorkbookUrl,
    sheetName,
    model: adminModel,
    observationId: obs.id,
    schoolId,
  };

  try {
    console.log("[Dashboard] Calling /api/merge-admin with", body);

    const resp = await fetch(`${MERGE_SERVER_BASE}/api/merge-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${graphToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    console.log("[Dashboard] merge-admin response", json);

    if (!resp.ok || !json.ok) throw new Error(json.error || `HTTP ${resp.status}`);

    const sheetUrl: string = typeof json.sheetUrl === "string" ? json.sheetUrl : "";

    const mergedAt = new Date().toISOString();

    // ✅ Persist merged sheet link + ALSO cache workbook urls for the UI
    const patch = {
      mergedAdmin: {
        url: sheetUrl,
        sheetName: json.sheetName || sheetName,
        mergedAt,
      },
      adminWorkbookUrl,
      schoolId,
      adminWorkbookViewUrl: viewOnlyUrlFromSchool, // ✅ FIXED: now in scope
    };

    const nextMeta = await persistMergedLinkToObservationMeta(obs.id, patch);

    // ✅ Update state immediately so UI shows links and doesn’t “disappear”
    setObservations((prev) =>
      prev.map((o) =>
        o.id === obs.id
          ? { ...o, meta: nextMeta, adminWorkbookUrl: adminWorkbookUrl }
          : o
      )
    );

    setRecentMergePanel({
      obsId: obs.id,
      kind: "admin",
      sheetUrl,
      sheetName: json.sheetName || sheetName,
      mergedAt,
    });

    alert(
      `Admin merge succeeded.\n\nAdmin sheet URL:\n${sheetUrl}\n\nView-only workbook URL:\n${
        viewOnlyUrlFromSchool || "(missing in schools table)"
      }`
    );
  } catch (err) {
    console.error("[Dashboard] merge-admin error", err);
    alert("Admin merge failed – check the console for details.");
  }
};


  const handleAdminUpdateEmail = (obs: DashboardObservationRow) => {
    console.log("[Admin update email] for obs", obs.id);
    // TODO: build + send admin update email
  };

  // NEW: toggle group expanded/collapsed
  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
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
      supportType: obs.supportType,
      date: obs.isoDate || "",
    });
  };

// No-argument version — clean and safe
const openTeacherModal = () => {
  setActionModal({ obsId: obs.id, role: "teacher" });
};

const openAdminModal = () => {
  setActionModal({ obsId: obs.id, role: "admin" });
};

// ---- links derived from meta (persisted) so they don't disappear ----
const metaAny: any = getStableMetaForRow(obs);
const mergedTeacherUrl: string | null = metaAny?.mergedTeacher?.url ?? null;
const mergedAdminUrl: string | null = metaAny?.mergedAdmin?.url ?? null;
const teacherWorkbookUrl: string | null =
 (obs as any).teacherWorkbookUrl ??
 metaAny?.teacherWorkbookUrl ??
 metaAny?.teacherWorksheetUrl ??
 null;
const adminWorkbookUrl: string | null =
 (obs as any).adminWorkbookUrl ??
 metaAny?.adminWorkbookUrl ??
 metaAny?.schoolAdminWorkbookUrl ??
 null;
const adminViewOnlyUrl: string | null =
 metaAny?.adminWorkbookViewUrl ??
 metaAny?.admin_workbook_view_url ??
 null;
const showLinks =
 !!mergedTeacherUrl ||
 !!teacherWorkbookUrl ||
 !!mergedAdminUrl ||
 !!adminViewOnlyUrl ||
 !!adminWorkbookUrl;

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

    <div className="obs-row-left">
      <div className="obs-row-header">
        <div className="obs-teacher">{obs.teacherName}</div>
      </div>

      <div className="obs-meta">
        {obs.schoolName} – {obs.campus} • Unit {obs.unit} – Lesson{" "}
        {obs.lesson} • {obs.supportType}
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
    await hydrateTeacherWorkbookUrlIfMissing(obs); // ✅ ensures strip will appear
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
        </div>
      </div>

{/* ✅ ONLY 3 STRIPS (persistent workbook links) */}
{!options?.hideMergeLinks && (
  (() => {
    // ONLY these 3 control rendering
    const showLinks =
      !!teacherWorkbookUrl || !!adminViewOnlyUrl || !!adminWorkbookUrl;

    if (!showLinks) return null;

    return (
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
    );
  })()
)}


    
      {/* {(obs?.meta?.mergedTeacher?.url || obs?.meta?.mergedAdmin?.url) && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Latest merged sheets
          </div>

          {obs?.meta?.mergedTeacher?.url && (
            <MergedLinkRow
              label="Teacher sheet"
              url={obs.meta.mergedTeacher.url}
              sheetName={obs.meta.mergedTeacher.sheetName}
              mergedAt={obs.meta.mergedTeacher.mergedAt}
            />
          )}

          {obs?.meta?.mergedAdmin?.url && (
            <MergedLinkRow
              label="Admin sheet"
              url={obs.meta.mergedAdmin.url}
              sheetName={obs.meta.mergedAdmin.sheetName}
              mergedAt={obs.meta.mergedAdmin.mergedAt}
            />
          )}
        </div>
      )} */}


    </div>

    <div className="obs-date">{obs.dateLabel}</div>
  </div>
);
};

  // NEW: grouped renderer with collapsed stack
  const renderGroup = (group: {
  key: string;
  label: string;
  items: DashboardObservationRow[];
  
}) => {
  const isExpanded = expandedGroups[group.key] ?? false;
  const count = group.items.length;
  const latest = group.items[0];
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

  /* ------------------------------
     UI
  --------------------------------- */
  // ✅ REVISED RETURN BLOCK (drop-in replacement for what you pasted)
// Notes:
// - Uses your existing variables/functions: renderRow, renderGroup, grouped, filteredAndSorted,
//   actionModal, modalObservation, handlers, AM summary state, etc.
// - No “latest merged” big panel.
// - Keeps your MergedLinkRow + formatLocalTime at bottom unchanged (safe even if unused).

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
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setActionModal(null);
                    handleMergeTeacherWorkbook(modalObservation);
                  }}
                >
                  Merge teacher workbook
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setActionModal(null);
                    handleMergeAdminWorkbook(modalObservation);
                  }}
                >
                  Merge admin workbook
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
                      <th>Status</th>
                      <th>Next steps / key issues</th>
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
                              const value = e.target.value as SummaryStatus;
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
                          <textarea
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

              <div className="am-summary-email-section">
                <div className="am-summary-email-header">
                  <span>Email body (copy into Outlook)</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!emailBody) return;
                      navigator.clipboard
                        ?.writeText(emailBody)
                        .catch((err) =>
                          console.error("Clipboard copy failed", err)
                        );
                    }}
                    disabled={!emailBody}
                  >
                    Copy to clipboard
                  </button>
                </div>

                <textarea
                  className="am-summary-email-textarea"
                  value={emailBody}
                  readOnly
                  rows={10}
                />

                <div className="am-summary-footer">
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
                      Already marked as sent on {sentInfo}
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
  </>
);

// ------------------------------
// (keep these helpers below as-is; safe even if unused)
// ------------------------------
function formatLocalTime(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function MergedLinkRow({
  label,
  url,
  sheetName,
  mergedAt,
}: {
  label: string;
  url: string;
  sheetName?: string;
  mergedAt?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 600, minWidth: 110 }}>{label}</div>

        {sheetName && (
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            ({sheetName})
          </div>
        )}

        {mergedAt && (
          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>
            {formatLocalTime(mergedAt)}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={url}
          readOnly
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.15)",
            fontSize: 12,
          }}
          onFocus={(e) => e.currentTarget.select()}
        />

        <button
          type="button"
          onClick={async () => {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(url);
            }
          }}
          style={{ padding: "8px 10px", borderRadius: 8 }}
          title="Copy link"
        >
          Copy
        </button>

        <button
          type="button"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          style={{ padding: "8px 10px", borderRadius: 8 }}
          title="Open in new tab"
        >
          Open
        </button>
      </div>
    </div>
  );
}
};