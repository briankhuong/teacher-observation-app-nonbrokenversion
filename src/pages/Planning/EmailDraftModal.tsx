// src/pages/Planning/EmailDraftModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ChevronRight, Mail } from 'lucide-react';
import type { EmailBatch } from './emailUtils';

interface EmailDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDrafts: EmailBatch[];
}

const EmailDraftModal: React.FC<EmailDraftModalProps> = ({ isOpen, onClose, initialDrafts }) => {
  const [drafts, setDrafts] = useState<EmailBatch[]>(initialDrafts);
  const [activeDraftId, setActiveDraftId] = useState<string>(initialDrafts[0]?.id || '');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeDraft = drafts.find(d => d.id === activeDraftId) || drafts[0];

  useEffect(() => {
    setDrafts(initialDrafts);
    if (initialDrafts.length > 0) setActiveDraftId(initialDrafts[0].id);
  }, [initialDrafts]);

  if (!isOpen || !activeDraft) return null;

  // --- HANDLERS ---
  
  // 1. Update Batch Level Meta (For LVA Deadline)
  const updateBatchMeta = (key: 'deadline', value: string) => {
    setDrafts(prev => prev.map(d => 
      d.id === activeDraftId ? { ...d, meta: { ...d.meta, [key]: value } } : d
    ));
  };

  // 2. Update Teacher Level Meta (For Visit Time)
  const updateTeacherMeta = (teacherId: string, key: 'classTime', value: string) => {
    setDrafts(prev => prev.map(draft => {
      if (draft.id !== activeDraftId) return draft;
      return {
        ...draft,
        teachers: draft.teachers.map(t => 
          t.id === teacherId ? { ...t, meta: { ...t.meta, [key]: value } } : t
        )
      };
    }));
  };

  const updateRecipient = (key: 'adminEmail' | 'amEmail', value: string) => {
    setDrafts(prev => prev.map(d => d.id === activeDraftId ? { ...d, [key]: value } : d));
  };

  // --- GENERATE BODY ---
  const generateBody = () => {
    const isLVA = activeDraft.type === 'LVA';
    const isSingle = activeDraft.teachers.length === 1;
    
    let body = `Dear Partners,\n\n`;
    body += `This is to confirm the upcoming ${isLVA ? 'Lesson Video Analysis' : 'Onsite Support'} schedule for ${activeDraft.schoolName}.\n\n`;

    // --- ADD THIS BLOCK ---
    if (activeDraft.visitationLink) {
      body += `Please view the details and teacher list here:\n${activeDraft.visitationLink}\n\n`;
    }
    // ---------------------

    // LVA: Mention Deadline ONCE at the top
    if (isLVA) {
      body += `Submission Deadline: ${activeDraft.meta.deadline || '[Select Date]'}\n\n`;
    }

    if (isSingle) {
      const t = activeDraft.teachers[0];
      body += `Teacher: ${t.name}\n`;
      body += `Campus: ${t.campus}\n`;
      if (!isLVA) {
        body += `Class Time: ${t.meta.classTime || '[Enter Time]'}\n`;
      }
    } else {
      body += `Please see the detailed schedule below:\n\n`;
      activeDraft.teachers.forEach(t => {
        body += `- ${t.name} (${t.campus})`;
        if (!isLVA) {
          body += `: ${t.meta.classTime || 'TBD'}`;
        }
        body += `\n`;
      });
    }

    body += `\nPlease let us know if you have any questions.\n\nBest regards,\n[Your Name]`;
    return body;
  };

  const copyToClipboard = () => {
    // FIX: Explicitly include the CC line with current values
    const ccLine = `CC: ${activeDraft.adminEmail}; ${activeDraft.amEmail}`;
    const toLine = `To: ${activeDraft.teachers.map(t => t.email).join('; ')}`;
    const text = `${toLine}\n${ccLine}\nSubject: ${activeDraft.subject}\n\n${generateBody()}`;
    
    navigator.clipboard.writeText(text);
    setCopiedId(activeDraft.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="modal-overlay">
      <div className="email-modal-container">
        
        {/* SIDEBAR */}
        <div className="modal-sidebar">
          <div className="sidebar-header">
            <h3>Email Batches ({drafts.length})</h3>
          </div>
          <div className="batch-list">
            {drafts.map(draft => (
              <div 
                key={draft.id} 
                className={`batch-item ${draft.id === activeDraftId ? 'active' : ''}`}
                onClick={() => setActiveDraftId(draft.id)}
              >
                <div className="batch-icon"><Mail size={14} /></div>
                <div className="batch-info">
                  <span className="batch-school">{draft.schoolName}</span>
                  <span className="batch-type">{draft.type} • {draft.teachers.length} T</span>
                </div>
                <ChevronRight size={14} className="arrow-icon" />
              </div>
            ))}
          </div>
        </div>

        {/* MAIN COMPOSER */}
        <div className="modal-main">
          <div className="composer-header">
            <div className="header-row">
              <span className="label">To:</span>
              <div className="recipient-pill-container">
                {activeDraft.teachers.map(t => (
                  <span key={t.id} className="recipient-pill">{t.name}</span>
                ))}
              </div>
            </div>
            <div className="header-row">
              <span className="label">CC:</span>
              <input 
                className="header-input" 
                placeholder="Admin Email" value={activeDraft.adminEmail}
                onChange={(e) => updateRecipient('adminEmail', e.target.value)}
              />
              <input 
                className="header-input" 
                placeholder="AM Email" value={activeDraft.amEmail}
                onChange={(e) => updateRecipient('amEmail', e.target.value)}
              />
            </div>
            <div className="header-row">
              <span className="label">Sub:</span>
              <span className="subject-text">{activeDraft.subject}</span>
            </div>
          </div>

          <div className="composer-body">
            <div className="body-preview">
              <p>Dear Partners,</p>
              <p>This is to confirm the upcoming <strong>{activeDraft.type === 'LVA' ? 'Lesson Video Analysis' : 'Onsite Support'}</strong> schedule for <strong>{activeDraft.schoolName}</strong>.</p>
              
              {/* LVA: SINGLE DATE PICKER FOR ALL */}
              {activeDraft.type === 'LVA' && (
                <div className="single-teacher-card" style={{ marginBottom: '20px', width: '100%' }}>
                  <div className="info-row">
                    <span className="info-label" style={{ width: '140px' }}>Submission Deadline:</span>
                    <input 
                      type="date" className="inline-input"
                      value={activeDraft.meta.deadline}
                      onChange={(e) => updateBatchMeta('deadline', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* TABLE OR LIST */}
              {activeDraft.teachers.length === 1 ? (
                 <div className="single-teacher-card">
                   <div className="info-row"><span className="info-label">Teacher:</span> <span>{activeDraft.teachers[0].name}</span></div>
                   <div className="info-row"><span className="info-label">Campus:</span> <span>{activeDraft.teachers[0].campus}</span></div>
                   
                   {/* VISIT: Individual Time Input */}
                   {activeDraft.type === 'Visit' && (
                     <div className="info-row highlight">
                       <span className="info-label">Class Time:</span>
                       <input 
                         type="text" className="inline-input" placeholder="e.g. 09:00 - 10:30"
                         value={activeDraft.teachers[0].meta.classTime}
                         onChange={(e) => updateTeacherMeta(activeDraft.teachers[0].id, 'classTime', e.target.value)}
                       />
                     </div>
                   )}
                 </div>
              ) : (
                <table className="email-table">
                  <thead>
                    <tr>
                      <th>Teacher</th>
                      <th>Email</th>
                      <th>Campus</th>
                      {/* VISIT ONLY COLUMN */}
                      {activeDraft.type === 'Visit' && <th>Class Time</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeDraft.teachers.map(t => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td className="email-cell">{t.email}</td>
                        <td>{t.campus}</td>
                        
                        {/* VISIT ONLY INPUT */}
                        {activeDraft.type === 'Visit' && (
                          <td>
                             <input 
                               type="text" className="table-input" placeholder="09:00"
                               value={t.meta.classTime}
                               onChange={(e) => updateTeacherMeta(t.id, 'classTime', e.target.value)}
                             />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <p>Please let us know if you have any questions.</p>
              <p>Best regards,<br/>[Your Name]</p>
              {activeDraft.visitationLink && (
    <div style={{ margin: '12px 0', padding: '12px', background: '#f0f9ff', borderRadius: '6px', border: '1px solid #bae6fd' }}>
      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#0284c7', fontWeight: 600 }}>
         {activeDraft.type === 'LVA' ? 'Upload & Info Link:' : 'Visitation Details Link:'}
      </p>
      <a 
        href={activeDraft.visitationLink} 
        target="_blank" 
        rel="noopener noreferrer"
        style={{ fontSize: '13px', color: '#0ea5e9', textDecoration: 'underline', wordBreak: 'break-all' }}
      >
        {activeDraft.visitationLink}
      </a>
    </div>
  )}
  {/* ------------------------------- */}
            </div>
            {/* --- NEW: VISUAL LINK DISPLAY --- */}

          </div>

          <div className="composer-footer">
            <button className="btn-cancel" onClick={onClose}>Close</button>
            <button className="btn-copy" onClick={copyToClipboard}>
              {copiedId === activeDraft.id ? <Check size={16} /> : <Copy size={16} />}
              {copiedId === activeDraft.id ? 'Copied!' : 'Copy Email Text'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailDraftModal;