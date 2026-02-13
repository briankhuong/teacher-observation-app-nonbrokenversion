import React, { useMemo } from 'react';
import { AlertCircle, Lock } from 'lucide-react';

interface GridCellProps {
  teacher: any;
  monthKey: string;
  activeTool: 'LVA' | 'Visit' | 'Eraser' | null;
  existingPlan: any;     
  pendingUpdate: any;    
  isPendingDelete: boolean; 
  matchingObs: any;
  allPlans: any[];
  allPendingUpdates: Record<string, any>; // NEW: Needed for realtime conflicts
  onOpenMenu: (x: number, y: number, teacher: any, monthKey: string, plan: any) => void;
  onQueueChange: (action: 'upsert' | 'delete', key: string, payload?: any, id?: string) => void;
}

const GridCell: React.FC<GridCellProps> = ({
  teacher,
  monthKey,
  activeTool,
  existingPlan,
  pendingUpdate,
  isPendingDelete,
  matchingObs,
  allPlans,
  allPendingUpdates, // NEW
  onOpenMenu,
  onQueueChange
}) => {

  // 1. Determine Effective Plan
  const effectivePlan = isPendingDelete ? null : (pendingUpdate || existingPlan);

  // 2. REALTIME CONFLICT DETECTION
  const hasConflict = useMemo(() => {
    if (!teacher.grapeseed_id) return false;

    // A. Check Database Plans
    const conflictInDB = allPlans.some(p => 
      p.grapeseed_id === teacher.grapeseed_id && 
      p.month_key === monthKey && 
      p.teacher_id !== teacher.id
    );

    // B. Check Pending Drafts (The missing link!)
    const conflictInDrafts = Object.values(allPendingUpdates).some((p: any) => 
      p.grapeseed_id === teacher.grapeseed_id && 
      p.month_key === monthKey && 
      p.teacher_id !== teacher.id
    );

    return conflictInDB || conflictInDrafts;
  }, [teacher.grapeseed_id, monthKey, allPlans, allPendingUpdates, teacher.id]);

  const isComplete = !!matchingObs;
  const displayType = isComplete ? matchingObs.support_type : effectivePlan?.activity_type;
  
  // 3. Handle Click
  const handleClick = () => {
    if (!activeTool || isComplete) return;

    const cellKey = `${teacher.id}-${monthKey}`;

    if (activeTool === 'Eraser') {
      if (effectivePlan) {
        // FIX: If erasing a pending draft (no DB ID), this ensures it clears cleanly
        onQueueChange('delete', cellKey, undefined, effectivePlan.id);
      }
    } else {
      const payload = {
        trainer_id: teacher.trainer_id,
        teacher_id: teacher.id,
        grapeseed_id: teacher.grapeseed_id,
        school_name: teacher.school_name, 
        month_key: monthKey,
        activity_type: activeTool,
        status: 'planned',
        updated_at: new Date().toISOString(),
        id: effectivePlan?.id 
      };
      onQueueChange('upsert', cellKey, payload);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isComplete) return;
    onOpenMenu(e.clientX, e.clientY, teacher, monthKey, effectivePlan);
  };


  const getCellClass = () => {
    let base = "grid-cell ";
    
    // Status Styles
    if (isComplete) base += "cell-complete ";
    else if (effectivePlan?.status === 'cancelled') base += "cell-cancelled ";
    
    // INDICATORS
    if (isPendingDelete) {
      base += "cell-pending-delete "; // Red Triangle
    } else if (pendingUpdate) {
      base += "cell-unsaved ";        // Orange Triangle
    }

    // Activity Colors
    // Note: If deleted, effectivePlan is null, so no color is applied (Empty cell with Red Triangle)
    if (displayType === 'LVA') base += "cell-lva";
    else if (displayType === 'Visit') base += "cell-visit";
    else base += "cell-empty";

    return base.trim();
  };

  return (
    <td 
      className={getCellClass()} 
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {displayType && <span className="activity-label">{displayType}</span>}
        
        <div className="cell-icons">
          {isComplete && <Lock className="lock-icon" />}
          {/* Conflict Warning */}
          {hasConflict && (
            <span title="Conflict: Teacher supported at another school this month">
              <AlertCircle size={10} className="conflict-icon" />
            </span>
          )}
          {effectivePlan?.notes && <div className="notes-indicator" />}
        </div>

        {effectivePlan && effectivePlan.trainer_id !== teacher.trainer_id && (
          <div style={{
            position: 'absolute', bottom: '2px', right: '2px', fontSize: '8px',
            color: '#94a3b8', background: '#1e293b', padding: '1px 2px', borderRadius: '2px'
          }}>O</div>
        )}
      </div>
    </td>
  );
};

export default GridCell;