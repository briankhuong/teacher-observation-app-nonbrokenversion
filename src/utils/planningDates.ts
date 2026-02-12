export const getAcademicYearMonths = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // If we are currently in Jan-Aug, "this year's" cycle started last Sept.
  // If we are in Sept-Dec, "this year's" cycle starts now.
  const startYear = currentMonth < 8 ? currentYear - 1 : currentYear;
  
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, 8 + i, 1);
    months.push({
      key: d.toISOString().substring(0, 7), // "2025-09"
      label: d.toLocaleString('default', { month: 'short' }),
      year: d.getFullYear()
    });
  }
  return months;
};