import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ChevronRight, Mail, ExternalLink, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import './EmailDraftModal.css';

// src/pages/Planning/EmailDraftModal.tsx

export interface EmailBatch {
  id: string;
  schoolName: string;
  officialCode?: string;
  editableBody?: string;
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
const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');     
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
        // 4. Generate Default Body Text (Using Tokens)
        let initialBody = `I hope you’re doing well.\n\n`;
        if (d.type === 'LVA') {
          initialBody += `To better assess the progress of the students in your GrapeSEED class, I’d like to request a lesson video, due by {{DATE}}.\n\nPlease also take a few minutes to complete the questionnaire on the GrapeSEED portal using the button below, as this will provide me with a clearer understanding of the class dynamics and support my feedback.\n\nFor the video, please ensure it is at least 20 minutes long and recorded in a single take so I can observe the full flow of your lesson. Ideally, place the camera at the back of the classroom to capture your teaching moves and, at the same time, allow me to see whether the students are engaged.`;
        } else {
          initialBody += `To better assess the progress of the students in your class at ${d.schoolName}, I’d like to visit your class on {{DATE}}.\n\nPlease take a few minutes to complete the questionnaire on the GrapeSEED portal using the button below, as this will provide me with a clearer understanding of the class dynamics and support my feedback.`;
        }

        return {
          ...d,
          editableTo: d.teachers.map(t => t.email).join('; '),
          editableCc: ccString,     // ✅ Pre-filled CC
          editableSubject: subject, // ✅ Pre-filled Subject
          editableBody: initialBody,
          meta: d.meta || {},
          teachers: d.teachers.map(t => ({...t, meta: t.meta || {}}))
        };
      });
      
      setDrafts(processedDrafts);
      setActiveDraftId(processedDrafts[0].id);
      setActiveTab('edit');
    }
  }, [initialDrafts, isOpen]);

  if (!isOpen || drafts.length === 0) return null;

  const activeDraft = drafts.find(d => d.id === activeDraftId) || drafts[0];

  // --- HANDLERS ---

