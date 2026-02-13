import React, { useState, useEffect } from 'react';
import { usePlanningData } from './usePlanningData';
import { useAuth } from '../../auth/AuthContext';
import { supabase } from '../../supabaseClient';
import GridCell from './GridCell';
import PlanningContextMenu from './PlanningContextMenu';
import { 
  Brush, 
  Eraser, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  Calendar,
  Save,           
  ChevronsDown,   
  ChevronsRight   
} from 'lucide-react';
import './Planning.css';

const PlanningGrid: React.FC = () => {
  const { user } = useAuth();
  const { groupedData, plans, obsData, months, loading, refresh } = usePlanningData(user?.id || '');
  
  const [activeTool, setActiveTool] = useState<'LVA' | 'Visit' | 'Eraser' | null>(null);
  const [expandedSchools, setExpandedSchools] = useState<Record<string, boolean>>({});
  
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, any>>({});
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [hasInitializedExpand, setHasInitializedExpand] = useState(false);

  const [menuConfig, setMenuConfig] = useState<{ 
    x: number, y: number, teacher: any, monthKey: string, plan: any 
  } | null>(null);

  const hasChanges = Object.keys(pendingUpdates).length > 0 || pendingDeletes.size > 0;

  useEffect(() => {
    if (!loading && !hasInitializedExpand && Object.keys(groupedData).length > 0) {
      const newExpandedState: Record<string, boolean> = {};
      Object.entries(groupedData).forEach(([school, campuses]: any) => {
        let hasActivity = false;
        Object.values(campuses).forEach((teacherList: any) => {
          teacherList.forEach((t: any) => {
             const hasPlan = plans.some(p => p.teacher_id === t.id);
             const hasObs = obsData.some(o => o.grapeseed_id === t.grapeseed_id && o.school_name === t.school_name);
             if (hasPlan || hasObs) hasActivity = true;
          });
        });
        if (hasActivity) newExpandedState[school] = true;
      });
      setExpandedSchools(newExpandedState);
      setHasInitializedExpand(true);
    }
  }, [loading, groupedData, plans, obsData, hasInitializedExpand]);

  const toggleSchool = (schoolName: string) => {
    setExpandedSchools(prev => ({ ...prev, [schoolName]: !prev[schoolName] }));
  };

  const expandAll = () => {
    const allOpen: Record<string, boolean> = {};
    Object.keys(groupedData).forEach(k => allOpen[k] = true);
    setExpandedSchools(allOpen);
  };

  const collapseAll = () => {
    setExpandedSchools({});
  };

  const handleOpenMenu = (x: number, y: number, teacher: any, monthKey: string, plan: any) => {
    setMenuConfig({ x, y, teacher, monthKey, plan });
  };

const handleQueueChange = (action: 'upsert' | 'delete', key: string, payload?: any, id?: string) => {
    
    // 1. Handle Pending Updates (Drafts)
    setPendingUpdates(prev => {
      const next = { ...prev };
      if (action === 'delete') {
        delete next[key]; // Completely remove the draft
      } else {
        next[key] = payload; // Add/Update the draft
      }
      return next;
    });

    // 2. Handle Pending Deletes (Database IDs)
    // Only touch this if we have a real Database ID
    if (id) {
      setPendingDeletes(prev => {
        const next = new Set(prev);
        if (action === 'delete') {
          next.add(id); // Mark for deletion
        } else {
          next.delete(id); // Un-mark (if we are repainting over a delete)
        }
        return next;
      });
    }
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      // 1. Bulk Upsert (Inserts + Updates)
      const updatesArray = Object.values(pendingUpdates);
      if (updatesArray.length > 0) {
        
        // CLEANUP: We must strictly exclude 'id' if it's missing (New Plan)
        // otherwise Postgres throws "null value in column id violates not-null constraint"
        const cleanUpdates = updatesArray.map(p => {
          // Base object with NO ID
          const record: any = {
            trainer_id: p.trainer_id,
            teacher_id: p.teacher_id,
            grapeseed_id: p.grapeseed_id,
            month_key: p.month_key,
            activity_type: p.activity_type,
            status: p.status,
            updated_at: p.updated_at
          };
          
          // Only add ID if it actually exists (Update Mode)
          if (p.id) {
            record.id = p.id;
          }
          
          return record;
        });

        const { error: upsertError } = await supabase
          .from('support_plans')
          .upsert(cleanUpdates, { onConflict: 'teacher_id,month_key' });
        
        if (upsertError) throw upsertError;
      }

      // 2. Bulk Delete
      // Filter out any undefined IDs to prevent "eq.undefined" 400 errors
      const idsToDelete = Array.from(pendingDeletes).filter(id => id);
      
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('support_plans')
          .delete()
          .in('id', idsToDelete);
        
        if (deleteError) throw deleteError;
      }

      // 3. Success! Clear queues and refresh data
      setPendingUpdates({});
      setPendingDeletes(new Set());
      await refresh();

    } catch (err: any) {
      console.error("Batch save failed:", err);
      alert(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="planning-loader" style={{ padding: '40px', color: '#94a3b8', textAlign: 'center' }}>
        <RefreshCw className="spin-icon" style={{ marginBottom: '10px' }} />
        <div>Loading Planning Matrix...</div>
      </div>
    );
  }

  return (
    <div className="planning-container">
      <div className="planning-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
           <div className="app-title" style={{ fontSize: '14px', color: '#f8fafc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={16} color="#3b82f6"/> 
              Planning Board
           </div>
        </div>

        <div className="tool-group" style={{ display: 'flex', gap: '4px', marginRight: '12px' }}>
          <button className="tool-btn" onClick={expandAll} title="Expand All Schools">
            <ChevronsDown size={14} />
          </button>
          <button className="tool-btn" onClick={collapseAll} title="Collapse All Schools">
            <ChevronsRight size={14} />
          </button>
        </div>

        <div className="tool-group" style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={`tool-btn ${activeTool === 'LVA' ? 'active-lva' : ''}`}
            onClick={() => setActiveTool(activeTool === 'LVA' ? null : 'LVA')}
            title="LVA Painter Tool"
          >
            <Brush size={14} style={{ marginRight: '6px' }} /> LVA
          </button>
          <button 
            className={`tool-btn ${activeTool === 'Visit' ? 'active-visit' : ''}`}
            onClick={() => setActiveTool(activeTool === 'Visit' ? null : 'Visit')}
            title="Visit Painter Tool"
          >
            <Brush size={14} style={{ marginRight: '6px' }} /> Visit
          </button>
          <button 
            className={`tool-btn ${activeTool === 'Eraser' ? 'active-eraser' : ''}`}
            onClick={() => setActiveTool(activeTool === 'Eraser' ? null : 'Eraser')}
            title="Eraser Tool"
          >
            <Eraser size={14} />
          </button>
        </div>

        <div style={{ width: '1px', height: '20px', background: '#334155', margin: '0 12px' }}></div>

        <button 
          className="tool-btn" 
          onClick={handleSaveChanges} 
          disabled={!hasChanges || isSaving}
          title="Save Changes"
          style={{ 
            background: hasChanges ? '#22c55e' : '#334155',
            color: hasChanges ? 'white' : '#94a3b8',
            borderColor: hasChanges ? '#16a34a' : 'transparent',
            opacity: isSaving ? 0.7 : 1
          }}
        >
          {isSaving ? <RefreshCw className="spin-icon" size={14} /> : <Save size={14} />}
          <span style={{ marginLeft: '6px' }}>{isSaving ? 'Saving...' : 'Save'}</span>
        </button>

        <button className="sync-btn tool-btn" onClick={refresh} title="Refresh Data" style={{ marginLeft: '8px' }}>
          <RefreshCw size={14} /> 
        </button>
      </div>

      <div className="grid-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="planning-table">
          <thead>
            <tr>
              {/* CSS handles the width now (160px) */}
              <th className="sticky-col first-header">
                School / Teacher
              </th>
              {months.map(m => (
                <th key={m.key} className="month-header">
                  <div className="month-label">{m.label}</div>
                  <div className="month-year">{m.year}</div>
                  <div className="month-total" style={{ fontSize: '9px', opacity: 0.7, marginTop: '2px' }}>
                    LVA: {plans.filter(p => p.month_key === m.key && p.activity_type === 'LVA').length}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody>
            {Object.entries(groupedData).map(([school, campuses]: any) => {
              const isExpanded = !!expandedSchools[school];
              const schoolVisitTotal = plans.filter(p => p.school_name === school && p.activity_type === 'Visit').length;

              return (
                <React.Fragment key={school}>
                  <tr className="school-row" onClick={() => toggleSchool(school)}>
                    <td className="sticky-col school-header-cell">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                           {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                           <span className="school-name-text">{school}</span>
                        </div>
                        {schoolVisitTotal > 0 && (
                          <span className="visit-badge" style={{ fontSize: '10px', background: '#3b82f6', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>
                            {schoolVisitTotal} Visits
                          </span>
                        )}
                      </div>
                    </td>
                    {months.map(m => <td key={m.key} className="header-fill"></td>)}
                  </tr>

                  {isExpanded && Object.entries(campuses).map(([campus, teacherList]: any) => (
                    <React.Fragment key={campus}>
                      <tr className="campus-row">
                        <td className="sticky-col campus-header-cell" style={{ paddingLeft: '32px', color: '#94a3b8' }}>
                          — {campus}
                        </td>
                        {months.map(m => <td key={m.key} className="header-fill"></td>)}
                      </tr>

                      {teacherList.map((teacher: any) => (
                        <tr key={teacher.id} className="teacher-row">
                            <td className="sticky-col teacher-name" style={{ paddingLeft: '42px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '8px', width: '100%' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {teacher.name}
                                </span>
                                {(() => {
                                    const tags = Array.isArray(teacher.tags) ? teacher.tags : [];
                                    const sharedTrainers = tags.filter((t: string) => 
                                    t && t.trim() !== "" && t !== "No tag" && t.toLowerCase() !== "inactive"
                                    );
                                    if (sharedTrainers.length === 0) return null;
                                    return (
                                    <span className="mutual-badge" title={`Shared with: ${sharedTrainers.join(", ")}`}>
                                        {sharedTrainers[0].trim().substring(0, 3).toUpperCase()}
                                        {sharedTrainers.length > 1 && "+"}
                                    </span>
                                    );
                                })()}
                            </div>
                            </td>
                          
                          {months.map(m => {
                            const cellKey = `${teacher.id}-${m.key}`;
                            const existingPlan = plans.find(p => p.teacher_id === teacher.id && p.month_key === m.key);
                            const isDeleted = !!(existingPlan && pendingDeletes.has(existingPlan.id));

                            return (
                            <GridCell 
                                key={cellKey}
                                teacher={teacher}
                                monthKey={m.key}
                                activeTool={activeTool}
                                existingPlan={existingPlan}
                                pendingUpdate={pendingUpdates[cellKey]}
                                isPendingDelete={isDeleted}
                                matchingObs={obsData.find(o => 
                                    o.grapeseed_id === teacher.grapeseed_id && 
                                    o.school_name === teacher.school_name && 
                                    o.observation_date.startsWith(m.key)
                                )}
                                allPlans={plans}
                                allPendingUpdates={pendingUpdates}  // <--- ADD THIS LINE
                                onOpenMenu={handleOpenMenu}
                                onQueueChange={handleQueueChange} 
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {menuConfig && (
        <PlanningContextMenu 
          config={menuConfig} 
          onClose={() => setMenuConfig(null)} 
          onRefresh={refresh} 
        />
      )}
    </div>
  );
};

export default PlanningGrid;