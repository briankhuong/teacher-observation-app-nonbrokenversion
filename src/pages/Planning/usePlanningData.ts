import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { getAcademicYearMonths } from '../../utils/planningDates';

export const usePlanningData = (trainerId: string) => {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const months = useMemo(() => getAcademicYearMonths(), []);

  const loadAllData = async () => {
    setLoading(true);
    
    // 1. Fetch Teachers
    const { data: teacherData } = await supabase
      .from('teachers')
      .select('*')
      .eq('trainer_id', trainerId)
      .order('school_name', { ascending: true });

    // 🟢 FILTER LOGIC: Exclude anyone with "Inactive" tag
    // We check if tags is an array and does NOT include "Inactive" (case-insensitive safety)
    const activeTeachers = (teacherData || []).filter((t: any) => {
      const tags = Array.isArray(t.tags) ? t.tags : [];
      return !tags.some((tag: string) => tag.toLowerCase() === 'inactive');
    });

    setTeachers(activeTeachers);

    // 2. Fetch Support Plans
    const monthKeys = months.map(m => m.key);
    const { data: planData } = await supabase
      .from('support_plans')
      .select('*')
      .in('month_key', monthKeys);
    setPlans(planData || []);

    // 3. Fetch Observations (only for the active teachers we just filtered)
    const grapeseedIds = activeTeachers.map((t: any) => t.grapeseed_id).filter(Boolean);
    
    if (grapeseedIds.length > 0) {
      const { data: observationData } = await supabase
        .from('observations')
        .select('grapeseed_id, school_name, observation_date, support_type')
        .in('grapeseed_id', grapeseedIds);
      setObsData(observationData || []);
    } else {
      setObsData([]);
    }

    setLoading(false);
  };

  useEffect(() => { if (trainerId) loadAllData(); }, [trainerId]);

  // Grouping Logic (unchanged, but now works on cleaner list)
  const groupedData = useMemo(() => {
    const groups: any = {};
    teachers.forEach(t => {
      if (!groups[t.school_name]) groups[t.school_name] = {};
      if (!groups[t.school_name][t.campus]) groups[t.school_name][t.campus] = [];
      groups[t.school_name][t.campus].push(t);
    });
    return groups;
  }, [teachers]);

  return { groupedData, plans, obsData, months, loading, refresh: loadAllData };
};