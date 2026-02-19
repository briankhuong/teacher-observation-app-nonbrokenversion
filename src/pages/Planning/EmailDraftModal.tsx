import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ChevronRight, Mail, ExternalLink, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import './EmailDraftModal.css';

// src/pages/Planning/EmailDraftModal.tsx

export interface EmailBatch {
  id: string;
  schoolName: string;
  officialCode?: string;
  type: 'LVA' | 'Visit';
  
  // ✅ ADDED: Source fields for CC
  adminEmail?: string; 
  amEmail?: string;
  // Support snake_case from DB if that's how it comes in
  admin_email?: string;
  am_email?: string;
  
  // ✅ ADDED: For the subject line
  monthName?: string; 

  teachers: { 
    id: string; 
    name: string; 
    email: string; 
    campus: string; 
    meta?: { classTime?: string };
  }[];
  visitationLink?: string;
  
  // Editable fields
  editableTo?: string; 
  editableCc?: string;
  editableSubject?: string; // ✅ ADDED
  meta: { 
    deadline?: string; 
    visitDate?: string; 
  };
}

interface EmailDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDrafts: EmailBatch[];
}

const EmailDraftModal: React.FC<EmailDraftModalProps> = ({ isOpen, onClose, initialDrafts }) => {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<EmailBatch[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Get Trainer Name
  const trainerName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || "Trainer";
// Initialize drafts
  useEffect(() => {
    if (initialDrafts.length > 0) {
      const processedDrafts = initialDrafts.map(d => {
        // 1. Resolve CC Emails (Check both camelCase and snake_case)
        const admins = [d.adminEmail, d.admin_email, d.amEmail, d.am_email]
          .filter(e => e && e.trim().length > 0); // Remove empty/null
        
        // Remove duplicates and join
        const ccString = [...new Set(admins)].join('; ');

        // 2. Resolve Month (Default to current month if missing)
        const month = d.monthName || new Date().toLocaleString('default', { month: 'long' });

        // 3. Generate Subject Template
        let subject = "";
        if (d.type === 'Visit') {
          subject = `[GrapeSEED] - Onsite visit at ${d.schoolName} in ${month}`;
        } else {
          const teacherText = d.teachers.length > 1 ? "teachers" : "teacher";
          subject = `[GrapeSEED] - Lesson video analysis for ${teacherText} at ${d.schoolName} in ${month}`;
        }

        return {
          ...d,
          editableTo: d.teachers.map(t => t.email).join('; '),
          editableCc: ccString,     // ✅ Pre-filled CC
          editableSubject: subject, // ✅ Pre-filled Subject
          meta: d.meta || {},
          teachers: d.teachers.map(t => ({...t, meta: t.meta || {}}))
        };
      });
      
      setDrafts(processedDrafts);
      setActiveDraftId(processedDrafts[0].id);
    }
  }, [initialDrafts, isOpen]);

  if (!isOpen || drafts.length === 0) return null;

  const activeDraft = drafts.find(d => d.id === activeDraftId) || drafts[0];

  // --- HANDLERS ---

// Update Headers (To/CC/Subject)
  const updateHeader = (field: 'editableTo' | 'editableCc' | 'editableSubject', value: string) => {
    setDrafts(prev => prev.map(d => d.id === activeDraftId ? { ...d, [field]: value } : d));
  };

// Update Batch Meta (LVA Deadline or Visit Date)
  const updateBatchMeta = (key: 'deadline' | 'visitDate', value: string) => {
    setDrafts(prev => prev.map(d => 
      d.id === activeDraftId ? { ...d, meta: { ...d.meta, [key]: value } } : d
    ));
  };

  // Update Teacher Meta (Visit Time)
  const updateTeacherMeta = (teacherId: string, value: string) => {
    setDrafts(prev => prev.map(draft => {
      if (draft.id !== activeDraftId) return draft;
      return {
        ...draft,
        teachers: draft.teachers.map(t => 
          t.id === teacherId ? { ...t, meta: { ...t.meta, classTime: value } } : t
        )
      };
    }));
  };

  // ✅ ADD IT RIGHT HERE
  // Remove a teacher from the current draft
  const removeTeacher = (teacherId: string) => {
    setDrafts(prev => prev.map(draft => {
      if (draft.id !== activeDraftId) return draft;

      // Filter out the teacher
      const updatedTeachers = draft.teachers.filter(t => t.id !== teacherId);
      
      // Update the "To" field to match the remaining teachers
      const updatedTo = updatedTeachers.map(t => t.email).join('; ');

      return {
        ...draft,
        teachers: updatedTeachers,
        editableTo: updatedTo
      };
    }));
  };

  // --- GENERATE BODY ---
  const generateBody = () => {
    const isLVA = activeDraft.type === 'LVA';
    const isMultiple = activeDraft.teachers.length > 1;
    const teacherNames = activeDraft.teachers.map(t => t.name).join(', ');
    
    // Greeting
    const greeting = isMultiple ? "Dear Teachers," : `Dear ${teacherNames},`;

    let body = `${greeting}\n\nI hope you’re doing well.\n\n`;

    // --- LVA TEMPLATE ---
    if (isLVA) {
      body += `To better assess the progress of the students in your GrapeSEED class, I’d like to request a lesson video, due by ${activeDraft.meta.deadline || '[Date]'}. `;
      body += `Please also take a few minutes to complete the questionnaire on the GrapeSEED portal in the link below, as this will provide me with a clearer understanding of the class dynamics and support my feedback.\n\n`;
      body += `Link to the questionnaire: ${activeDraft.visitationLink || '[Link Missing]'}\n\n`;
      body += `For the video, please ensure it is at least 20 minutes long and recorded in a single take so I can observe the full flow of your lesson. Ideally, place the camera at the back of the classroom to capture your teaching moves and, at the same time, allow me to see whether the students are engaged.`;
    } 
    
    // --- VISIT TEMPLATE ---
    else {
     const visitDateText = activeDraft.meta.visitDate || '[Date]';
      body += `To better assess the progress of the students in your class at ${activeDraft.schoolName}, I’d like to visit your class on [Date]. `;
      body += `Please take a few minutes to complete the questionnaire on the GrapeSEED portal, as this will provide me with a clearer understanding of the class dynamics and support my feedback.\n\n`;
      
      // Inject Schedule for Visits
      if (activeDraft.teachers.length > 0) {
         body += `Please see the visit schedule below:\n`;
         activeDraft.teachers.forEach(t => {
            body += `- ${t.name}: ${t.meta?.classTime || '[Time]'}\n`;
         });
         body += `\n`;
      }

      body += `Please find the questionnaire in this link: ${activeDraft.visitationLink || '[Link Missing]'}`;
    }

    body += `\n\nThank you in advance for your time and cooperation.\n\nBest regards,\n${trainerName}`;
    return body;
  };

  const bodyPreview = generateBody();
  const subject = `GrapeSEED ${activeDraft.type === 'LVA' ? 'Lesson Video Analysis' : 'Class Visit'} - ${activeDraft.schoolName}`;

 const copyToClipboard = () => {
    // Use activeDraft.editableSubject directly
    const text = `To: ${activeDraft.editableTo}\nCC: ${activeDraft.editableCc}\nSubject: ${activeDraft.editableSubject}\n\n${bodyPreview}`;
    navigator.clipboard.writeText(text);
    setCopiedId(activeDraft.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="modal-overlay">
      <div className="email-modal-container">
        
        {/* LEFT SIDEBAR: Draft List */}
        <div className="modal-sidebar">
          <div className="sidebar-header">
            <h3>Batches ({drafts.length})</h3>
          </div>
          <div className="batch-list">
            {drafts.map(draft => (
              <div 
                key={draft.id} 
                className={`batch-item ${draft.id === activeDraftId ? 'active' : ''}`}
                onClick={() => setActiveDraftId(draft.id)}
              >
                <div className="batch-icon">
                  <Mail size={14} color={draft.type === 'LVA' ? '#3b82f6' : '#8b5cf6'} />
                </div>
                <div className="batch-info">
                  <span className="batch-school">{draft.schoolName}</span>
                  <span className="batch-type">{draft.type} • {draft.teachers.length} T</span>
                </div>
                <ChevronRight size={14} className="arrow-icon" />
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT MAIN: Composer */}
        <div className="modal-main">
          {/* 1. Header Area (Editable Fields) */}
          <div className="composer-header">
            <div className="header-row">
              <span className="label">To:</span>
              <textarea 
                className="header-textarea"
                value={activeDraft.editableTo}
                onChange={(e) => updateHeader('editableTo', e.target.value)}
                rows={1}
              />
            </div>
            <div className="header-row">
              <span className="label">CC:</span>
              <input 
                className="header-input" 
                value={activeDraft.editableCc}
                onChange={(e) => updateHeader('editableCc', e.target.value)}
                placeholder="manager@school.com"
              />
            </div>
            <div className="header-row">
              <span className="label">Sub:</span>
              {/* ✅ CHANGED: Now an editable input */}
              <input 
                className="header-input"
                style={{ fontWeight: 600, color: '#334155' }}
                value={activeDraft.editableSubject || ''}
                onChange={(e) => updateHeader('editableSubject', e.target.value)}
              />
            </div>
          </div>
          {/* 2. Body / Inputs Area */}
          <div className="composer-body">
            
            {/* LINK WARNING */}
            {!activeDraft.visitationLink && (
               <div className="link-warning">
                  <AlertCircle size={14} /> Link missing. Code: {activeDraft.officialCode}
               </div>
            )}
            
            {/* INPUTS: LVA Deadline */}
            {activeDraft.type === 'LVA' && (
              <div className="control-card">
                 <div className="info-row">
                    <span className="info-label">Video Deadline:</span>
                    <input 
                      type="date" 
                      className="inline-input"
                      value={activeDraft.meta.deadline || ''}
                      onChange={(e) => updateBatchMeta('deadline', e.target.value)}
                    />
                 </div>
              </div>
            )}

            {/* ✅ MOVED HERE: Visit Date Picker (Applies to whole batch) */}
            {activeDraft.type === 'Visit' && (
              <div className="control-card">
                 <div className="info-row">
                    <span className="info-label">Visit Date:</span>
                    <input 
                      type="date" 
                      className="inline-input"
                      value={activeDraft.meta.visitDate || ''}
                      onChange={(e) => updateBatchMeta('visitDate', e.target.value)}
                    />
                 </div>
              </div>
            )}

            {/* INPUTS: Teacher List & Visit Times */}
            <div className="teacher-table-container">
               <table className="email-table">
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Teacher</th>
                      <th style={{ width: '35%' }}>Email</th>
                      {/* Only show Time column if it is a VISIT */}
                      {activeDraft.type === 'Visit' && <th>Visit Time</th>}
                      <th style={{ width: '40px' }}></th> {/* Delete Column */}
                    </tr>
                  </thead>
                  <tbody>
                    {activeDraft.teachers.map(t => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td className="email-cell">{t.email}</td>
                        {/* ✅ RESTORED: Visit Time Input for each specific teacher */}
                        {activeDraft.type === 'Visit' && (
                          <td>
                             <input 
                               type="text" 
                               className="table-input" 
                               placeholder="e.g. 09:00 - 09:40"
                               value={t.meta?.classTime || ''}
                               onChange={(e) => updateTeacherMeta(t.id, e.target.value)}
                             />
                          </td>
                        )}
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="btn-icon-delete"
                            title="Remove from email"
                            onClick={() => removeTeacher(t.id)}
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
               </table>
               {activeDraft.teachers.length === 0 && (
                 <div style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                   No teachers selected.
                 </div>
               )}
            </div>

            {/* PREVIEW */}
            <div className="body-preview">
              <textarea 
                 className="preview-textarea" 
                 value={bodyPreview} 
                 readOnly 
              />
            </div>

            {/* VISUAL LINK BUTTON */}
            {activeDraft.visitationLink && (
              <div className="link-display">
                 <ExternalLink size={14} />
                 <a href={activeDraft.visitationLink} target="_blank" rel="noreferrer">
                    Open Portal Link
                 </a>
              </div>
            )}

          </div>

          {/* 3. Footer */}
          <div className="composer-footer">
            <button className="btn-cancel" onClick={onClose}>Close</button>
            <button className="btn-copy" onClick={copyToClipboard}>
              {copiedId === activeDraft.id ? <Check size={16} /> : <Copy size={16} />}
              {copiedId === activeDraft.id ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailDraftModal;