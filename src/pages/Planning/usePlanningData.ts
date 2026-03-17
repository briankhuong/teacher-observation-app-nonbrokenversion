import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';

export const usePlanningData = (trainerId: string) => {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  // NEW: Store raw school data and the lookup map
  const [schools, setSchools] = useState<any[]>([]);
  const [schoolMap, setSchoolMap] = useState<Record<string, any>>({});
  
  const [loading, setLoading] = useState(true);

  // 1. Define the Academic Year (Sept - Aug)
  const months = useMemo(() => {
    const monthsArray = [];
    const startYear = 2025;
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
  }, []);

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
    setPlans(planData || []);

    // 5. Fetch Observations
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

  return { 
    teachers, 
    groupedData, 
    plans, 
    obsData, 
    months, 
    schools,    // Raw array (optional use)
    schoolMap,  // The MVP for the emailer
    loading, 
    refresh: loadAllData 
  };
};