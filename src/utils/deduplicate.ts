// Define the shape of a Teacher object
interface Teacher {
  name: string;
  email: string;
  campus: string;
  workbook_link?: string; // This might be empty or undefined
  [key: string]: any; // Allow other columns
}

export function deduplicateTeachers(teachers: Teacher[]): Teacher[] {
  const teacherMap = new Map<string, Teacher>();

  teachers.forEach((currentTeacher) => {
    // 1. Normalize the email to lowercase to ensure matching works
    const emailKey = currentTeacher.email?.toLowerCase().trim();

    // If there is no email, we can't reliably dedup by email. 
    // You might want to handle 'Name + Campus' fallback here, 
    // but for now, we skip rows without emails or pass them through.
    if (!emailKey) {
      // Option A: Skip them? 
      // Option B: Keep them (risky)? 
      // Let's assume we skip invalid rows for safety:
      return; 
    }

    // 2. Check if we already have this email in our Map
    if (teacherMap.has(emailKey)) {
      const existingTeacher = teacherMap.get(emailKey)!;

      // --- THE LOGIC: SAME NAME & EMAIL DETECTED ---
      
      const currentHasLink = !!currentTeacher.workbook_link;
      const existingHasLink = !!existingTeacher.workbook_link;

      // Case 1: The NEW one has a link, but the OLD one didn't.
      // Action: Overwrite the old one with the new one.
      if (currentHasLink && !existingHasLink) {
        teacherMap.set(emailKey, currentTeacher);
      }
      
      // Case 2: Both have links, or neither have links.
      // Action: Do nothing. We keep the first one we found (existingTeacher).
      
      // Case 3: The OLD one has a link, the NEW one doesn't.
      // Action: Do nothing. We keep the valuable one (existingTeacher).

    } else {
      // 3. New email found! Add to Map.
      teacherMap.set(emailKey, currentTeacher);
    }
  });

  // Convert the Map values back into an Array
  return Array.from(teacherMap.values());
}