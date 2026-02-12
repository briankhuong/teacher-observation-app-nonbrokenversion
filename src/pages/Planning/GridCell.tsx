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
  onRefresh: () => void; // 🟢 Added to interface
}

const GridCell: React.FC<GridCellProps> = ({
  teacher,
  monthKey,
  activeTool,
  existingPlan,
  matchingObs,
  allPlans,
  onOpenMenu,
  onRefresh // 🟢 Destructured here
}) => {
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
  
// Inside GridCell.tsx
const handleClick = async () => {
  // Prevent interaction if no tool is selected or if a real observation exists
  if (!activeTool || isComplete) return;

  try {
    if (activeTool === 'Eraser') {
      if (existingPlan) {
        await supabase.from('support_plans').delete().eq('id', existingPlan.id);
      }
    } else {
      // Use upsert to handle both "new" and "update" in one call
      const { error } = await supabase.from('support_plans').upsert({
        // If existingPlan exists, use its ID to update; otherwise, let Supabase gen a new one
        ...(existingPlan?.id && { id: existingPlan.id }),
        trainer_id: teacher.trainer_id,
        teacher_id: teacher.id,
        grapeseed_id: teacher.grapeseed_id,
        school_name: teacher.school_name,
        month_key: monthKey,
        activity_type: activeTool,
        status: 'planned',
        updated_at: new Date().toISOString()
      }, {
        // This ensures that teacher_id + month_key remains unique per plan
        onConflict: 'teacher_id,month_key' 
      });

      if (error) throw error;
    }

    // CRITICAL: Call refresh immediately to show the new "LVA" or "Visit" badge
    onRefresh(); 
  } catch (err) {
    console.error("Painter failed:", err);
    alert("Could not update plan. Check your database connection.");
  }
};

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isComplete) return;
    onOpenMenu(e.clientX, e.clientY, teacher, monthKey, existingPlan);
  };

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
      <div className="cell-content">
        {displayType && <span className="activity-label">{displayType}</span>}
        <div className="cell-icons">
          {isComplete && <Lock size={10} className="lock-icon" />}
          {hasConflict && (
            <span title="Conflict: Supported at another location this month">
              <AlertCircle size={10} className="conflict-icon" />
            </span>
          )}
          {existingPlan?.notes && <div className="notes-indicator" />}
        </div>
      </div>
    </td>
  );
};

export default GridCell;