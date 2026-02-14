import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';

export const usePlanningData = (trainerId: string) => {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

// Inside usePlanningData.ts
const months = useMemo(() => {
  const monthsArray = [];
  // Academic Year: September 2025 to August 2026
  const startYear = 2025;
  const startMonthIndex = 8; // September is index 8 in JS Date

  for (let i = 0; i < 12; i++) {
    // Create date for the 15th to avoid any timezone/rollover bugs
    const d = new Date(startYear, startMonthIndex + i, 15);
    const year = d.getFullYear();
    // Month + 1 because JS index 8 is September (9th month)
    const monthStr = String(d.getMonth() + 1).padStart(2, '0'); 
    
    monthsArray.push({
      key: `${year}-${monthStr}`, // Sept is correctly "2025-09"
      label: d.toLocaleString('default', { month: 'short' }),
      year: year
    });
  }
  return monthsArray;
}, []);

  const loadAllData = async () => {
    setLoading(true);
    
    // 1. Fetch Teachers
    const { data: teacherData } = await supabase
      .from('teachers')
      .select('*')
      .eq('trainer_id', trainerId)
      .order('school_name', { ascending: true });

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

    // 3. Fetch Observations
    const grapeseedIds = activeTeachers.map((t: any) => t.grapeseed_id).filter(Boolean);
    if (grapeseedIds.length > 0) {
      const { data: observationData } = await supabase
        .from('observations')
        .select('grapeseed_id, school_name, observation_date, support_type')
        .in('grapeseed_id', grapeseedIds);
      setObsData(observationData || []);
    }

    setLoading(false);
  };

  useEffect(() => { if (trainerId) loadAllData(); }, [trainerId]);

  const groupedData = useMemo(() => {
    const groups: any = {};
    teachers.forEach(t => {
      if (!groups[t.school_name]) groups[t.school_name] = {};
      if (!groups[t.school_name][t.campus]) groups[t.school_name][t.campus] = [];
      groups[t.school_name][t.campus].push(t);
    });
    return groups;
  }, [teachers]);

  return { teachers, groupedData, plans, obsData, months, loading, refresh: loadAllData };
};