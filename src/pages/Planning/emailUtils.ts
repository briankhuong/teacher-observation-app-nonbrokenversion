// src/pages/Planning/emailUtils.ts

export interface EmailBatch {
  id: string;
  schoolName: string;
  type: 'LVA' | 'Visit';
  adminEmail: string;
  amEmail: string;
  subject: string;
  meta: {
    deadline: string; 
  };
  teachers: {
    id: string;
    name: string;
    email: string;
    campus: string;
    planId: string;
    meta: {
      classTime: string; 
    };
  }[];
}

export const groupSelectedToBatches = (
  selectedIds: Set<string>,
  teachers: any[],
  plans: any[],
  schoolMap: Record<string, any>,
  targetMonthKey: string
): EmailBatch[] => {
  
  const batches: Record<string, EmailBatch> = {};

  selectedIds.forEach((teacherId) => {
    const teacher = teachers.find(t => t.id === teacherId);
    if (!teacher) return;

    // 1. Find the plan using Teacher ID & Month
    // REMOVED: p.school_name check (caused the empty list bug)
    const plan = plans.find(p => 
      p.teacher_id === teacherId && 
      p.month_key === targetMonthKey
    );
    
    if (!plan) return;

    const type = plan.activity_type as 'LVA' | 'Visit';
    
    // 2. Grouping Key
    // Fallback: If school_id is null, use school_name to ensure we still group
    const schoolKey = teacher.school_id || teacher.school_name;
    const batchKey = `${schoolKey}-${type}`; 

    if (!batches[batchKey]) {
      // 3. Lookup Emails
      // Try looking up by ID first, fallback to Name if ID lookup fails
      const schoolData = schoolMap[teacher.school_id] || schoolMap[teacher.school_name] || {};
      
      batches[batchKey] = {
        id: batchKey,
        schoolName: teacher.school_name,
        type: type,
        adminEmail: schoolData.admin_email || '',
        amEmail: schoolData.am_email || '',
        subject: generateSubject(type, teacher.school_name, targetMonthKey),
        meta: { deadline: '' },
        teachers: []
      };
    }

    batches[batchKey].teachers.push({
      id: teacher.id,
      name: teacher.name,
      email: teacher.email || '',
      campus: teacher.campus,
      planId: plan.id,
      meta: { classTime: '' }
    });
  });

  return Object.values(batches);
};

const generateSubject = (type: 'LVA' | 'Visit', schoolName: string, monthKey: string) => {
  const [year, month] = monthKey.split('-');
  const dateObj = new Date(parseInt(year), parseInt(month) - 1);
  const monthName = dateObj.toLocaleString('default', { month: 'long' });

  return type === 'Visit' 
    ? `[GrapeSEED] - Onsite visit at ${schoolName} in ${monthName}`
    : `[GrapeSEED] - Lesson video analysis support at ${schoolName} in ${monthName}`;
};