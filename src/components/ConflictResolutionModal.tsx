import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResolve: (mergedData: any) => void;
  localData: any; 
  serverData: any;
}

type SourceType = 'local' | 'server' | 'manual';

// --- STYLES (iPad & Mobile Optimized) ---
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', 
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
    zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    touchAction: 'none'
  },
  modal: {
    backgroundColor: '#0f172a',
    width: '95%', maxWidth: '1100px', height: '90vh',
    borderRadius: '12px', border: '1px solid #334155', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', color: '#f1f5f9'
  },
  header: {
    padding: '16px 24px', borderBottom: '1px solid #334155', backgroundColor: '#1e293b',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexShrink: 0
  },
  body: {
    flex: 1, 
    overflowY: 'auto', 
    padding: '20px', 
    backgroundColor: '#020617', 
    position: 'relative',
    WebkitOverflowScrolling: 'touch'
  },
  rowContainer: {
    marginBottom: '30px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflow: 'hidden',
    transition: 'border-color 0.2s ease'
  },
  rowTitle: {
    padding: '10px 16px', backgroundColor: '#334155', color: '#e2e8f0', fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid #475569',
    display: 'flex', alignItems: 'center', gap: '8px'
  },
  comparisonGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', backgroundColor: '#334155'
  },
  card: {
    padding: '16px', cursor: 'pointer', backgroundColor: '#1e293b', transition: 'all 0.2s ease', position: 'relative', borderBottom: '4px solid transparent',
    WebkitTapHighlightColor: 'transparent'
  },
  cardLocalSelected: { backgroundColor: 'rgba(79, 70, 229, 0.1)', borderBottomColor: '#6366f1' },
  cardServerSelected: { backgroundColor: 'rgba(14, 165, 233, 0.1)', borderBottomColor: '#0ea5e9' },
  cardLabel: { fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  textBoxPreview: {
    fontSize: '13px', lineHeight: '1.5', color: '#cbd5e1', whiteSpace: 'pre-wrap', minHeight: '60px'
  },
  resultArea: {
    padding: '16px', backgroundColor: '#1e293b', borderTop: '1px solid #334155'
  },
  resultLabel: { fontSize: '13px', fontWeight: 'bold', color: '#10b981', marginBottom: '8px', display: 'block' },
  textarea: {
    width: '100%', minHeight: '80px', padding: '10px', borderRadius: '4px',
    fontSize: '16px',
    lineHeight: '1.4', border: '1px solid #10b981',
    backgroundColor: '#020617', color: '#e2e8f0', whiteSpace: 'pre-wrap', outline: 'none', resize: 'vertical',
    fontFamily: 'inherit',
    WebkitAppearance: 'none'
  },
  btn: {
    cursor: 'pointer', padding: '8px 16px', borderRadius: '6px', border: 'none',
    fontSize: '13px', fontWeight: '600', transition: 'all 0.2s',
    WebkitAppearance: 'none'
  },
  badge: {
    display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '11px',
    fontWeight: 'bold', border: '1px solid', marginRight: '6px', marginBottom: '6px'
  },
  selectedIcon: { fontSize: '16px' }
};

const Badge = ({ type, active }: { type: 'good' | 'growth', active: boolean }) => {
  if (!active) return <span style={{ ...styles.badge, borderColor: '#555', color: '#777', opacity: 0.4 }}>⚪ {type}</span>;
  return type === 'good' 
    ? <span style={{ ...styles.badge, backgroundColor: '#064e3b', borderColor: '#059669', color: '#ecfdf5' }}>✅ Strength</span>
    : <span style={{ ...styles.badge, backgroundColor: '#7f1d1d', borderColor: '#dc2626', color: '#fef2f2' }}>🌱 Growth</span>;
};

