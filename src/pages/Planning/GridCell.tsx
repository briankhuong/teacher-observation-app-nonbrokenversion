import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { AlertCircle, Lock } from 'lucide-react';
interface GridCellProps {
  teacher: any;
  monthKey: string;
  activeTool: 'LVA' | 'Visit' | 'Eraser' | null;
  plansForCell: any[];
  pendingDeletes: Set<string>; // ✅ Added
  matchingObs: any;
  allPlans: any[];
  allPendingUpdates: Record<string, any>;
  onOpenMenu: (x: number, y: number, teacher: any, monthKey: string, plan: any) => void;
  onQueueChange: (action: 'upsert' | 'delete', key: string, payload?: any, id?: string, sequence?: number) => void;
}
const GridCell: React.FC<GridCellProps> = ({
  teacher,
  monthKey,
  activeTool,
  plansForCell,
  pendingDeletes, // ✅ Added
  matchingObs,
  allPlans,
  allPendingUpdates,
  onOpenMenu,
  onQueueChange
}) => {
  const [eraserPopover, setEraserPopover] = useState<{ x: number; y: number } | null>(null);
  const [planSelector, setPlanSelector] = useState<{ x: number; y: number; plans: any[] } | null>(null);
  // ✅ Compute visible plans that exclude pending deletions
  const visiblePlans = useMemo(() => {
    return plansForCell.filter(p => !pendingDeletes.has(p.id));
  }, [plansForCell, pendingDeletes]);
  // --- status helpers ---
  const nonCancelled = visiblePlans.filter(p => p.status !== 'cancelled');
  const allCompleted = nonCancelled.length > 0 && nonCancelled.every(p => p.status === 'completed');
  const someCompleted = nonCancelled.some(p => p.status === 'completed') && !allCompleted;
  // badge text
  const summary = useMemo(() => {
    if (!visiblePlans.length) return null;
    const types = visiblePlans.filter(p => p.status !== 'cancelled').map(p => p.activity_type);
    const lvaCount = types.filter(t => t === 'LVA').length;
    const visitCount = types.filter(t => t === 'Visit').length;
    if (lvaCount && visitCount) return `LVA${lvaCount > 1 ? lvaCount : ''}+Visit${visitCount > 1 ? visitCount : ''}`;
    if (lvaCount) return `LVA${lvaCount > 1 ? ` ×${lvaCount}` : ''}`;
    if (visitCount) return `Visit${visitCount > 1 ? ` ×${visitCount}` : ''}`;
    return null;
  }, [visiblePlans]);
  const handleClick = () => {
    if (!activeTool || allCompleted) return;
    if (activeTool === 'Eraser') {
      const deletable = visiblePlans.filter(p => p.status !== 'completed');
      if (deletable.length === 0) return;
      if (deletable.length === 1) {
        const plan = deletable[0];
        onQueueChange('delete', `${teacher.id}-${monthKey}-${plan.id}`, undefined, plan.id, plan.support_sequence);
      } else {
        setEraserPopover({ x: 0, y: 0 }); // will be shown via absolute popup
      }
      return;
    }
    // Add new plan
    const nextSeq = Math.max(0, ...visiblePlans.map(p => p.support_sequence || 0)) + 1;
    const newPlanId = crypto.randomUUID();
    const payload = {
      id: newPlanId,
      trainer_id: teacher.trainer_id,
      teacher_id: teacher.id,
      grapeseed_id: teacher.grapeseed_id,
      school_name: teacher.school_name,
      month_key: monthKey,
      activity_type: activeTool,
      support_sequence: nextSeq,
      status: 'planned',
      updated_at: new Date().toISOString()
    };
    onQueueChange('upsert', `${teacher.id}-${monthKey}-${newPlanId}`, payload, newPlanId, nextSeq);
  };
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (allCompleted) return;
    const activePlans = visiblePlans.filter(p => p.status !== 'completed' && p.status !== 'cancelled');
    if (activePlans.length === 0) return;
    if (activePlans.length === 1) {
      onOpenMenu(e.clientX, e.clientY, teacher, monthKey, activePlans[0]);
    } else {
      setPlanSelector({ x: e.clientX, y: e.clientY, plans: activePlans });
    }
  };
  // … keep the rest of the cell rendering (CSS classes, icons) but adapt them to allCompleted/someCompleted.
  // Example: cell class
  const getCellClass = () => {
    let base = "grid-cell ";
    if (allCompleted) base += "cell-complete ";
    else if (someCompleted) base += "cell-partial ";
    else if (nonCancelled.length > 0) {
      if (nonCancelled[0].activity_type === 'LVA') base += "cell-lva";
      else if (nonCancelled[0].activity_type === 'Visit') base += "cell-visit";
    }
    return base.trim();
  };
  return (
    <>
      <td className={getCellClass()} onClick={handleClick} onContextMenu={handleContextMenu}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {summary && <span className="activity-label">{summary}</span>}
          <div className="cell-icons">
            {allCompleted && <Lock className="lock-icon" />}
            {!allCompleted && visiblePlans.length > 0 && (
              <div className="notes-indicator" />
            )}
          </div>
        </div>
      </td>
      {/* Eraser popover - PORTAL to body */}
      {eraserPopover && ReactDOM.createPortal(
        <div className="menu-overlay" onClick={() => setEraserPopover(null)}>
          <div className="planning-context-menu" style={{ position: 'fixed', top: '40%', left: '40%', zIndex: 9999 }}>
            <div className="menu-header" style={{ color: '#f8fafc', marginBottom: '8px' }}>Select plan to delete</div>
            {visiblePlans.filter(p => p.status !== 'completed').map(plan => (
              <button
                key={plan.id}
                className="btn-save"
                style={{ marginBottom: '4px', display: 'block', width: '100%' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onQueueChange('delete', `${teacher.id}-${monthKey}-${plan.id}`, undefined, plan.id, plan.support_sequence);
                  setEraserPopover(null);
                }}
              >
                {plan.activity_type} #{plan.support_sequence}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
      {/* Right-click plan selector - PORTAL to body */}
      {planSelector && ReactDOM.createPortal(
        <div className="menu-overlay" onClick={() => setPlanSelector(null)}>
          <div className="planning-context-menu" style={{ position: 'fixed', top: planSelector.y, left: planSelector.x, zIndex: 9999 }}>
            <div className="menu-header" style={{ color: '#f8fafc' }}>Choose support to edit</div>
            {planSelector.plans.map((plan: any) => (
              <button
                key={plan.id}
                className="btn-save"
                style={{ marginBottom: '4px', display: 'block', width: '100%' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPlanSelector(null);
                  onOpenMenu(planSelector.x, planSelector.y, teacher, monthKey, plan);
                }}
              >
                {plan.activity_type} #{plan.support_sequence}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
  // Also include the eraser popover and plan selector popover rendering.
};
export default GridCell;