import React, { useState, useMemo } from 'react';
import { usePlanningData } from './usePlanningData'; // Ensure this path is correct
import { useAuth } from '../../auth/AuthContext';    // Ensure this path is correct
import GridCell from './GridCell';
import PlanningContextMenu from './PlanningContextMenu';
import { 
  Brush, 
  Eraser, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  Calendar 
} from 'lucide-react';
import './Planning.css'; // Make sure you updated this file with the dark theme CSS

const PlanningGrid: React.FC = () => {
  const { user } = useAuth();
  const { groupedData, plans, obsData, months, loading, refresh } = usePlanningData(user?.id || '');
  
  // State for the interactive tools
  const [activeTool, setActiveTool] = useState<'LVA' | 'Visit' | 'Eraser' | null>(null);
  
  // State for collapsing/expanding school groups
  const [expandedSchools, setExpandedSchools] = useState<Record<string, boolean>>({});
  
  // State for the Right-Click Context Menu
  const [menuConfig, setMenuConfig] = useState<{ 
    x: number, 
    y: number, 
    teacher: any, 
    monthKey: string, 
    plan: any 
  } | null>(null);

  // Toggle logic for school headers
  const toggleSchool = (schoolName: string) => {
    setExpandedSchools(prev => ({
      ...prev,
      [schoolName]: !prev[schoolName]
    }));
  };

  // Handler to open the context menu from a Cell
  const handleOpenMenu = (x: number, y: number, teacher: any, monthKey: string, plan: any) => {
    setMenuConfig({ x, y, teacher, monthKey, plan });
  };

  // Loading State
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
      {/* --- TOOLBAR --- */}
      <div className="planning-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
           <div className="app-title" style={{ fontSize: '14px', color: '#f8fafc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={16} color="#3b82f6"/> 
              Planning Board
           </div>
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

        <button className="sync-btn tool-btn" onClick={refresh} title="Refresh Data">
          <RefreshCw size={14} /> 
          <span style={{ marginLeft: '6px' }}>Sync</span>
        </button>
      </div>

      {/* --- SCROLLABLE GRID --- */}
      <div className="grid-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="planning-table">
          <thead>
            <tr>
              {/* Sticky Corner: School / Teacher Name */}
<th className="sticky-col first-header" style={{ minWidth: '200px', width: '200px', textAlign: 'left', paddingLeft: '12px' }}>
  School / Teacher
</th>
              
              {/* Month Columns */}
              {months.map(m => (
                <th key={m.key} className="month-header">
                  <div className="month-label">{m.label}</div>
                  <div className="month-year">{m.year}</div>
                  {/* Monthly LVA Total */}
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
              // Calculate total visits for this school across the whole year
              const schoolVisitTotal = plans.filter(p => p.school_name === school && p.activity_type === 'Visit').length;

              return (
                <React.Fragment key={school}>
                  {/* --- SCHOOL HEADER ROW (CLICKABLE) --- */}
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
                    {/* Render empty cells for the header row to maintain grid structure */}
                    {months.map(m => <td key={m.key} className="header-fill"></td>)}
                  </tr>

                  {/* --- EXPANDED CONTENT --- */}
                  {isExpanded && Object.entries(campuses).map(([campus, teacherList]: any) => (
                    <React.Fragment key={campus}>
                      {/* Campus Sub-Header */}
                      <tr className="campus-row">
                        <td className="sticky-col campus-header-cell" style={{ paddingLeft: '32px', color: '#94a3b8' }}>
                          — {campus}
                        </td>
                        {months.map(m => <td key={m.key} className="header-fill"></td>)}
                      </tr>

                      {/* Teacher Rows */}
                      {teacherList.map((teacher: any) => (
                        <tr key={teacher.id} className="teacher-row">
                          <td className="sticky-col teacher-name" style={{ paddingLeft: '42px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                               {teacher.name}
                               {/* Shared Teacher Dot */}
                               {teacher.tags?.some((tag: string) => tag !== "No tag" && tag.toLowerCase() !== "inactive") && (
                                 <div 
                                   className="mutual-dot" 
                                   title="Shared Teacher (Tagged by others)"
                                   style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }}
                                 ></div>
                               )}
                            </div>
                          </td>
                          
                          {/* Render the Interactive Cells */}
                          {months.map(m => (
                            <GridCell 
                              key={`${teacher.id}-${m.key}`}
                              teacher={teacher}
                              monthKey={m.key}
                              activeTool={activeTool}
                              // Find existing plan for this specific cell
                              existingPlan={plans.find(p => p.teacher_id === teacher.id && p.month_key === m.key)}
                              // Find matching observation for "Complete" status override
                              matchingObs={obsData.find(o => 
                                  o.grapeseed_id === teacher.grapeseed_id && 
                                  o.school_name === teacher.school_name && 
                                  o.observation_date.startsWith(m.key)
                              )}
                              // Pass all plans for global conflict detection
                              allPlans={plans}
                              onOpenMenu={handleOpenMenu}
                              onRefresh={refresh}
                            />
                          ))}
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

      {/* --- CONTEXT MENU POPUP --- */}
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