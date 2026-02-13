import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, AlertCircle } from 'lucide-react';
// import { supabase } from '../../supabaseClient'; // No longer needed for delete!

interface PlanningContextMenuProps {
  config: {
    x: number;
    y: number;
    teacher: any;
    monthKey: string;
    plan: any;
  };
  onClose: () => void;
  onRefresh: () => void;
  // New Prop Definition
  onQueueChange: (action: 'upsert' | 'delete', key: string, payload?: any, id?: string) => void; 
}

const PlanningContextMenu: React.FC<PlanningContextMenuProps> = ({ 
  config, 
  onClose, 
  onRefresh,
  onQueueChange 
}) => {
  const { x, y, teacher, monthKey, plan } = config;
  
  // Local state for the form inputs
  const [status, setStatus] = useState<'planned' | 'cancelled'>(plan?.status || 'planned');
  const [notes, setNotes] = useState(plan?.notes || '');
  
  // Calculate position to keep menu on screen
  const style = {
    top: Math.min(y, window.innerHeight - 300),
    left: Math.min(x, window.innerWidth - 250),
  };

  // --- NEW DELETE HANDLER ---
  const handleDelete = () => {
    if (!plan) return;
    
    const cellKey = `${teacher.id}-${monthKey}`;
    
    // Use the Batch Queue instead of immediate DB delete
    // This will show the Red Triangle immediately
    onQueueChange('delete', cellKey, undefined, plan.id);
    
    onClose();
  };

  // --- SAVE CHANGES (Notes/Status) ---
  // Note: For now, we can keep this as a "Queue Upsert" too!
  const handleSave = () => {
    const cellKey = `${teacher.id}-${monthKey}`;
    
    const payload = {
      id: plan?.id, // Preserve ID if it exists
      trainer_id: teacher.trainer_id,
      teacher_id: teacher.id,
      grapeseed_id: teacher.grapeseed_id,
      school_name: teacher.school_name,
      month_key: monthKey,
      activity_type: plan?.activity_type || 'LVA', // Fallback or keep existing
      status: status,
      notes: notes,
      updated_at: new Date().toISOString()
    };

    // Queue the update (Orange Triangle)
    onQueueChange('upsert', cellKey, payload);
    onClose();
  };

  return (
    <>
      <div className="menu-overlay" onClick={onClose} />
      <div className="planning-context-menu" style={style}>
        {/* Header */}
        <div className="menu-header">
          <span>{teacher.name} - {monthKey}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
            <X size={14} />
          </button>
        </div>

        {/* Status Selection */}
        <div className="menu-section">
          <label>Status</label>
          <div className="status-grid">
            <button 
              className={status === 'planned' ? 'active' : ''} 
              onClick={() => setStatus('planned')}
            >
              Planned
            </button>
            <button 
              className={status === 'cancelled' ? 'active' : ''} 
              onClick={() => setStatus('cancelled')}
              style={{ color: status === 'cancelled' ? '#f87171' : 'inherit' }}
            >
              <AlertCircle size={10} style={{ marginRight: 4 }}/> Cancel
            </button>
          </div>
        </div>

        {/* Notes Input */}
        <div className="menu-section">
          <label>Notes</label>
          <textarea 
            value={notes} 
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add visit details..."
            autoFocus
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
          <button className="btn-save" onClick={handleSave}>
            <Save size={12} style={{ marginRight: '6px' }} />
            Queue Changes
          </button>
          
          {plan && (
            <button className="menu-item-danger" onClick={handleDelete}>
              <Trash2 size={12} />
              Delete Plan
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default PlanningContextMenu;