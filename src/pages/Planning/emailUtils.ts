// src/pages/Planning/emailUtils.ts
export interface EmailBatch {
  id: string;
  schoolName: string;
  officialCode?: string;
  campusId?: string;
  visitationLink?: string;
  type: 'LVA' | 'Visit';
  supportSequence?: number;
  monthName?: string;
  adminEmail?: string;
  amEmail?: string;
  editableTo?: string;
  editableCc?: string;
  editableSubject?: string;
  editableBody?: string;
  meta: {
    deadline?: string;
    visitDate?: string;
  };
  teachers: {
    id: string;
    name: string;
    email: string;
    campus: string;
    planId?: string;
    meta?: {
      classTime?: string;
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
  const batches: EmailBatch[] = [];
  selectedIds.forEach(teacherId => {
    const teacher = teachers.find(t => t.id === teacherId);
    if (!teacher) return;
    const teacherPlans = plans.filter(
      p => p.teacher_id === teacherId && p.month_key === targetMonthKey
    );
    teacherPlans.forEach(plan => {
      const schoolData = schoolMap[teacher.school_id] || schoolMap[teacher.school_name] || {};
      const monthName = new Date(targetMonthKey + '-01').toLocaleString('default', { month: 'long' });
      batches.push({
        id: plan.id,
        schoolName: teacher.school_name,
        officialCode: schoolData.official_code,
        campusId: schoolData.campus_id,
        type: plan.activity_type as 'LVA' | 'Visit',
        supportSequence: plan.support_sequence || 1,
        monthName,
        adminEmail: schoolData.admin_email || '',
        amEmail: schoolData.am_email || '',
        teachers: [{
          id: teacher.id,
          name: teacher.name,
          email: teacher.email || '',
          campus: teacher.campus,
          planId: plan.id,
          meta: { classTime: plan.meta?.visitTime || '' }
        }],
        visitationLink: '',
        editableTo: teacher.email,
        editableCc: '',
        editableSubject: '',
        editableBody: '',
        meta: {
          deadline: plan.meta?.deadline || '',
          visitDate: plan.meta?.visitDate || ''
        }
      });
    });
  });
  return batches;
};
const generateSubject = (type: 'LVA' | 'Visit', schoolName: string, monthKey: string) => {
  const [year, month] = monthKey.split('-');
  const dateObj = new Date(parseInt(year), parseInt(month) - 1);
  const monthName = dateObj.toLocaleString('default', { month: 'long' });
  return type === 'Visit'
    ? `[GrapeSEED] - Onsite visit at ${schoolName} in ${monthName}`
    : `[GrapeSEED] - Lesson video analysis support at ${schoolName} in ${monthName}`;
};