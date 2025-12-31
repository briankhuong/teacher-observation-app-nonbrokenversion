import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResolve: (mergedData: any) => void;
  localData: any; 
  serverData: any;
}

// Use a type alias for clarity
type SourceType = 'local' | 'server' | 'manual';

// --- INLINE STYLES (Guaranteed to work) ---
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)',
    zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  modal: {
    backgroundColor: '#0f172a', // slate-900
    width: '95%', maxWidth: '1100px', height: '90vh',
    borderRadius: '12px', border: '1px solid #334155', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', color: '#f1f5f9'
  },
  header: {
    padding: '16px 24px', borderBottom: '1px solid #334155', backgroundColor: '#1e293b',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '20px', backgroundColor: '#020617', position: 'relative'
  },
  // Conflict Row Container
  rowContainer: {
    marginBottom: '30px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflow: 'hidden'
  },
  rowTitle: {
    padding: '10px 16px', backgroundColor: '#334155', color: '#e2e8f0', fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid #475569'
  },
  comparisonGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', backgroundColor: '#334155' // Gap creates border effect
  },
  // Clickable Card Styles
  card: {
    padding: '16px', cursor: 'pointer', backgroundColor: '#1e293b', transition: 'all 0.2s ease', position: 'relative', borderBottom: '4px solid transparent'
  },
  cardLocalSelected: {
    backgroundColor: 'rgba(79, 70, 229, 0.1)', borderBottomColor: '#6366f1' // Indigo
  },
  cardServerSelected: {
    backgroundColor: 'rgba(14, 165, 233, 0.1)', borderBottomColor: '#0ea5e9' // Sky blue
  },
  cardLabel: { fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  textBoxPreview: {
    fontSize: '13px', lineHeight: '1.5', color: '#cbd5e1', whiteSpace: 'pre-wrap', minHeight: '60px'
  },
  // Final Result Area underneath cards
  resultArea: {
    padding: '16px', backgroundColor: '#1e293b', borderTop: '1px solid #334155'
  },
  resultLabel: { fontSize: '13px', fontWeight: 'bold', color: '#10b981', marginBottom: '8px', display: 'block' },
  textarea: {
    width: '100%', minHeight: '80px', padding: '10px', borderRadius: '4px',
    fontSize: '13px', lineHeight: '1.4', border: '1px solid #10b981',
    backgroundColor: '#020617', color: '#e2e8f0', whiteSpace: 'pre-wrap', outline: 'none', resize: 'vertical'
  },
  btn: {
    cursor: 'pointer', padding: '8px 16px', borderRadius: '6px', border: 'none',
    fontSize: '13px', fontWeight: '600', transition: 'all 0.2s'
  },
  badge: {
    display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '11px',
    fontWeight: 'bold', border: '1px solid', marginRight: '6px', marginBottom: '6px'
  },
  selectedIcon: { fontSize: '16px' }
};

