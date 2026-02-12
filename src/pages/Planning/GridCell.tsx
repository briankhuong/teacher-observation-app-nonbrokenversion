import React, { useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { AlertCircle, Lock } from 'lucide-react';

interface GridCellProps {
  teacher: any;
  monthKey: string;
  activeTool: 'LVA' | 'Visit' | 'Eraser' | null;
  existingPlan: any;
  matchingObs: any;
  allPlans: any[];
  onOpenMenu: (x: number, y: number, teacher: any, monthKey: string, plan: any) => void;
  onRefresh: () => void;
}

const GridCell: React.FC<GridCellProps> = ({
  teacher,
  monthKey,
  activeTool,
  existingPlan,
  matchingObs,
  allPlans,
  onOpenMenu,
  onRefresh
}) => {

  // 1. Conflict Detection
  const hasConflict = useMemo(() => {
    if (!teacher.grapeseed_id) return false;
    return allPlans.some(p => 
      p.grapeseed_id === teacher.grapeseed_id && 
      p.month_key === monthKey && 
      p.teacher_id !== teacher.id
    );
  }, [teacher.grapeseed_id, monthKey, allPlans, teacher.id]);

  const isComplete = !!matchingObs;
  const displayType = isComplete ? matchingObs.support_type : existingPlan?.activity_type;
  
  // 2. Click Handler (The Painter)
  const handleClick = async () => {
    if (!activeTool || isComplete) return;

    try {
      if (activeTool === 'Eraser') {
        if (existingPlan?.id) {
          const { error } = await supabase
            .from('support_plans')
            .delete()
            .eq('id', existingPlan.id);
          if (error) throw error;
        }
      } else {
        // Prepare Payload
        const payload = {
          trainer_id: teacher.trainer_id,
          teacher_id: teacher.id,
          grapeseed_id: teacher.grapeseed_id, // This column MUST exist now
          month_key: monthKey,
          activity_type: activeTool,
          status: 'planned',
          updated_at: new Date().toISOString()
        };

        // UPSERT LOGIC
        // We rely on the constraint: unique(teacher_id, month_key)
        const { error } = await supabase
          .from('support_plans')
          .upsert(payload, { 
            onConflict: 'teacher_id,month_key', // No spaces!
            ignoreDuplicates: false 
          });

        if (error) throw error;
      }

      // 3. Update UI
      onRefresh(); 
    } catch (err: any) {
      console.error("Painter error:", err.message);
      alert(`Save failed: ${err.message}`);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isComplete) return;
    onOpenMenu(e.clientX, e.clientY, teacher, monthKey, existingPlan);
  };

  // 4. Styling Classes
  const getCellClass = () => {
    let base = "grid-cell ";
    if (isComplete) return base + "cell-complete";
    if (existingPlan?.status === 'cancelled') return base + "cell-cancelled";
    if (displayType === 'LVA') return base + "cell-lva";
    if (displayType === 'Visit') return base + "cell-visit";
    return base + "cell-empty";
  };

  return (
    <td 
      className={getCellClass()} 
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Container for centering content */}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        
        {displayType && (
          <span className="activity-label">
            {displayType}
          </span>
        )}
        
        <div className="cell-icons">
          {isComplete && <Lock className="lock-icon" />}
          
          {hasConflict && (
            <span title="Conflict: Supported at another location this month">
              <AlertCircle size={10} className="conflict-icon" />
            </span>
          )}
          
          {existingPlan?.notes && <div className="notes-indicator" />}
        </div>

        {/* Show initials if planned by someone else (Shared Teacher) */}
        {existingPlan && existingPlan.trainer_id !== teacher.trainer_id && (
          <div style={{
            position: 'absolute', bottom: '2px', right: '2px', fontSize: '8px',
            color: '#94a3b8', background: '#1e293b', padding: '1px 2px', borderRadius: '2px'
          }}>
             {/* Fallback to 'O' for Other if name missing */}
             O
          </div>
        )}
      </div>
    </td>
  );
};

export default GridCell;