// Update Headers (To/CC/Subject)
const updateHeader = (field: 'editableTo' | 'editableCc' | 'editableSubject' | 'editableBody', value: string) => {
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

// --- GENERATE RICH HTML BODY ---
  const generateHtmlBody = () => {
    const isLVA = activeDraft.type === 'LVA';
    const isMultiple = activeDraft.teachers.length > 1;
    const teacherNames = activeDraft.teachers.map(t => t.name).join(', ');
    
    // CSS Styles from your template
    const container = "max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; border: 1px solid #e5e7eb;";
    const headerStyle = "background-color: #065f46; padding: 20px; text-align: center;";
    const bodyStyle = "padding: 30px 25px; color: #374151; line-height: 1.6; font-size: 15px;";
    const buttonStyle = "display: inline-block; background-color: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;";
    const footerStyle = "background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280;";

    const greeting = isMultiple ? "Dear Teachers," : `Dear ${teacherNames},`;
    
    // --- TOKEN REPLACEMENT LOGIC ---
    // Get the date from the picker, or show a fallback if they haven't picked one yet
    const rawDate = isLVA ? activeDraft.meta.deadline : activeDraft.meta.visitDate;
    const formattedDate = rawDate ? rawDate : '[Select a Date in Edit Tab]';

    // Swap {{DATE}} with the actual date (wrapped in bold tags for styling)
    let processedText = activeDraft.editableBody || '';
    processedText = processedText.replace(/\{\{DATE\}\}/g, `<strong>${formattedDate}</strong>`);

    // Convert user's raw text into HTML paragraphs
    const userParagraphs = processedText
      .split('\n')
      .filter(line => line.trim() !== '') // Ignore empty blank lines
      .map(line => `<p style="margin-top: 0; margin-bottom: 16px;">${line}</p>`)
      .join('');

    // Start building content with greeting + user's editable text
    let content = `<p style="margin-top: 0; margin-bottom: 20px;">${greeting}</p>${userParagraphs}`;

    // Inject Schedule for Visits (Locked & beautifully formatted)
    if (!isLVA && activeDraft.teachers.length > 0) {
       content += `<p style="margin-top: 25px;"><strong>Visit Schedule:</strong></p><ul style="background: #f8fafc; padding: 15px 15px 15px 35px; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 10px;">`;
       activeDraft.teachers.forEach(t => {
          content += `<li style="margin-bottom: 8px;"><strong>${t.name}</strong>: ${t.meta?.classTime || '[Time]'}</li>`;
       });
       content += `</ul>`;
    }

    // Call to Action & Sign-off
    content += `
      <div style="text-align: center; margin: 30px 0;">
        <a href="${activeDraft.visitationLink || '#'}" style="${buttonStyle}">📂 Open GrapeSEED Portal</a>
      </div>
      <p style="margin-bottom: 0;">Thank you in advance for your time and cooperation.</p>
      <p style="margin-bottom: 0; margin-top: 10px;">Best regards,<br><strong>${trainerName}</strong></p>
    `;

    // Final HTML Assembly
    return `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
  <div style="${container}">
    <div style="${headerStyle}">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.5px;">${isLVA ? 'LESSON VIDEO ANALYSIS' : 'CLASS VISIT'}</h2>
      <p style="margin: 5px 0 0; color: #a7f3d0; font-size: 13px;">${activeDraft.schoolName}</p>
    </div>
    <div style="${bodyStyle}">
      ${content}
    </div>
    <div style="${footerStyle}">
      GrapeSEED Vietnam Training Team
    </div>
  </div>
</body>
</html>`;
  };

    const subject = `GrapeSEED ${activeDraft.type === 'LVA' ? 'Lesson Video Analysis' : 'Class Visit'} - ${activeDraft.schoolName}`;

    const copyToClipboard = async () => {
    const htmlContent = generateHtmlBody();
    
    // Fallback for email clients that absolutely don't support HTML pasting
    const plainTextFallback = `To: ${activeDraft.editableTo}\nCC: ${activeDraft.editableCc}\nSubject: ${activeDraft.editableSubject}\n\n(Please view this email in an HTML-compatible client.)`;

    try {
      // Create a rich text clipboard item
      const clipboardItem = new ClipboardItem({
        "text/plain": new Blob([plainTextFallback], { type: "text/plain" }),
        "text/html": new Blob([htmlContent], { type: "text/html" }),
      });
      
      await navigator.clipboard.write([clipboardItem]);
      setCopiedId(activeDraft.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy rich text: ", err);
      alert("Failed to copy rich text. Your browser might not support this feature.");
    }
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
{/* 2. Body / Inputs Area (NOW TABBED) */}
          <div className="composer-body">
            
            {/* TABS NAVIGATION */}
            <div className="tabs-header">
              <button 
                className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
                onClick={() => setActiveTab('edit')}
              >
                Edit Details
              </button>
              <button 
                className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                onClick={() => setActiveTab('preview')}
              >
                Preview Email
              </button>
            </div>

            {/* TAB 1: EDIT DETAILS */}
            {activeTab === 'edit' && (
              <div className="tab-content">
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

                {/* INPUTS: Visit Date */}
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
                          {activeDraft.type === 'Visit' && <th>Visit Time</th>}
                          <th style={{ width: '40px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDraft.teachers.map(t => (
                          <tr key={t.id}>
                            <td>{t.name}</td>
                            <td className="email-cell">{t.email}</td>
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
                {/* Editable Email Message */}
                <div className="control-card" style={{ marginTop: '16px' }}>
                  <div style={{ marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#64748b' }}>
                    Email Message (Editable):
                  </div>
                  <textarea 
                    className="preview-textarea" 
                    value={activeDraft.editableBody || ''} 
                    onChange={(e) => updateHeader('editableBody', e.target.value)}
                    style={{ height: '180px', background: '#fff' }}
                  />
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8', lineHeight: '1.4' }}>
                    <strong>*Note:</strong> Leave <strong>{`{{DATE}}`}</strong> in your text. It will automatically be replaced by the date you selected above when previewing or sending.<br/>
                    The greeting, schedule table, and portal button are injected automatically.
                  </div>
                </div>
              </div>
            )}

{/* TAB 2: PREVIEW EMAIL */}
            {activeTab === 'preview' && (
              <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div 
                  className="html-preview-container"
                  style={{ 
                    flex: 1, 
                    overflowY: 'auto', 
                    background: '#f3f4f6', 
                    padding: '20px', 
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0'
                  }}
                  dangerouslySetInnerHTML={{ __html: generateHtmlBody() }}
                />
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