export const ConflictResolutionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onResolve,
  localData,
  serverData,
}) => {
  const [resolvedIndicators, setResolvedIndicators] = useState<any[]>([]);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // 🟢 LOAD DATA & DETECT META CONFLICTS
  useEffect(() => {
    if (isOpen && localData && serverData) {
      const allItems: any[] = [];
      let conflictFound = false;

      // 1. 🟢 CHECK METADATA (Teacher Name, School, etc.)
      const localMeta = localData.meta || {};
      
      const lTeacher = (localMeta.teacherName || "").trim();
      const sTeacher = (serverData.teacher_name || "").trim();
      const lSchool = (localMeta.schoolName || "").trim();
      const sSchool = (serverData.school_name || "").trim();

      const metaDiffers = lTeacher !== sTeacher || lSchool !== sSchool;
      
      if (metaDiffers) {
        conflictFound = true;
        // Construct a special "fake indicator" for Metadata
        allItems.push({
          id: 'META_CONFLICT',
          number: 'ℹ️',
          title: 'Observation Details (Teacher / School)',
          isMeta: true, 
          
          _localText: `Teacher: ${lTeacher}\nSchool: ${lSchool}`,
          _serverText: `Teacher: ${sTeacher}\nSchool: ${sSchool}`,
          
          commentText: `Teacher: ${lTeacher}\nSchool: ${lSchool}`,
          
          _isConflict: true,
          _selectedSource: 'local' as SourceType
        });
      }

      // 2. CHECK INDICATORS
      const localInds = localData.indicators || [];
      const serverInds = serverData.indicators || [];
      const serverMap = new Map(serverInds.map((i: any) => [i.id, i]));

      const mergedInds = localInds.map((lInd: any) => {
        const sInd = serverMap.get(lInd.id) as any;
        
        const localText = lInd.commentText || "";
        const serverText = sInd?.commentText || ""; 

        const hasTextDiff = localText.trim() !== serverText.trim();
        const hasFlagDiff = (lInd.good !== sInd?.good) || (lInd.growth !== sInd?.growth);
        const isConflict = hasTextDiff || hasFlagDiff || !sInd;

        if (isConflict) conflictFound = true;

        return {
          ...lInd, 
          _localText: localText,
          _serverText: serverText,
          
          // 🟢 NEW: Capture Local Snapshots so the card doesn't flip when we change the result
          _localGood: lInd.good,
          _localGrowth: lInd.growth,

          _serverVersion: sInd,
          _isConflict: isConflict, 
          _selectedSource: 'local' as SourceType 
        };
      });

      // Combine Metadata Item + Indicators
      setResolvedIndicators([...allItems, ...mergedInds]);
      setHasConflicts(conflictFound);
    }
  }, [isOpen, localData, serverData]);

  if (!isOpen || !localData || !serverData || !mounted) return null;

  // 🟢 ACTIONS
  const handleSelectSource = (index: number, source: 'local' | 'server') => {
    setResolvedIndicators(prev => {
      const copy = [...prev];
      const item = copy[index];
      const sInd = item._serverVersion;

      let newCommentText = item.commentText;
      let newGood = item.good;
      let newGrowth = item.growth;

      if (source === 'local') {
        newCommentText = item._localText;
        newGood = item._localGood;
        newGrowth = item._localGrowth;
      } else if (source === 'server') {
        newCommentText = item._serverText;
        if (sInd) {
           newGood = sInd.good;
           newGrowth = sInd.growth;
        }
      }

      copy[index] = {
        ...item,
        commentText: newCommentText,
        good: newGood,
        growth: newGrowth,
        _selectedSource: source,
        _isConflict: false 
      };
      return copy;
    });
  };

  const handleManualEdit = (index: number, text: string) => {
    setResolvedIndicators(prev => prev.map((item, i) => i === index ? { 
        ...item,
        commentText: text,
        _selectedSource: 'manual',
        _isConflict: false
    } : item));
  };

  const handleKeepAllMine = () => {
    setResolvedIndicators(prev => prev.map(item => {
      if (!item._isConflict) return item;
      return {
        ...item,
        commentText: item._localText,
        good: item._localGood,     
        growth: item._localGrowth, 
        _selectedSource: 'local',
        _isConflict: false
      };
    }));
  };

  const handleFinalize = () => {
    console.log("📝 Generating Final Payload...");
    
    // Separate Metadata item from normal indicators
    const metaItem = resolvedIndicators.find(i => i.isMeta);
    const normalIndicators = resolvedIndicators.filter(i => !i.isMeta);

    // Clean indicators
    const cleanIndicators = normalIndicators.map(ind => {
      const { 
        _localText, _serverText, _serverVersion, _isConflict, _selectedSource, 
        _localGood, _localGrowth, 
        isMeta, ...clean 
      } = ind;
      return clean;
    });

    let finalMeta = { ...localData.meta };

    if (metaItem) {
      const lines = metaItem.commentText.split('\n');
      const teacherLine = lines.find((l: string) => l.startsWith('Teacher:'));
      const schoolLine = lines.find((l: string) => l.startsWith('School:'));
      
      if (teacherLine) finalMeta.teacherName = teacherLine.replace('Teacher:', '').trim();
      if (schoolLine) finalMeta.schoolName = schoolLine.replace('School:', '').trim();
    }

    const finalPayload = {
      ...localData,
      teacherName: finalMeta.teacherName,
      schoolName: finalMeta.schoolName,
      meta: finalMeta,
      indicators: cleanIndicators,
      updatedAt: Date.now(),
      lastSync: Date.now() 
    };

    console.log("✅ Final Payload Ready:", finalPayload);
    onResolve(finalPayload);
  };

  const remainingConflicts = resolvedIndicators.some(i => i._isConflict);

  const modalContent = (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        
        {/* HEADER */}
        <div style={styles.header}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚔️</span> Conflict Resolution
            </h2>
            <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '13px' }}>
              Review the differences below.
            </p>
          </div>
          <div style={{display: 'flex', gap: '10px'}}>
             {hasConflicts && remainingConflicts && (
                 <button onClick={handleKeepAllMine} style={{...styles.btn, backgroundColor: '#334155', color: '#a5b4fc', border: '1px solid #4f46e5'}}>
                    ⚡ Keep All Mine
                 </button>
             )}
             <button onClick={onClose} style={{ ...styles.btn, backgroundColor: '#1e293b', color: '#cbd5e1', border: '1px solid #475569' }}>Cancel</button>
          </div>
        </div>

        {/* BODY */}
        <div style={styles.body}>
          {resolvedIndicators.map((ind, idx) => {
            const sInd = ind._serverVersion;
            const isLocalSelected = ind._selectedSource === 'local';
            const isServerSelected = ind._selectedSource === 'server';
            const isMeta = ind.isMeta;
            
            // 🟢 HIGHLIGHT LOGIC
            const isConflict = ind._isConflict;
            
            let borderColor = '#334155'; // Default Grey
            let titleBg = '#334155'; // Default Grey
            
            if (isMeta) {
                borderColor = '#f59e0b'; // Orange
                titleBg = 'rgba(245, 158, 11, 0.2)';
            } else if (isConflict) {
                borderColor = '#ef4444'; // Red for Conflict
                titleBg = 'rgba(239, 68, 68, 0.25)'; // Reddish Header
            }

            return (
              <div key={ind.id} style={{
                 ...styles.rowContainer, 
                 border: `1px solid ${borderColor}`
              }}>
                {/* TITLE */}
                <div style={{
                    ...styles.rowTitle, 
                    backgroundColor: titleBg,
                    color: isConflict || isMeta ? '#fff' : '#e2e8f0'
                }}>
                    {isConflict && !isMeta && <span style={{marginRight: 4}}>⚠️</span>}
                    {ind.number} {ind.title}
                </div>
                
                {/* CARDS */}
                <div style={styles.comparisonGrid}>
                  <div 
                    onClick={() => handleSelectSource(idx, 'local')}
                    style={{ ...styles.card, ...(isLocalSelected ? styles.cardLocalSelected : {}) }}
                  >
                    <div style={{ ...styles.cardLabel, color: isLocalSelected ? '#818cf8' : '#94a3b8' }}>
                      <span>📱 Your iPad</span>
                      {isLocalSelected && <span style={styles.selectedIcon}>✅</span>}
                    </div>
                    
                    {!isMeta && (
                        <div style={{marginBottom: '8px'}}>
                        <Badge type="good" active={ind._localGood} />
                        <Badge type="growth" active={ind._localGrowth} />
                        </div>
                    )}
                    
                    <div style={styles.textBoxPreview}>
                      {ind._localText || <em style={{opacity: 0.5}}>(Empty)</em>}
                    </div>
                  </div>

                  <div 
                    onClick={() => handleSelectSource(idx, 'server')}
                    style={{ ...styles.card, ...(isServerSelected ? styles.cardServerSelected : {}), borderLeft: '1px solid #334155' }}
                  >
                    <div style={{ ...styles.cardLabel, color: isServerSelected ? '#38bdf8' : '#94a3b8' }}>
                      <span>☁️ Server Version</span>
                      {isServerSelected && <span style={styles.selectedIcon}>✅</span>}
                    </div>
                     {!isMeta && (
                        <div style={{marginBottom: '8px'}}>
                        <Badge type="good" active={sInd?.good} />
                        <Badge type="growth" active={sInd?.growth} />
                        </div>
                    )}
                    <div style={styles.textBoxPreview}>
                      {ind._serverText || <em style={{color: '#f87171'}}>Missing / Empty</em>}
                    </div>
                  </div>
                </div>

                 {/* FINAL RESULT */}
                <div style={styles.resultArea}>
                   <label style={{...styles.resultLabel, color: isMeta ? '#f59e0b' : styles.resultLabel.color}}>
                       Final Result (Editable)
                   </label>
                   <textarea 
                     style={styles.textarea}
                     value={ind.commentText}
                     onChange={(e) => handleManualEdit(idx, e.target.value)}
                   />
                </div>
              </div>
            );
          })}
          
          {!hasConflicts && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#64748b' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>🎉</div>
              <h3>No data conflicts found.</h3>
              <p>Timestamps differed, but content is identical.</p>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #334155', backgroundColor: '#1e293b', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
           {remainingConflicts && (
             <span style={{color: '#f87171', fontSize: '13px', fontWeight: 'bold'}}>Resolve conflicts to save.</span>
           )}
           {/* 🟢 FIX: Button is ALWAYS Green & Clickable */}
           <button 
             onClick={handleFinalize}
             style={{ 
               ...styles.btn, padding: '10px 24px', fontSize: '14px',
               backgroundColor: '#059669', 
               color: '#fff',
               cursor: 'pointer',
               boxShadow: '0 4px 6px -1px rgba(5, 150, 105, 0.3)'
             }}
          >
            💾 Save & Sync Now
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};