// Helper: Badge Component
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
  // We add _selectedSource to track which card was clicked
  const [resolvedIndicators, setResolvedIndicators] = useState<any[]>([]);
  const [hasConflicts, setHasConflicts] = useState(false);

  // 🟢 LOAD DATA ON OPEN
  useEffect(() => {
    if (isOpen && localData && serverData) {
      const localInds = localData.indicators || [];
      const serverInds = serverData.indicators || [];
      const serverMap = new Map(serverInds.map((i: any) => [i.id, i]));

      let conflictFound = false;

      const merged = localInds.map((lInd: any) => {
        const sInd = serverMap.get(lInd.id) as any;
        
        const localText = lInd.commentText || "";
        const serverText = sInd?.commentText || ""; 

        const hasTextDiff = localText.trim() !== serverText.trim();
        const hasFlagDiff = (lInd.good !== sInd?.good) || (lInd.growth !== sInd?.growth);
        const isConflict = hasTextDiff || hasFlagDiff || !sInd;

        if (isConflict) conflictFound = true;

        return {
          ...lInd, 
          // Store versions for reference
          _localText: localText,
          _serverText: serverText,
          _serverVersion: sInd,
          // Flag used for UI filtering
          _isConflict: isConflict, 
          // Track user choice. Default to local for preview, but keep conflict flag true.
          _selectedSource: 'local' as SourceType 
        };
      });
      setResolvedIndicators(merged);
      setHasConflicts(conflictFound);
    }
  }, [isOpen, localData, serverData]);

  if (!isOpen || !localData || !serverData) return null;

  // 🟢 HANDLE CARD CLICK (The "Click to Pick" Logic)
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
        // keep local flags
      } else if (source === 'server' && sInd) {
        newCommentText = item._serverText;
        newGood = sInd.good;
        newGrowth = sInd.growth;
      }

      copy[index] = {
        ...item,
        commentText: newCommentText,
        good: newGood,
        growth: newGrowth,
        _selectedSource: source,
        // CRITICAL: Mark resolved the moment they pick one
        _isConflict: false 
      };
      return copy;
    });
  };

  // 🟢 FIXED: Variable name fixed from idx to index
  const handleManualEdit = (index: number, text: string) => {
    setResolvedIndicators(prev => prev.map((item, i) => i === index ? {
        ...item,
        commentText: text,
        _selectedSource: 'manual',
        _isConflict: false // Manual edit also resolves it
      } : item));
  };

  // Quick action: Keep all local versions
  const handleKeepAllMine = () => {
    setResolvedIndicators(prev => prev.map(item => {
      if (!item._isConflict) return item;
      return {
        ...item,
        commentText: item._localText,
        // keep local flags
        _selectedSource: 'local',
        _isConflict: false
      };
    }));
  };

  const handleFinalize = () => {
    // Clean up internal props before saving
    const cleanIndicators = resolvedIndicators.map(({ _localText, _serverText, _serverVersion, _isConflict, _selectedSource, ...rest }) => rest);
    
    const finalPayload = {
      ...localData,
      indicators: cleanIndicators,
      // IMPORTANT: Update timestamps so this becomes the newest version
      updatedAt: Date.now(),
      lastSync: Date.now() 
    };
    onResolve(finalPayload);
  };

  // Are there any conflicts left unresolved?
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
              Click the version you want to keep for each item below.
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
            // Only show items that were originally conflicts
            if (!hasConflicts && !ind._isConflict) return null;
            // If it was a conflict, show it until resolved, or if we are showing all for context
            if (!ind._isConflict && hasConflicts) {
               // Optional: hide resolved rows to clean up UI? For now let's keep them visible but look "done".
            }

            const sInd = ind._serverVersion;
            const isLocalSelected = ind._selectedSource === 'local';
            const isServerSelected = ind._selectedSource === 'server';

            return (
              <div key={ind.id} style={styles.rowContainer}>
                {/* ROW TITLE */}
                <div style={styles.rowTitle}>{ind.number} {ind.title}</div>
                
                {/* COMPARISON CARDS */}
                <div style={styles.comparisonGrid}>
                  
                  {/* LOCAL CARD (Clickable) */}
                  <div 
                    onClick={() => handleSelectSource(idx, 'local')}
                    style={{ ...styles.card, ...(isLocalSelected ? styles.cardLocalSelected : {}) }}
                  >
                    <div style={{ ...styles.cardLabel, color: isLocalSelected ? '#818cf8' : '#94a3b8' }}>
                      <span>📱 Your iPad</span>
                      {isLocalSelected && <span style={styles.selectedIcon}>✅</span>}
                    </div>
                    <div style={{marginBottom: '8px'}}>
                      <Badge type="good" active={ind.good} />
                      <Badge type="growth" active={ind.growth} />
                    </div>
                    <div style={styles.textBoxPreview}>
                      {ind._localText || <em style={{opacity: 0.5}}>(Empty)</em>}
                    </div>
                  </div>

                  {/* SERVER CARD (Clickable) */}
                  <div 
                    onClick={() => handleSelectSource(idx, 'server')}
                    style={{ ...styles.card, ...(isServerSelected ? styles.cardServerSelected : {}), borderLeft: '1px solid #334155' }}
                  >
                    <div style={{ ...styles.cardLabel, color: isServerSelected ? '#38bdf8' : '#94a3b8' }}>
                      <span>☁️ Server Version</span>
                      {isServerSelected && <span style={styles.selectedIcon}>✅</span>}
                    </div>
                     <div style={{marginBottom: '8px'}}>
                      <Badge type="good" active={sInd?.good} />
                      <Badge type="growth" active={sInd?.growth} />
                    </div>
                    <div style={styles.textBoxPreview}>
                      {ind._serverText || <em style={{color: '#f87171'}}>Missing / Empty</em>}
                    </div>
                  </div>
                </div>

                 {/* FINAL RESULT EDIT AREA */}
                <div style={styles.resultArea}>
                   <label style={styles.resultLabel}>Final Result (Editable)</label>
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
              <p>Timestamps differed, but the content is identical.</p>
            </div>
          )}
           {hasConflicts && !remainingConflicts && (
            <div style={{ textAlign: 'center', padding: '30px', color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
              <h3>✅ All selections made!</h3>
              <p>You can now save your changes.</p>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #334155', backgroundColor: '#1e293b', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
           {remainingConflicts && (
             <span style={{color: '#f87171', fontSize: '13px', fontWeight: 'bold'}}>
               Resolve remaining conflicts to save.
             </span>
           )}
           <button 
             onClick={handleFinalize}
             disabled={remainingConflicts}
             style={{ 
               ...styles.btn, padding: '10px 24px', fontSize: '14px',
               backgroundColor: remainingConflicts ? '#475569' : '#059669', 
               color: remainingConflicts ? '#94a3b8' : '#fff',
               cursor: remainingConflicts ? 'not-allowed' : 'pointer',
               boxShadow: remainingConflicts ? 'none' : '0 4px 6px -1px rgba(5, 150, 105, 0.3)'
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