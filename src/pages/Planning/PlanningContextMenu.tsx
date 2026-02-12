import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { X, Check, Trash2, Ban } from 'lucide-react';

interface Props {
  config: { x: number, y: number, teacher: any, monthKey: string, plan: any };
  onClose: () => void;
  onRefresh: () => void;
}

const PlanningContextMenu: React.FC<Props> = ({ config, onClose, onRefresh }) => {
  const [note, setNote] = useState(config.plan?.notes || "");
  const [loading, setLoading] = useState(false);

  const updateStatus = async (status: string) => {
    if (!config.plan) return;
    setLoading(true);
    await supabase.from('support_plans').update({ status }).eq('id', config.plan.id);
    onRefresh();
    onClose();
  };

  const saveNote = async () => {
    if (!config.plan) return;
    setLoading(true);
    await supabase.from('support_plans').update({ notes: note }).eq('id', config.plan.id);
    onRefresh();
    onClose();
  };

  const deletePlan = async () => {
    if (!config.plan) return;
    const ok = window.confirm("Delete this plan?");
    if (!ok) return;
    await supabase.from('support_plans').delete().eq('id', config.plan.id);
    onRefresh();
    onClose();
  };

  return (
    <>
      <div className="menu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div 
        className="planning-context-menu"
        style={{ top: config.y, left: config.x }}
      >
        <div className="menu-header">
          <span>{config.teacher.name} - {config.monthKey}</span>
          <button onClick={onClose}><X size={14}/></button>
        </div>

        {!config.plan ? (
          <div className="menu-item-disabled">No plan to edit. Use painter first.</div>
        ) : (
          <>
            <div className="menu-section">
              <label>Status</label>
              <div className="status-grid">
                <button onClick={() => updateStatus('planned')} className={config.plan.status === 'planned' ? 'active' : ''}>Planned</button>
                <button onClick={() => updateStatus('cancelled')} className={config.plan.status === 'cancelled' ? 'active' : ''}><Ban size={12}/> Cancel</button>
              </div>
            </div>

            <div className="menu-section">
              <label>Notes</label>
              <textarea 
                value={note} 
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add visit details..."
              />
              <button className="btn-save" onClick={saveNote} disabled={loading}>Save Note</button>
            </div>

            <div className="menu-divider" />
            
            <button className="menu-item-danger" onClick={deletePlan}>
              <Trash2 size={14} /> Delete Plan
            </button>
          </>
        )}
      </div>
    </>
  );
};

export default PlanningContextMenu;