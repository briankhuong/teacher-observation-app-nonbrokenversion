import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
// Default to whichever academic year "today" falls in (Sept–Aug)
const getDefaultAcademicYearStart = () => {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed; 8 = September
  return month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
};
// Helper: normalize an observation date into a "YYYY-MM" month key
function toMonthKey(dateStr: string): string {
  const [y, m] = dateStr.split('T')[0].split('-');
  return `${y}-${m}`;
}
// Reconciliation: find planned support_plans rows that now have a matching completed observation.
// Match priority: teacher_id (unique per teacher+campus) first; falls back to grapeseed_id + school_name
// for older observation rows where teacher_id wasn't populated yet.
// Cancelled plans are NEVER touched, even if a matching observation exists.
function reconcilePlansWithObservations(
  plans: any[],
  observations: any[],
  monthKeys: Set<string>
): string[] {
  const candidatePlans = plans.filter(p => p.status === 'planned');
  if (candidatePlans.length === 0) return [];
  // Group candidate plans by teacher_id + month_key + activity_type
  const planGroups: Record<string, any[]> = {};
  candidatePlans.forEach(p => {
    const key = `${p.teacher_id}|${p.month_key}|${p.activity_type}`;
    (planGroups[key] ||= []).push(p);
  });
  // Group observations two ways: by teacher_id (preferred) and by grapeseed_id+school_name (fallback)
  const obsByTeacherId: Record<string, any[]> = {};
  const obsByGrapeseed: Record<string, any[]> = {};
  observations.forEach(o => {
    if (!o.observation_date) return;
    const monthKey = toMonthKey(o.observation_date);
    if (!monthKeys.has(monthKey)) return;
    if (o.teacher_id) {
      const key = `${o.teacher_id}|${monthKey}|${o.support_type}`;
      (obsByTeacherId[key] ||= []).push(o);
    } else {
      const key = `${o.grapeseed_id}|${o.school_name}|${monthKey}|${o.support_type}`;
      (obsByGrapeseed[key] ||= []).push(o);
    }
  });
  const idsToComplete: string[] = [];
  Object.entries(planGroups).forEach(([key, groupPlans]) => {
    const [teacherId, monthKey, activityType] = key.split('|');
    let matchedObs = obsByTeacherId[`${teacherId}|${monthKey}|${activityType}`];
    if (!matchedObs) {
      const p0 = groupPlans[0];
      matchedObs = obsByGrapeseed[`${p0.grapeseed_id}|${p0.school_name}|${monthKey}|${activityType}`];
    }
    if (!matchedObs || matchedObs.length === 0) return;
    // Pair oldest plans with oldest observations, in case of multiple supports of the same type/month
    const sortedPlans = [...groupPlans].sort((a, b) => (a.support_sequence || 0) - (b.support_sequence || 0));
    const sortedObs = [...matchedObs].sort((a, b) => a.observation_date.localeCompare(b.observation_date));
    const matchCount = Math.min(sortedPlans.length, sortedObs.length);
    for (let i = 0; i < matchCount; i++) {
      idsToComplete.push(sortedPlans[i].id);
    }
  });
  return idsToComplete;
}
export const usePlanningData = (trainerId: string, academicYearStart?: number) => {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  // NEW: Store raw school data and the lookup map
  const [schools, setSchools] = useState<any[]>([]);
  const [schoolMap, setSchoolMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  // 1. Define the Academic Year (Sept - Aug)
  const startYear = academicYearStart ?? getDefaultAcademicYearStart();
  const months = useMemo(() => {
    const monthsArray = [];
    const startMonthIndex = 8; // Sept (Index 8)
    for (let i = 0; i < 12; i++) {
      const d = new Date(startYear, startMonthIndex + i, 15);
      const year = d.getFullYear();
      const monthStr = String(d.getMonth() + 1).padStart(2, '0');
      monthsArray.push({
        key: `${year}-${monthStr}`,
        label: d.toLocaleString('default', { month: 'short' }),
        year: year
      });
    }
    return monthsArray;
  }, [startYear]);
  const loadAllData = async () => {
    setLoading(true);
    // 1. Fetch Schools (Now fetching ID)
    // 1. Fetch Schools (Now fetching ID)
    const { data: schoolData, error: schoolError } = await supabase
      .from('schools')
      // 🟢 Added campus_id here!
      .select('id, name:school_name, campus_id, admin_email, am_email, official_code');
    if (schoolError) console.error('Error fetching schools:', schoolError);
    // Create the Lookup Map using ID (UUID) as the key
    const sMap: Record<string, any> = {};
    (schoolData || []).forEach((s: any) => {
      if (s.id) sMap[s.id] = s;
      if (s.name) sMap[s.name] = s;
    });
    setSchools(schoolData || []);
    setSchoolMap(sMap);
    // 3. Fetch Teachers (UPDATED)
    const { data: teacherData } = await supabase
      .from('teachers')
      .select('*, email, school_id') // <--- Ensure school_id is fetched
      .eq('trainer_id', trainerId)
      .order('school_name', { ascending: true });
    const activeTeachers = (teacherData || []).filter((t: any) => {
      const tags = Array.isArray(t.tags) ? t.tags : [];
      return !tags.some((tag: string) => tag.toLowerCase() === 'inactive');
    });
    setTeachers(activeTeachers);
    // 4. Fetch Support Plans
    const monthKeys = months.map(m => m.key);
    const { data: planData } = await supabase
      .from('support_plans')
      .select('*')
      .in('month_key', monthKeys);
    // 5. Fetch Observations
    // Scoped by teacher_id (reliable, unique per teacher+campus) rather than grapeseed_id,
    // since grapeseed_id can be shared across multiple teacher rows (same person, different campus)
    // and any mismatch there would silently exclude valid observations from reconciliation.
    const teacherIds = activeTeachers.map((t: any) => t.id).filter(Boolean);
    const grapeseedIds = activeTeachers.map((t: any) => t.grapeseed_id).filter(Boolean);
    let observationData: any[] = [];
    if (teacherIds.length > 0 || grapeseedIds.length > 0) {
      const { data } = await supabase
        .from('observations')
        .select('teacher_id, grapeseed_id, school_name, observation_date, support_type')
        .or(
          [
            teacherIds.length > 0 ? `teacher_id.in.(${teacherIds.join(',')})` : null,
            grapeseedIds.length > 0 ? `grapeseed_id.in.(${grapeseedIds.join(',')})` : null,
          ].filter(Boolean).join(',')
        );
      observationData = data || [];
    }
    setObsData(observationData);
    // 6. RECONCILE: auto-complete planned support_plans that now have a matching observation.
    // Cancelled plans are left untouched; already-completed plans are skipped (filtered inside).
    let finalPlans = planData || [];
    const monthKeySet = new Set(months.map(m => m.key));
    const idsToComplete = reconcilePlansWithObservations(finalPlans, observationData, monthKeySet);
    if (idsToComplete.length > 0) {
      const { error: reconcileError } = await supabase
        .from('support_plans')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .in('id', idsToComplete);
      if (reconcileError) {
        console.error('Auto-complete reconciliation failed:', reconcileError);
      } else {
        const completedSet = new Set(idsToComplete);
        finalPlans = finalPlans.map(p => completedSet.has(p.id) ? { ...p, status: 'completed' } : p);
      }
    }
    setPlans(finalPlans);
    setLoading(false);
  };
  useEffect(() => { if (trainerId) loadAllData(); }, [trainerId, startYear]);
  const groupedData = useMemo(() => {
    const groups: any = {};
    teachers.forEach(t => {
      if (!groups[t.school_name]) groups[t.school_name] = {};
      if (!groups[t.school_name][t.campus]) groups[t.school_name][t.campus] = [];
      groups[t.school_name][t.campus].push(t);
    });
    return groups;
  }, [teachers]);
  return {
    teachers,
    groupedData,
    plans,
    obsData,
    months,
    schools,    // Raw array (optional use)
    schoolMap,  // The MVP for the emailer
    loading,
    refresh: loadAllData,
    academicYearStart: startYear
  };
};