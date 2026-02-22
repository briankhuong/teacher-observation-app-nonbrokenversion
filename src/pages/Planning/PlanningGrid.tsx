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
  ChevronsRight,
  X   
} from 'lucide-react';
import './Planning.css';
import { groupSelectedToBatches } from './emailUtils';
import EmailDraftModal from './EmailDraftModal';
import type { EmailBatch } from './emailUtils';
import { GrapeSeedLoginModal } from '../../components/GrapeSeedLoginModal';

// At the top of PlanningGrid.tsx
const isSameMonth = (obsDate: string, monthKey: string) => {
  if (!obsDate || !monthKey) return false;
  
  // 1. Get numbers from Observation (e.g., "2025-09-13" -> 2025 and 09)
  const [oYear, oMonth] = obsDate.split('T')[0].split('-').map(n => parseInt(n, 10));
  const oCoordinate = (oYear * 100) + oMonth; // Results in 202509

  // 2. Get numbers from Column Key (e.g., "2025-09" -> 2025 and 09)
  const [kYear, kMonth] = monthKey.split('-').map(n => parseInt(n, 10));
  const kCoordinate = (kYear * 100) + kMonth; // Results in 202509

  return oCoordinate === kCoordinate;
};

const PlanningGrid: React.FC = () => {
  const { user } = useAuth();
  const {teachers, groupedData, plans, obsData, months, loading, refresh,schoolMap } = usePlanningData(user?.id || '');
  const [emailDrafts, setEmailDrafts] = useState<EmailBatch[]>([]);
  const [activeTool, setActiveTool] = useState<'LVA' | 'Visit' | 'Eraser' | null>(null);
  const [expandedSchools, setExpandedSchools] = useState<Record<string, boolean>>({});
  
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, any>>({});
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  // --- EMAIL OUTREACH STATE ---
  const [isEmailMode, setIsEmailMode] = useState(false);
  const [isGeneratingDrafts, setIsGeneratingDrafts] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [emailFilters, setEmailFilters] = useState<{ month: string; types: string[] }>({
    month: months[0]?.key || '',
    types: ['LVA', 'Visit']
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

// Helper to check if a teacher matches the current email filters
  const matchesEmailFilter = (teacher: any) => {
    if (!isEmailMode) return true; // Show everyone in planning mode
    if (excludedIds.has(teacher.id)) return false; // Hide if "minused"

    // 1. STRICT PLAN CHECK: Must match the unique teacher_id for this row
    const plan = plans.find(p => 
      p.teacher_id === teacher.id && 
      p.month_key === emailFilters.month
    );

    // 2. STRICT OBSERVATION CHECK: Must match Grapeseed ID AND School Name
    // (Prevents an observation at School A from lighting up the row for School B)
    const obs = obsData.find(o => 
      o.grapeseed_id === teacher.grapeseed_id && 
      o.school_name === teacher.school_name && // <--- CRITICAL FIX
      isSameMonth(o.observation_date, emailFilters.month)
    );

    // Determine activity: check Completed first, then Planned
    const activity = obs ? obs.support_type : plan?.activity_type;

    if (!activity) return false;
    return emailFilters.types.includes(activity);
  };


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

// --- ROBUST QUEUE HANDLER (Fixes the Delete/Re-plan Conflict) ---
  const handleQueueChange = (action: 'upsert' | 'delete', key: string, payload?: any, id?: string) => {
    
    // 1. Update Pending Updates (The Orange Drafts)
    setPendingUpdates(prev => {
      const next = { ...prev };
      if (action === 'delete') {
        delete next[key]; // Remove draft if deleting
      } else {
        next[key] = payload; // Add/Update draft
      }
      return next;
    });

    // 2. Update Pending Deletes (The Red Flags)
    if (id) {
      setPendingDeletes(prev => {
        const next = new Set(prev);
        if (action === 'delete') {
          // Mark for deletion
          next.add(id); 
        } else {
          // CRITICAL FIX: If we are Upserting (Re-planning), UN-DELETE it!
          if (next.has(id)) {
            next.delete(id); 
          }
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

// 1. Add this constant at the top of the file (or inside the component)
const VIETNAM_REGION_ID = "49c384f1-8f63-40f4-8ff1-3e57d139c3d5";

const handleDraftEmails = async () => {
    console.log("🚀 STARTING DRAFT PROCESS...");

    // 1. ✅ CHECK LOCAL STORAGE FOR THE GRAPESEED TOKEN
    const gsToken = localStorage.getItem('grapeseed_token');

    if (!gsToken) {
      console.log("⚠️ GrapeSEED token missing! Opening login modal...");
      setShowLoginModal(true); // Pop the gate!
      return; // Stop the function here
    }

    setIsGeneratingDrafts(true);
    
    // 2. Filter visible IDs
    const visibleSelectedIds = new Set<string>();
    teachers.forEach(t => {
      if (selectedIds.has(t.id) && matchesEmailFilter(t)) {
        visibleSelectedIds.add(t.id);
      }
    });

    // 3. Create Base Batches
    const rawDrafts = groupSelectedToBatches(
      visibleSelectedIds,
      teachers,
      plans,
      schoolMap,
      emailFilters.month
    );
    
    console.log(`📦 Generated ${rawDrafts.length} base drafts.`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      // 4. ENRICH WITH API LINKS
      const enrichedDrafts = await Promise.all(rawDrafts.map(async (draft) => {
        console.log(`🔍 Processing Draft: ${draft.schoolName} (${draft.type})`);
        
        if (!draft.officialCode) {
          console.warn(`   ❌ MISSING OFFICIAL CODE for ${draft.schoolName}. Cannot fetch link.`);
          return draft; 
        }

        try {
          const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

          const response = await fetch(`${API_BASE_URL}/api/match-visitation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              schoolCode: draft.officialCode,
              monthKey: emailFilters.month, 
              type: draft.type, 
              coachId: user?.id,
              userToken: gsToken // ✅ PASSED SECURELY TO BACKEND
            }),
            signal: controller.signal 
          });

          // ✅ SAFETY NET: If the saved token is expired/invalid, clear it and ask again
          if (response.status === 401) {
             localStorage.removeItem('grapeseed_token');
             throw new Error("Token expired");
          }

          const result = await response.json();
          
          if (result.match?.linkId) {
            const link = `https://schools.grapeseed.com/regions/${VIETNAM_REGION_ID}/schools/${draft.officialCode}/visitations/${result.match.linkId}/teacher`;
            return { ...draft, visitationLink: link };
          }
        } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          // If the token expired, bubble it up to trigger the modal again
          if (err.message === "Token expired") throw err; 
          console.error(`   🔥 API FAILURE for ${draft.schoolName}`, err);
        }
        
        return draft;
      }));
      
      clearTimeout(timeoutId); 
      setEmailDrafts(enrichedDrafts);

    } catch (err: any) {
      if (err.name === 'AbortError') {
        alert("⏱️ The server is waking up from sleep (taking longer than 15s). Please wait a moment and click 'Draft Emails' again.");
      } else if (err.message === "Token expired") {
        alert("⏱️ Your GrapeSEED session expired. Please log in again.");
        setShowLoginModal(true);
      } else {
        console.error("Draft generation failed:", err);
        alert("❌ Failed to generate drafts. Please check your connection and try again.");
      }
    } finally {
      setIsGeneratingDrafts(false); 
    }
  };
// --- HELPER: Calculate Effective Counts (Visible Rows Only) ---
  const getMonthCounts = (monthKey: string) => {
    let lvaCount = 0;
    let visitCount = 0;

    // Iterate through all teachers to check their status for this month
    Object.values(groupedData).forEach((campuses: any) => {
      Object.values(campuses).forEach((teachers: any) => {
        teachers.forEach((t: any) => {
          
          // 1. VISIBILITY CHECK: If the teacher is hidden by filters, SKIP them.
          // This ensures the counters only reflect what is on the screen.
          if (!matchesEmailFilter(t)) return;

          const cellKey = `${t.id}-${monthKey}`;
          
          // 2. Check Completion (Highest Priority)
          const obs = obsData.find((o: any) => 
            o.grapeseed_id === t.grapeseed_id && 
            o.school_name === t.school_name && 
            o.observation_date && 
            isSameMonth(o.observation_date, monthKey)
          );

          if (obs) {
            if (obs.support_type === 'LVA') lvaCount++;
            else if (obs.support_type === 'Visit') visitCount++;
            return; 
          }

          // 3. Check Drafts (Pending Updates)
          const draft = pendingUpdates[cellKey];
          if (draft) {
             if (draft.activity_type === 'LVA') lvaCount++;
             else if (draft.activity_type === 'Visit') visitCount++;
             return;
          }

          // 4. Check Database Plans (if not deleted)
          const plan = plans.find((p: any) => p.teacher_id === t.id && p.month_key === monthKey);
          if (plan && !pendingDeletes.has(plan.id) && plan.status !== 'cancelled') {
             if (plan.activity_type === 'LVA') lvaCount++;
             else if (plan.activity_type === 'Visit') visitCount++;
          }
        });
      });
    });

    return { lva: lvaCount, visit: visitCount };
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
      {/* 1. MAIN TOOLBAR */}
      <div className="planning-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
           <div className="app-title" style={{ fontSize: '14px', color: '#f8fafc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={16} color="#3b82f6"/> 
              Planning Board
           </div>
        </div>

        {/* EMAIL OUTREACH TOGGLE BUTTON */}
        <button 
          className={`tool-btn ${isEmailMode ? 'active-lva' : ''}`} // Reusing active style for blue highlight
          onClick={() => setIsEmailMode(!isEmailMode)}
          style={{ marginRight: '12px' }}
        >
          <Calendar size={14} style={{ marginRight: '6px' }} />
          {isEmailMode ? 'Close Outreach' : 'Email Outreach'}
        </button>

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

      {/* 2. SLIM CONTROL CENTER (Only Visible in Email Mode) */}
      {isEmailMode && (
        <div className="email-control-bar">
          <div className="control-group">
            <span className="control-label">Target:</span>
            <select 
              className="control-select"
              value={emailFilters.month} 
              onChange={(e) => setEmailFilters(prev => ({ ...prev, month: e.target.value }))}
            >
              {months.map(m => <option key={m.key} value={m.key}>{m.label} {m.year}</option>)}
            </select>
          </div>

          <div className="control-group">
            <span className="control-label">Include:</span>
            {['LVA', 'Visit'].map(type => (
              <label key={type} className="control-checkbox">
                <input 
                  type="checkbox" 
                  checked={emailFilters.types.includes(type)}
                  onChange={(e) => {
                    const next = e.target.checked 
                      ? [...emailFilters.types, type] 
                      : emailFilters.types.filter(t => t !== type);
                    setEmailFilters(prev => ({ ...prev, types: next }));
                  }}
                />
                {type}
              </label>
            ))}
          </div>

          <div style={{ flex: 1 }}></div>

          <div className="control-group">
            <span className="selection-count">
              {selectedIds.size} Selected
            </span>
            <button 
              className="tool-btn" 
              onClick={() => {
                const visibleIds = teachers.filter(matchesEmailFilter).map(t => t.id);
                setSelectedIds(new Set(visibleIds));
              }}
            >
              Select All
            </button>
            <button 
              className="tool-btn" 
              onClick={() => {
                setSelectedIds(new Set());
                setExcludedIds(new Set());
              }}
            >
              Reset
            </button>
            <button 
              className="email-draft-btn" 
              disabled={selectedIds.size === 0 || isGeneratingDrafts}
              onClick={handleDraftEmails}
              style={{ 
                opacity: (selectedIds.size === 0 || isGeneratingDrafts) ? 0.7 : 1, 
                cursor: isGeneratingDrafts ? 'wait' : 'pointer' 
              }}
            >
              {isGeneratingDrafts ? 'Generating...' : 'Draft Emails'}
            </button>
          </div>
        </div>
      )}

      {/* 3. GRID AREA */}
      <div className="grid-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="planning-table">
          <thead>
            <tr>
              {/* NO EXTRA COLUMN HERE - JUST THE STANDARD HEADERS */}
              <th className="sticky-col first-header">
                School / Teacher
              </th>
              
              {months.map(m => {
                const counts = getMonthCounts(m.key);
                return (
                  <th key={m.key} className="month-header">
                    <div className="month-label">{m.label}</div>
                    <div className="month-year">{m.year}</div>
                    <div className="month-total" style={{ 
                      display: 'flex', justifyContent: 'center', gap: '8px', 
                      fontSize: '9px', opacity: 0.8, marginTop: '2px', fontWeight: 500
                    }}>
                      <span style={{ color: counts.lva > 0 ? '#60a5fa' : 'inherit' }}>LVA: {counts.lva}</span>
                      <span style={{ color: counts.visit > 0 ? '#a78bfa' : 'inherit' }}>Visit: {counts.visit}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          
          <tbody>
            {Object.entries(groupedData).map(([school, campuses]: any) => {
              // Deep Filter Logic
              const hasVisibleTeacherInSchool = Object.values(campuses).some((teacherList: any) => 
                teacherList.some((t: any) => matchesEmailFilter(t))
              );
              if (isEmailMode && !hasVisibleTeacherInSchool) return null;

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
                          <span className="visit-badge">{schoolVisitTotal} Visits</span>
                        )}
                      </div>
                    </td>
                    {months.map(m => <td key={m.key} className="header-fill"></td>)}
                  </tr>

                  {isExpanded && Object.entries(campuses).map(([campus, teacherList]: any) => {
                    const hasVisibleTeacherInCampus = teacherList.some((t: any) => matchesEmailFilter(t));
                    if (isEmailMode && !hasVisibleTeacherInCampus) return null;

                    return (
                      <React.Fragment key={campus}>
                        <tr className="campus-row">
                          <td className="sticky-col campus-header-cell">— {campus}</td>
                          {months.map(m => <td key={m.key} className="header-fill"></td>)}
                        </tr>

                        {teacherList.map((teacher: any) => {
                          if (!matchesEmailFilter(teacher)) return null;
                          const isSelected = selectedIds.has(teacher.id);

                          return (
                            <tr key={teacher.id} className={`teacher-row ${isSelected ? 'row-selected' : ''}`}>
                              
                              {/* TEACHER NAME CELL WITH EMBEDDED CHECKBOX */}
                              <td className="sticky-col teacher-name">
                                <div style={{ 
                                  position: 'relative', 
                                  width: '100%', height: '100%', 
                                  display: 'flex', alignItems: 'center' 
                                }}>
                                  
                                  {/* THE "GHOST" CHECKBOX - ONLY VISIBLE IN EMAIL MODE */}
                                  {isEmailMode && (
                                    <div 
                                      className={`selection-toggle ${isSelected ? 'selected' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const next = new Set(selectedIds);
                                        if (isSelected) next.delete(teacher.id);
                                        else next.add(teacher.id);
                                        setSelectedIds(next);
                                      }}
                                    >
                                      {isSelected && <div className="minus-icon" />}
                                    </div>
                                  )}

                                  {/* Teacher Name Text */}
                                  <div style={{ 
                                    flex: 1, 
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                                    paddingRight: '8px', 
                                    // Transition padding so text doesn't jump abruptly
                                    paddingLeft: isEmailMode ? '24px' : '0px', 
                                    transition: 'padding-left 0.2s ease'
                                  }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {teacher.name}
                                    </span>
                                    {/* ... Badge Logic ... */}
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
                                        o.observation_date &&
                                        isSameMonth(o.observation_date, m.key)
                                    )}
                                    allPlans={plans}
                                    allPendingUpdates={pendingUpdates}
                                    onOpenMenu={handleOpenMenu}
                                    onQueueChange={handleQueueChange} 
                                  />
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
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
          onQueueChange={handleQueueChange} 
        />
      )}

      {emailDrafts.length > 0 && (
  <EmailDraftModal 
    isOpen={true}
    onClose={() => setEmailDrafts([])} // Clear drafts to close
    initialDrafts={emailDrafts}
    />
    )}

    {/* ✅ NEW: The GrapeSEED Login Gate */}
      <GrapeSeedLoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={(token) => {
          setShowLoginModal(false);
          // Automatically resume drafting now that we have the token!
          handleDraftEmails(); 
        }}
      />
    </div>
  );
};

export default PlanningGrid;