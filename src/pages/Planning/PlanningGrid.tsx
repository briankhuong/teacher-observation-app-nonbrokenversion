import React, { useState, useEffect, useRef } from 'react';
import { usePlanningData } from './usePlanningData';
import { useAuth } from '../../auth/AuthContext';
import { supabase } from '../../supabaseClient';
import GridCell from './GridCell';
import PlanningContextMenu from './PlanningContextMenu';
import SchoolViewPopover from './SchoolViewPopover';
import type { SchoolViewPopoverRow } from './SchoolViewPopover';
import {
  Brush,
  Eraser,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Calendar,
  Save,
  ChevronsDown,
  ChevronsRight,
  X,
  Search
} from 'lucide-react';
import './Planning.css';
import { groupSelectedToBatches } from './emailUtils';
import EmailDraftModal from './EmailDraftModal';
import type { EmailBatch } from './emailUtils';
import { GrapeSeedLoginModal } from '../../components/GrapeSeedLoginModal';
import { flattenText } from "../../utils/textUtils";
// At the top of PlanningGrid.tsx
const isSameMonth = (obsDate: string, monthKey: string) => {
  if (!obsDate || !monthKey) return false;
  // 1. Get numbers from Observation (e.g., "2025-09-13" -> 2025 and 09)
  const [oYear, oMonth] = obsDate.split('T')[0].split('-').map(n => parseInt(n, 10));
  const oCoordinate = (oYear * 100) + oMonth; // Results in 202509
  // 2. Get numbers from Column Key (e.g., "2025-09" -> 2025 and 09)
  const [kYear, kMonth] = monthKey.split('-').map(n => parseInt(n, 10));
  const kCoordinate = (kYear * 100) + kMonth; // Results in 202509
  return oCoordinate === kCoordinate;
};
// Determine which academic year (Sept–Aug) "today" falls in
const getDefaultAcademicYearStart = () => {
  const now = new Date();
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
};
const PlanningGrid: React.FC = () => {
  const { user } = useAuth();
  const [academicYearStart, setAcademicYearStart] = useState(getDefaultAcademicYearStart());
  const { teachers, groupedData, plans, obsData, months, loading, refresh, schoolMap } =
    usePlanningData(user?.id || '', academicYearStart);
  const [emailDrafts, setEmailDrafts] = useState<EmailBatch[]>([]);
  const [activeTool, setActiveTool] = useState<'LVA' | 'Visit' | 'Eraser' | null>(null);
  const [expandedSchools, setExpandedSchools] = useState<Record<string, boolean>>({});
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, any>>({});
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  // --- EMAIL OUTREACH STATE ---
  const [isEmailMode, setIsEmailMode] = useState(false);
  const [isGeneratingDrafts, setIsGeneratingDrafts] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [emailFilters, setEmailFilters] = useState<{ month: string; types: string[] }>({
    month: months[0]?.key || '',
    types: ['LVA', 'Visit']
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  // --- SCHOOL VIEW TOGGLE ---
  const [isSchoolView, setIsSchoolView] = useState(false);
  // --- MULTI-CHIP SEARCH STATE (Excel-style filter) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchChips, setSearchChips] = useState<string[]>([]);
  // --- MONTH HEADER FILTER (click a month to show only schools/campuses/teachers active that month) ---
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  // Suggestions shown in the dropdown while typing, drawn from teacher/school/campus names
  const searchSuggestions = React.useMemo(() => {
    const q = flattenText(searchQuery);
    if (!q) return [];
    const seen = new Set<string>();
    const results: { label: string; type: string }[] = [];
    teachers.forEach((t: any) => {
      if (t.name && flattenText(t.name).includes(q) && !searchChips.includes(t.name) && !seen.has(`teacher:${t.name}`)) {
        seen.add(`teacher:${t.name}`);
        results.push({ label: t.name, type: 'Teacher' });
      }
      if (t.school_name && flattenText(t.school_name).includes(q) && !searchChips.includes(t.school_name) && !seen.has(`school:${t.school_name}`)) {
        seen.add(`school:${t.school_name}`);
        results.push({ label: t.school_name, type: 'School' });
      }
      if (t.campus && flattenText(t.campus).includes(q) && !searchChips.includes(t.campus) && !seen.has(`campus:${t.campus}`)) {
        seen.add(`campus:${t.campus}`);
        results.push({ label: t.campus, type: 'Campus' });
      }
    });
    return results.slice(0, 8);
  }, [searchQuery, teachers, searchChips]);
  const addSearchChip = (label: string) => {
    setSearchChips(prev => (prev.includes(label) ? prev : [...prev, label]));
    setSearchQuery('');
  };
  const removeSearchChip = (label: string) => {
    setSearchChips(prev => prev.filter(c => c !== label));
  };
  // --- UPGRADED SEARCH HELPER: OR-matches across all selected chips ---
  const matchesSearch = React.useCallback((teacher: any, schoolName: string, campusName: string) => {
    if (searchChips.length === 0) return true;
    return searchChips.some(chip => {
      const q = flattenText(chip);
      return (
        flattenText(teacher.name).includes(q) ||
        flattenText(teacher.email).includes(q) ||
        flattenText(schoolName).includes(q) ||
        flattenText(campusName).includes(q)
      );
    });
  }, [searchChips]);
  const tableRef = useRef<HTMLTableElement | null>(null);
  // Reset pending edits/selections and re-anchor email target month whenever the year changes
  useEffect(() => {
    setPendingUpdates({});
    setPendingDeletes(new Set());
    setSelectedIds(new Set());
    setExcludedIds(new Set());
    setSearchChips([]);
    setSearchQuery('');
    setMonthFilter(null);
    setEmailFilters(prev => ({ ...prev, month: months[0]?.key || '' }));
    setHasInitializedExpand(false);
  }, [academicYearStart]);
  // Helper to check if a teacher matches the current email filters
  const matchesEmailFilter = (teacher: any) => {
    if (!isEmailMode) return true; // Show everyone in planning mode
    if (excludedIds.has(teacher.id)) return false; // Hide if "minused"
    // 1. STRICT PLAN CHECK: Must match the unique teacher_id for this row
    const plan = plans.find(p =>
      p.teacher_id === teacher.id &&
      p.month_key === emailFilters.month
    );
    // 2. STRICT OBSERVATION CHECK: Must match Grapeseed ID AND School Name
    // (Prevents an observation at School A from lighting up the row for School B)
    const obs = obsData.find(o =>
      o.grapeseed_id === teacher.grapeseed_id &&
      o.school_name === teacher.school_name && // <--- CRITICAL FIX
      isSameMonth(o.observation_date, emailFilters.month)
    );
    // Determine activity: check Completed first, then Planned
    const activity = obs ? obs.support_type : plan?.activity_type;
    if (!activity) return false;
    return emailFilters.types.includes(activity);
  };
  const [hasInitializedExpand, setHasInitializedExpand] = useState(false);
  const [menuConfig, setMenuConfig] = useState<{
    x: number, y: number, teacher: any, monthKey: string, plan: any
  } | null>(null);
  // --- SCHOOL VIEW BULK-EDIT POPOVER ---
  const [schoolViewPopover, setSchoolViewPopover] = useState<{
    x: number; y: number; mode: 'apply' | 'erase';
    school: string; campus: string; monthKey: string; monthLabel: string;
    teacherList: any[]; rows: SchoolViewPopoverRow[];
  } | null>(null);
  const hasChanges = Object.keys(pendingUpdates).length > 0 || pendingDeletes.size > 0;
  useEffect(() => {
    if (!loading && !hasInitializedExpand && Object.keys(groupedData).length > 0) {
      const newExpandedState: Record<string, boolean> = {};
      Object.entries(groupedData).forEach(([school, campuses]: any) => {
        let hasActivity = false;
        Object.values(campuses).forEach((teacherList: any) => {
          teacherList.forEach((t: any) => {
            const hasPlan = plans.some(p => p.teacher_id === t.id);
            const hasObs = obsData.some(o => o.grapeseed_id === t.grapeseed_id && o.school_name === t.school_name);
            if (hasPlan || hasObs) hasActivity = true;
          });
        });
        if (hasActivity) newExpandedState[school] = true;
      });
      setExpandedSchools(newExpandedState);
      setHasInitializedExpand(true);
    }
  }, [loading, groupedData, plans, obsData, hasInitializedExpand]);
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    let lastColIndex: number | null = null;
    const handleMouseOver = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest("td") as HTMLTableCellElement | null;
      if (!cell || !table.contains(cell)) return;
      const colIndex = cell.cellIndex;
      if (colIndex === 0) return; // ignore sticky column
      if (lastColIndex === colIndex) return;
      // Remove old column highlight
      if (lastColIndex !== null) {
        table.querySelectorAll(`td:nth-child(${lastColIndex + 1})`)
          .forEach(td => td.classList.remove("col-hover"));
      }
      // Add new column highlight
      table.querySelectorAll(`td:nth-child(${colIndex + 1})`)
        .forEach(td => td.classList.add("col-hover"));
      lastColIndex = colIndex;
    };
    const handleLeave = () => {
      if (lastColIndex !== null) {
        table.querySelectorAll(`td:nth-child(${lastColIndex + 1})`)
          .forEach(td => td.classList.remove("col-hover"));
      }
      lastColIndex = null;
    };
    table.addEventListener("mouseover", handleMouseOver);
    table.addEventListener("mouseleave", handleLeave);
    return () => {
      table.removeEventListener("mouseover", handleMouseOver);
      table.removeEventListener("mouseleave", handleLeave);
    };
  }, []);
  const toggleSchool = (schoolName: string) => {
    setExpandedSchools(prev => ({ ...prev, [schoolName]: !prev[schoolName] }));
  };
  const expandAll = () => {
    const allOpen: Record<string, boolean> = {};
    Object.keys(groupedData).forEach(k => allOpen[k] = true);
    setExpandedSchools(allOpen);
  };
  const collapseAll = () => {
    setExpandedSchools({});
  };
  const handleOpenMenu = (x: number, y: number, teacher: any, monthKey: string, plan: any) => {
    setMenuConfig({ x, y, teacher, monthKey, plan });
  };
  // --- ROBUST QUEUE HANDLER (Fixes the Delete/Re-plan Conflict) ---
  const handleQueueChange = (action: 'upsert' | 'delete', key: string, payload?: any, id?: string, sequence?: number) => {
    setPendingUpdates(prev => {
      const next = { ...prev };
      if (action === 'delete') {
        delete next[key];
      } else if (payload) {
        next[key] = payload;
      }
      return next;
    });
    if (id) {
      setPendingDeletes(prev => {
        const next = new Set(prev);
        if (action === 'delete') {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
    }
  };
  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      // 1. Bulk Upsert (Inserts + Updates)
      const updatesArray = Object.values(pendingUpdates);
      if (updatesArray.length > 0) {
        // CLEANUP: We must strictly exclude 'id' if it's missing (New Plan)
        // otherwise Postgres throws "null value in column id violates not-null constraint"
        const cleanUpdates = updatesArray.map(p => {
          // Base object with NO ID
          const record: any = {
            trainer_id: p.trainer_id,
            teacher_id: p.teacher_id,
            grapeseed_id: p.grapeseed_id,
            month_key: p.month_key,
            activity_type: p.activity_type,
            status: p.status,
            updated_at: p.updated_at
          };
          // Only add ID if it actually exists (Update Mode)
          if (p.id) {
            record.id = p.id;
          }
          return record;
        });
        const { error: upsertError } = await supabase
          .from('support_plans')
          .upsert(cleanUpdates, { onConflict: 'id' });
        if (upsertError) throw upsertError;
      }
      // 2. Bulk Delete
      // Filter out any undefined IDs to prevent "eq.undefined" 400 errors
      const idsToDelete = Array.from(pendingDeletes).filter(id => id);
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('support_plans')
          .delete()
          .in('id', idsToDelete);
        if (deleteError) throw deleteError;
      }
      // 3. Success! Clear queues and refresh data
      setPendingUpdates({});
      setPendingDeletes(new Set());
      await refresh();
    } catch (err: any) {
      console.error("Batch save failed:", err);
      alert(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };
  // 1. Add this constant at the top of the file (or inside the component)
  const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";
  const handleDraftEmails = async () => {
    console.log("🚀 STARTING DRAFT PROCESS...");
    // 1. ✅ CHECK LOCAL STORAGE FOR THE GRAPESEED TOKEN
    const gsToken = localStorage.getItem('grapeseed_token');
    if (!gsToken) {
      console.log("⚠️ GrapeSEED token missing! Opening login modal...");
      setShowLoginModal(true); // Pop the gate!
      return; // Stop the function here
    }
    setIsGeneratingDrafts(true);
    // 2. Filter visible IDs
    const visibleSelectedIds = new Set<string>();
    teachers.forEach(t => {
      if (selectedIds.has(t.id) && matchesEmailFilter(t)) {
        visibleSelectedIds.add(t.id);
      }
    });
    // 3. Create Base Batches
    const rawDrafts = groupSelectedToBatches(
      visibleSelectedIds,
      teachers,
      plans,
      schoolMap,
      emailFilters.month
    );
    console.log(`📦 Generated ${rawDrafts.length} base drafts.`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      // 4. ENRICH WITH API LINKS
      const enrichedDrafts = await Promise.all(rawDrafts.map(async (draft) => {
        console.log(`🔍 Processing Draft: ${draft.schoolName} (${draft.type})`);
        if (!draft.officialCode) {
          console.warn(`   ❌ MISSING OFFICIAL CODE for ${draft.schoolName}. Cannot fetch link.`);
          return draft;
        }
        try {
          const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
          const response = await fetch(`${API_BASE_URL}/api/match-visitation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              schoolCode: draft.officialCode,
              monthKey: emailFilters.month,
              type: draft.type,
              coachId: user?.id,
              userToken: gsToken, // ✅ PASSED SECURELY TO BACKEND
              campusId: draft.campusId // 🟢 ADDED: Send the campus ID to the backend!
            }),
            signal: controller.signal
          });
          // ✅ SAFETY NET: If the saved token is expired/invalid, clear it and ask again
          if (response.status === 401) {
            localStorage.removeItem('grapeseed_token');
            throw new Error("Token expired");
          }
          const result = await response.json();
          if (result.match?.linkId) {
            const link = `https://schools.grapeseed.com/regions/${VIETNAM_REGION_ID}/schools/${draft.officialCode}/visitations/${result.match.linkId}/teacher`;
            return { ...draft, visitationLink: link };
          }
        } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          // If the token expired, bubble it up to trigger the modal again
          if (err.message === "Token expired") throw err;
          console.error(`   🔥 API FAILURE for ${draft.schoolName}`, err);
        }
        return draft;
      }));
      clearTimeout(timeoutId);
      setEmailDrafts(enrichedDrafts);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        alert("⏱️ The server is waking up from sleep (taking longer than 15s). Please wait a moment and click 'Draft Emails' again.");
      } else if (err.message === "Token expired") {
        alert("⏱️ Your GrapeSEED session expired. Please log in again.");
        setShowLoginModal(true);
      } else {
        console.error("Draft generation failed:", err);
        alert("❌ Failed to generate drafts. Please check your connection and try again.");
      }
    } finally {
      setIsGeneratingDrafts(false);
    }
  };
  // --- HELPER: Calculate Effective Counts (Visible Rows Only) ---
  const getMonthCounts = (monthKey: string) => {
    let lvaCount = 0;
    let visitCount = 0;
    // Iterate through all teachers to check their status for this month
    Object.values(groupedData).forEach((campuses: any) => {
      Object.values(campuses).forEach((teachers: any) => {
        teachers.forEach((t: any) => {
          // 1. VISIBILITY CHECK: If the teacher is hidden by filters, SKIP them.
          // This ensures the counters only reflect what is on the screen.
          if (!matchesEmailFilter(t)) return;
          const cellKey = `${t.id}-${monthKey}`;
          // 2. Check Completion (Highest Priority)
          const obs = obsData.find((o: any) =>
            o.grapeseed_id === t.grapeseed_id &&
            o.school_name === t.school_name &&
            o.observation_date &&
            isSameMonth(o.observation_date, monthKey)
          );
          if (obs) {
            if (obs.support_type === 'LVA') lvaCount++;
            else if (obs.support_type === 'Visit') visitCount++;
            return;
          }
          // 3. Check Drafts (Pending Updates)
          const draft = pendingUpdates[cellKey];
          if (draft) {
            if (draft.activity_type === 'LVA') lvaCount++;
            else if (draft.activity_type === 'Visit') visitCount++;
            return;
          }
          // 4. Check Database Plans (if not deleted)
          const plan = plans.find((p: any) => p.teacher_id === t.id && p.month_key === monthKey);
          if (plan && !pendingDeletes.has(plan.id) && plan.status !== 'cancelled') {
            if (plan.activity_type === 'LVA') lvaCount++;
            else if (plan.activity_type === 'Visit') visitCount++;
          }
        });
      });
    });
    return { lva: lvaCount, visit: visitCount };
  };
  // --- HELPER: Did ANY teacher at this campus have a Visit this month? (1/month, not per-teacher) ---
  const campusHasVisit = (teacherList: any[], school: string, campus: string, monthKey: string): boolean => {
    return teacherList.some((t: any) => {
      if (!matchesEmailFilter(t) || !matchesSearch(t, school, campus)) return false;
      const status = getTeacherVisitStatus(t, monthKey);
      return status.activity_type === 'Visit';
    });
  };
  // --- HELPER: Year-total = number of distinct months this campus had a Visit (not teacher headcount) ---
  const getCampusYearTotal = (teacherList: any[], school: string, campus: string) => {
    return months.reduce((sum, m) => sum + (campusHasVisit(teacherList, school, campus, m.key) ? 1 : 0), 0);
  };
  // --- HELPER: Month header count for School View = number of campuses with a Visit that month ---
  const getSchoolViewMonthVisitCount = (monthKey: string) => {
    let visitCount = 0;
    Object.entries(groupedData).forEach(([school, campuses]: any) => {
      Object.entries(campuses).forEach(([campus, teacherList]: any) => {
        if (campusHasVisit(teacherList, school, campus, monthKey)) visitCount++;
      });
    });
    return visitCount;
  };
  // --- HELPER: Resolve a single teacher's Visit-relevant status for a month ---
  type TeacherVisitStatus =
    | { kind: 'obs'; activity_type: string; planId?: undefined }
    | { kind: 'draft'; activity_type: string; planId?: string }
    | { kind: 'plan'; activity_type: string; planId: string }
    | { kind: 'none'; activity_type?: undefined; planId?: undefined };
  const getTeacherVisitStatus = (teacher: any, monthKey: string): TeacherVisitStatus => {
    const obs = obsData.find((o: any) =>
      o.grapeseed_id === teacher.grapeseed_id &&
      o.school_name === teacher.school_name &&
      o.observation_date &&
      isSameMonth(o.observation_date, monthKey)
    );
    if (obs) return { kind: 'obs', activity_type: obs.support_type };
    const cellKey = `${teacher.id}-${monthKey}`;
    const draft = pendingUpdates[cellKey];
    if (draft) return { kind: 'draft', activity_type: draft.activity_type, planId: draft.id };
    const plan = plans.find((p: any) => p.teacher_id === teacher.id && p.month_key === monthKey);
    if (plan && !pendingDeletes.has(plan.id) && plan.status !== 'cancelled') {
      return { kind: 'plan', activity_type: plan.activity_type, planId: plan.id };
    }
    return { kind: 'none' };
  };
  // --- MONTH HEADER FILTER: does this teacher have relevant activity in the filtered month? ---
  // School View only cares about Visit (it's Visit-only); normal view counts LVA or Visit.
  const matchesMonthFilter = (teacher: any): boolean => {
    if (!monthFilter) return true;
    const status = getTeacherVisitStatus(teacher, monthFilter);
    if (!status.activity_type) return false;
    if (isSchoolView) return status.activity_type === 'Visit';
    return true; // any activity type (LVA or Visit) counts in normal view
  };
  // --- SCHOOL VIEW: open the "Apply Visit" popover for a campus/month ---
  const openApplyVisitPopover = (
    e: React.MouseEvent, school: string, campus: string,
    teacherList: any[], monthKey: string, monthLabel: string
  ) => {
    e.stopPropagation();
    const visible = teacherList.filter((t: any) => matchesEmailFilter(t) && matchesSearch(t, school, campus));
    const rows: SchoolViewPopoverRow[] = visible.map((t: any) => {
      const status = getTeacherVisitStatus(t, monthKey);
      let statusLabel = 'No plan';
      if (status.kind === 'obs') statusLabel = `Completed: ${status.activity_type}`;
      else if (status.kind === 'draft' || status.kind === 'plan') statusLabel = `Has ${status.activity_type}`;
      return {
        teacherId: t.id,
        name: t.name,
        statusLabel,
        defaultChecked: status.kind !== 'obs', // don't silently overwrite a completed observation
      };
    });
    setSchoolViewPopover({
      x: e.clientX, y: e.clientY, mode: 'apply',
      school, campus, monthKey, monthLabel, teacherList: visible, rows
    });
  };
  // --- SCHOOL VIEW: open the "Erase Visit" popover for a campus/month ---
  const openEraseVisitPopover = (
    e: React.MouseEvent, school: string, campus: string,
    teacherList: any[], monthKey: string, monthLabel: string
  ) => {
    e.stopPropagation();
    const visible = teacherList.filter((t: any) => matchesEmailFilter(t) && matchesSearch(t, school, campus));
    const eraseable = visible.filter((t: any) => {
      const status = getTeacherVisitStatus(t, monthKey);
      return (status.kind === 'draft' || status.kind === 'plan') && status.activity_type === 'Visit';
    });
    const rows: SchoolViewPopoverRow[] = eraseable.map((t: any) => ({
      teacherId: t.id,
      name: t.name,
      statusLabel: 'Has Visit',
      defaultChecked: true,
    }));
    setSchoolViewPopover({
      x: e.clientX, y: e.clientY, mode: 'erase',
      school, campus, monthKey, monthLabel, teacherList: eraseable, rows
    });
  };
  // --- SCHOOL VIEW: confirm handlers, reuse the existing queue pipeline ---
  const handleApplyVisitConfirm = (checkedIds: Set<string>, teacherList: any[], monthKey: string) => {
    teacherList.forEach((t: any) => {
      if (!checkedIds.has(t.id)) return;
      const status = getTeacherVisitStatus(t, monthKey);
      const existingId = (status.kind === 'plan' || status.kind === 'draft') ? status.planId : undefined;
      const cellKey = `${t.id}-${monthKey}`;
      const payload = {
        id: existingId,
        trainer_id: t.trainer_id,
        teacher_id: t.id,
        grapeseed_id: t.grapeseed_id,
        school_name: t.school_name,
        month_key: monthKey,
        activity_type: 'Visit',
        status: 'planned',
        updated_at: new Date().toISOString()
      };
      handleQueueChange('upsert', cellKey, payload, existingId);
    });
  };
  const handleEraseVisitConfirm = (checkedIds: Set<string>, teacherList: any[], monthKey: string) => {
    teacherList.forEach((t: any) => {
      if (!checkedIds.has(t.id)) return;
      const status = getTeacherVisitStatus(t, monthKey);
      if ((status.kind !== 'plan' && status.kind !== 'draft') || status.activity_type !== 'Visit') return;
      const cellKey = `${t.id}-${monthKey}`;
      handleQueueChange('delete', cellKey, undefined, status.planId);
    });
  };
  if (loading) {
    return (
      <div className="planning-loader" style={{ padding: '40px', color: '#94a3b8', textAlign: 'center' }}>
        <RefreshCw className="spin-icon" style={{ marginBottom: '10px' }} />
        <div>Loading Planning Matrix...</div>
      </div>
    );
  }
  return (
    <div className="planning-container">
      {/* 1. MAIN TOOLBAR */}
      <div className="planning-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
          <div className="app-title" style={{ fontSize: '14px', color: '#f8fafc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={16} color="#3b82f6" />
            Planning Board
          </div>
        </div>
        {/* ACADEMIC YEAR SWITCHER */}
        <select
          value={academicYearStart}
          onChange={(e) => setAcademicYearStart(Number(e.target.value))}
          title="Academic Year"
          style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: '4px',
            color: '#e2e8f0', padding: '4px 8px', fontSize: '12px', marginLeft: '12px'
          }}
        >
          {[academicYearStart - 1, academicYearStart, academicYearStart + 1].map(y => (
            <option key={y} value={y}>{y}–{y + 1}</option>
          ))}
        </select>
        {/* --- MULTI-CHIP SEARCH BAR (Excel-style filter) --- */}
        <div style={{ position: 'relative', marginLeft: '16px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input
              type="text"
              placeholder="Search teacher, school, campus..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchSuggestions.length > 0) {
                  addSearchChip(searchSuggestions[0].label);
                }
              }}
              style={{
                background: '#0f172a', border: '1px solid #334155', borderRadius: '4px',
                color: '#e2e8f0', padding: '4px 8px 4px 28px', fontSize: '12px', width: '220px', outline: 'none'
              }}
            />
            {searchQuery && searchSuggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '4px', width: '220px',
                background: '#0f172a', border: '1px solid #334155', borderRadius: '4px',
                zIndex: 500, maxHeight: '180px', overflowY: 'auto',
                boxShadow: '0 8px 16px rgba(0,0,0,0.4)'
              }}>
                {searchSuggestions.map((s) => (
                  <div
                    key={`${s.type}-${s.label}`}
                    onMouseDown={(e) => e.preventDefault()} // keep input focus so click registers before blur
                    onClick={() => addSearchChip(s.label)}
                    style={{
                      padding: '6px 8px', fontSize: '12px', cursor: 'pointer',
                      color: '#e2e8f0', display: 'flex', justifyContent: 'space-between'
                    }}
                  >
                    <span>{s.label}</span>
                    <span style={{ color: '#64748b', fontSize: '10px' }}>{s.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {searchChips.map(chip => (
            <span key={chip} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              background: '#1e293b', border: '1px solid #334155', borderRadius: '4px',
              padding: '2px 6px', fontSize: '11px', color: '#e2e8f0'
            }}>
              {chip}
              <X size={10} style={{ cursor: 'pointer' }} onClick={() => removeSearchChip(chip)} />
            </span>
          ))}
        </div>
        {/* EMAIL OUTREACH TOGGLE BUTTON */}
        <button
          className={`tool-btn ${isEmailMode ? 'active-lva' : ''}`} // Reusing active style for blue highlight
          onClick={() => setIsEmailMode(!isEmailMode)}
          style={{ marginRight: '12px' }}
        >
          <Calendar size={14} style={{ marginRight: '6px' }} />
          {isEmailMode ? 'Close Outreach' : 'Email Outreach'}
        </button>
        <button
          className={`tool-btn ${isSchoolView ? 'active-visit' : ''}`}
          onClick={() => setIsSchoolView(!isSchoolView)}
          style={{ marginRight: '12px' }}
          title="Toggle School Summary View"
        >
          <Calendar size={14} style={{ marginRight: '6px' }} />
          {isSchoolView ? 'Exit School View' : 'School View'}
        </button>
        <div className="tool-group" style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
          <button className="tool-btn" onClick={expandAll} title="Expand All Schools">
            <ChevronsDown size={14} />
          </button>
          <button className="tool-btn" onClick={collapseAll} title="Collapse All Schools">
            <ChevronsRight size={14} />
          </button>
        </div>
        <div className="tool-group" style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`tool-btn ${activeTool === 'LVA' ? 'active-lva' : ''}`}
            onClick={() => setActiveTool(activeTool === 'LVA' ? null : 'LVA')}
            title="LVA Painter Tool"
          >
            <Brush size={14} style={{ marginRight: '6px' }} /> LVA
          </button>
          <button
            className={`tool-btn ${activeTool === 'Visit' ? 'active-visit' : ''}`}
            onClick={() => setActiveTool(activeTool === 'Visit' ? null : 'Visit')}
            title="Visit Painter Tool"
          >
            <Brush size={14} style={{ marginRight: '6px' }} /> Visit
          </button>
          <button
            className={`tool-btn ${activeTool === 'Eraser' ? 'active-eraser' : ''}`}
            onClick={() => setActiveTool(activeTool === 'Eraser' ? null : 'Eraser')}
            title="Eraser Tool"
          >
            <Eraser size={14} />
          </button>
        </div>
        <div style={{ width: '1px', height: '20px', background: '#334155', margin: '0 12px' }}></div>
        <button
          className="tool-btn"
          onClick={handleSaveChanges}
          disabled={!hasChanges || isSaving}
          title="Save Changes"
          style={{
            background: hasChanges ? '#22c55e' : '#334155',
            color: hasChanges ? 'white' : '#94a3b8',
            borderColor: hasChanges ? '#16a34a' : 'transparent',
            opacity: isSaving ? 0.7 : 1
          }}
        >
          {isSaving ? <RefreshCw className="spin-icon" size={14} /> : <Save size={14} />}
          <span style={{ marginLeft: '6px' }}>{isSaving ? 'Saving...' : 'Save'}</span>
        </button>
        <button className="sync-btn tool-btn" onClick={refresh} title="Refresh Data" style={{ marginLeft: '8px' }}>
          <RefreshCw size={14} />
        </button>
      </div>
      {/* 2. SLIM CONTROL CENTER (Only Visible in Email Mode) */}
      {isEmailMode && (
        <div className="email-control-bar">
          <div className="control-group">
            <span className="control-label">Target:</span>
            <select
              className="control-select"
              value={emailFilters.month}
              onChange={(e) => setEmailFilters(prev => ({ ...prev, month: e.target.value }))}
            >
              {months.map(m => <option key={m.key} value={m.key}>{m.label} {m.year}</option>)}
            </select>
          </div>
          <div className="control-group">
            <span className="control-label">Include:</span>
            {['LVA', 'Visit'].map(type => (
              <label key={type} className="control-checkbox">
                <input
                  type="checkbox"
                  checked={emailFilters.types.includes(type)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...emailFilters.types, type]
                      : emailFilters.types.filter(t => t !== type);
                    setEmailFilters(prev => ({ ...prev, types: next }));
                  }}
                />
                {type}
              </label>
            ))}
          </div>
          <div style={{ flex: 1 }}></div>
          <div className="control-group">
            <span className="selection-count">
              {selectedIds.size} Selected
            </span>
            <button
              className="tool-btn"
              onClick={() => {
                const visibleIds = teachers.filter(matchesEmailFilter).map(t => t.id);
                setSelectedIds(new Set(visibleIds));
              }}
            >
              Select All
            </button>
            <button
              className="tool-btn"
              onClick={() => {
                setSelectedIds(new Set());
                setExcludedIds(new Set());
              }}
            >
              Reset
            </button>
            <button
              className="email-draft-btn"
              disabled={selectedIds.size === 0 || isGeneratingDrafts}
              onClick={handleDraftEmails}
              style={{
                opacity: (selectedIds.size === 0 || isGeneratingDrafts) ? 0.7 : 1,
                cursor: isGeneratingDrafts ? 'wait' : 'pointer'
              }}
            >
              {isGeneratingDrafts ? 'Generating...' : 'Draft Emails'}
            </button>
          </div>
        </div>
      )}
      {/* 3. GRID AREA */}
      <div className="grid-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table
          ref={tableRef}
          className="planning-table"
        >
          <thead>
            <tr>
              {/* NO EXTRA COLUMN HERE - JUST THE STANDARD HEADERS */}
              <th className="sticky-col first-header">
                School / Teacher
              </th>
              {months.map(m => {
                const counts = getMonthCounts(m.key);
                const schoolViewVisit = isSchoolView ? getSchoolViewMonthVisitCount(m.key) : counts.visit;
                const isActiveFilter = monthFilter === m.key;
                return (
                  <th
                    key={m.key}
                    className={`month-header ${isActiveFilter ? 'month-filter-active' : ''}`}
                    onClick={() => setMonthFilter(prev => (prev === m.key ? null : m.key))}
                    title="Click to show only schools with activity this month"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="month-label">{m.label}</div>
                    <div className="month-year">{m.year}</div>
                    <div className="month-total" style={{
                      display: 'flex', justifyContent: 'center', gap: '8px',
                      fontSize: '9px', opacity: 0.8, marginTop: '2px', fontWeight: 500
                    }}>
                      {!isSchoolView && (
                        <span style={{ color: counts.lva > 0 ? '#60a5fa' : 'inherit' }}>LVA: {counts.lva}</span>
                      )}
                      <span style={{ color: schoolViewVisit > 0 ? '#a78bfa' : 'inherit' }}>Visit: {schoolViewVisit}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groupedData).map(([school, campuses]: any) => {
              // Deep Filter Logic: Check email mode AND search query
              const hasVisibleTeacherInSchool = Object.values(campuses).some((teacherList: any) =>
                teacherList.some((t: any) =>
                  matchesEmailFilter(t) && matchesSearch(t, school, Object.keys(campuses)[0] || '') && matchesMonthFilter(t)
                )
              );
              if (!hasVisibleTeacherInSchool) return null; // Hides empty schools entirely
              const isExpanded = !!expandedSchools[school];
              const schoolVisitTotal = plans.filter(p => p.school_name === school && p.activity_type === 'Visit').length;
              return (
                <React.Fragment key={school}>
                  <tr className="school-row" onClick={() => toggleSchool(school)}>
                    <td className="sticky-col school-header-cell">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="school-name-text">{school}</span>
                        </div>
                        {schoolVisitTotal > 0 && (
                          <span className="visit-badge">{schoolVisitTotal} Visits</span>
                        )}
                      </div>
                    </td>
                    {months.map(m => <td key={m.key} className="header-fill"></td>)}
                  </tr>
                  {isExpanded && Object.entries(campuses).map(([campus, teacherList]: any) => {
                    // Filter Campus: Check email mode AND search query
                    const hasVisibleTeacherInCampus = teacherList.some((t: any) =>
                      matchesEmailFilter(t) && matchesSearch(t, school, campus) && matchesMonthFilter(t)
                    );
                    if (!hasVisibleTeacherInCampus) return null; // Hides empty campuses entirely
                    const filteredCampusTeachers = teacherList.filter((t: any) =>
                      matchesEmailFilter(t) && matchesSearch(t, school, campus) && matchesMonthFilter(t)
                    );
                    return (
                      <React.Fragment key={campus}>
                        <tr className="campus-row">
                          <td className="sticky-col campus-header-cell">
                            — {campus}
                            {isSchoolView && (
                              <span className="campus-year-badge">
                                {' '}· Visit: {getCampusYearTotal(teacherList, school, campus)}
                              </span>
                            )}
                          </td>
                          {isSchoolView
                            ? months.map(m => {
                              const hasVisit = campusHasVisit(teacherList, school, campus, m.key);
                              const isLvaActive = activeTool === 'LVA';
                              const monthLabel = `${m.label} ${m.year}`;
                              return (
                                <td
                                  key={m.key}
                                  className={`header-fill school-view-cell ${hasVisit ? 'cell-visit' : ''} ${isLvaActive ? 'cell-disabled' : ''}`}
                                  onClick={(e) => {
                                    if (isLvaActive) return;
                                    if (activeTool === 'Visit') {
                                      openApplyVisitPopover(e, school, campus, filteredCampusTeachers, m.key, monthLabel);
                                    } else if (activeTool === 'Eraser') {
                                      openEraseVisitPopover(e, school, campus, filteredCampusTeachers, m.key, monthLabel);
                                    }
                                  }}
                                >
                                  {hasVisit && <div className="activity-label">Visit</div>}
                                </td>
                              );
                            })
                            : months.map(m => <td key={m.key} className="header-fill"></td>)}
                        </tr>
                        {!isSchoolView && teacherList.map((teacher: any) => {
                          // Filter Teacher
                          if (!matchesEmailFilter(teacher) || !matchesSearch(teacher, school, campus) || !matchesMonthFilter(teacher)) return null;
                          const isSelected = selectedIds.has(teacher.id);
                          return (
                            <tr key={teacher.id} className={`teacher-row ${isSelected ? 'row-selected' : ''}`}>
                              {/* TEACHER NAME CELL WITH EMBEDDED CHECKBOX */}
                              <td className="sticky-col teacher-name">
                                <div style={{
                                  position: 'relative',
                                  width: '100%', height: '100%',
                                  display: 'flex', alignItems: 'center'
                                }}>
                                  {/* THE "GHOST" CHECKBOX - ONLY VISIBLE IN EMAIL MODE */}
                                  {isEmailMode && (
                                    <div
                                      className={`selection-toggle ${isSelected ? 'selected' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const next = new Set(selectedIds);
                                        if (isSelected) next.delete(teacher.id);
                                        else next.add(teacher.id);
                                        setSelectedIds(next);
                                      }}
                                    >
                                      {isSelected && <div className="minus-icon" />}
                                    </div>
                                  )}
                                  {/* Teacher Name Text */}
                                  <div style={{
                                    flex: 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    paddingRight: '8px',
                                    // Transition padding so text doesn't jump abruptly
                                    paddingLeft: isEmailMode ? '24px' : '0px',
                                    transition: 'padding-left 0.2s ease'
                                  }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {teacher.name}
                                    </span>
                                    {/* ... Badge Logic ... */}
                                    {(() => {
                                      const tags = Array.isArray(teacher.tags) ? teacher.tags : [];
                                      const sharedTrainers = tags.filter((t: string) =>
                                        t && t.trim() !== "" && t !== "No tag" && t.toLowerCase() !== "inactive"
                                      );
                                      if (sharedTrainers.length === 0) return null;
                                      return (
                                        <span className="mutual-badge" title={`Shared with: ${sharedTrainers.join(", ")}`}>
                                          {sharedTrainers[0].trim().substring(0, 3).toUpperCase()}
                                          {sharedTrainers.length > 1 && "+"}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </td>
                              {months.map(m => {
                                const cellKey = `${teacher.id}-${m.key}`;
                                const plansForCell = (() => {
                                  const dbPlans = plans.filter(p => p.teacher_id === teacher.id && p.month_key === m.key);
                                  const localUpdates = Object.values(pendingUpdates).filter(
                                    (p: any) => p.teacher_id === teacher.id && p.month_key === m.key
                                  );
                                  // ✅ Deduplicate by plan.id so updates seamlessly overwrite database records in the UI
                                  const planMap = new Map<string, any>();
                                  dbPlans.forEach(p => planMap.set(p.id, p));
                                  localUpdates.forEach(p => planMap.set(p.id, p));
                                  return Array.from(planMap.values());
                                })();
                                return (
                                  <GridCell
                                    key={cellKey}
                                    teacher={teacher}
                                    monthKey={m.key}
                                    activeTool={activeTool}
                                    plansForCell={plansForCell}
                                    pendingDeletes={pendingDeletes} // ✅ Passed down state to trigger local UI updates
                                    matchingObs={obsData.find(o =>
                                      o.grapeseed_id === teacher.grapeseed_id &&
                                      o.school_name === teacher.school_name &&
                                      o.observation_date &&
                                      isSameMonth(o.observation_date, m.key)
                                    )}
                                    allPlans={plans}
                                    allPendingUpdates={pendingUpdates}
                                    onOpenMenu={handleOpenMenu}
                                    onQueueChange={handleQueueChange}
                                  />
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {menuConfig && (
        <PlanningContextMenu
          config={menuConfig}
          onClose={() => setMenuConfig(null)}
          onRefresh={refresh}
          onQueueChange={handleQueueChange}
        />
      )}
      {schoolViewPopover && (
        <SchoolViewPopover
          x={schoolViewPopover.x}
          y={schoolViewPopover.y}
          mode={schoolViewPopover.mode}
          school={schoolViewPopover.school}
          campus={schoolViewPopover.campus}
          monthLabel={schoolViewPopover.monthLabel}
          rows={schoolViewPopover.rows}
          onClose={() => setSchoolViewPopover(null)}
          onConfirm={(checkedIds) => {
            if (schoolViewPopover.mode === 'apply') {
              handleApplyVisitConfirm(checkedIds, schoolViewPopover.teacherList, schoolViewPopover.monthKey);
            } else {
              handleEraseVisitConfirm(checkedIds, schoolViewPopover.teacherList, schoolViewPopover.monthKey);
            }
          }}
        />
      )}
      {emailDrafts.length > 0 && (
        <EmailDraftModal
          isOpen={true}
          onClose={() => setEmailDrafts([])} // Clear drafts to close
          initialDrafts={emailDrafts}
        />
      )}
      {/* ✅ NEW: The GrapeSEED Login Gate */}
      <GrapeSeedLoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={(token) => {
          setShowLoginModal(false);
          // Automatically resume drafting now that we have the token!
          handleDraftEmails();
        }}
      />
    </div>
  );
};
export default PlanningGrid;