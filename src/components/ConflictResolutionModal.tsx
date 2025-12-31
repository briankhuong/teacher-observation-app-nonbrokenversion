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

// --- LINEAR-INSPIRED STYLES ---
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)', zIndex: 99999, display: 'flex', 
    alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Inter, -apple-system, sans-serif',
  },
  modal: {
    backgroundColor: '#0a0a0c', width: '96%', maxWidth: '1000px', height: '92vh',
    borderRadius: '16px', border: '1px solid #27272a', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,255,255,0.05), 0 20px 50px rgba(0,0,0,0.5)', 
    color: '#f4f4f5'
  },
  header: {
    padding: '20px 28px', borderBottom: '1px solid #18181b', backgroundColor: '#0a0a0c',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '24px', backgroundColor: '#0a0a0c',
    WebkitOverflowScrolling: 'touch'
  },
  // THE CARD
  cardContainer: {
    marginBottom: '32px', position: 'relative', borderRadius: '12px',
    backgroundColor: '#111113', border: '1px solid #27272a', overflow: 'hidden',
  },
  statusStrip: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px',
  },
  indicatorTitle: {
    padding: '16px 20px 8px', fontSize: '15px', fontWeight: '600', color: '#a1a1aa',
    display: 'flex', alignItems: 'center', gap: '8px'
  },
  comparisonGrid: {
    display: 'flex', gap: '16px', padding: '12px 20px'
  },
  choiceCard: {
    flex: 1, padding: '16px', borderRadius: '8px', cursor: 'pointer',
    border: '1px solid #27272a', backgroundColor: '#18181b', transition: 'all 0.15s ease-in-out',
    display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative'
  },
  choiceSelected: {
    borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.05)', 
    boxShadow: '0 0 15px rgba(99, 102, 241, 0.1)'
  },
  checkCircle: {
    position: 'absolute', top: '12px', right: '12px', width: '18px', height: '18px',
    borderRadius: '50%', border: '2px solid #27272a', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '10px'
  },
  checkCircleActive: {
    backgroundColor: '#6366f1', borderColor: '#6366f1', color: 'white'
  },
  resultBox: {
    margin: '12px 20px 20px', padding: '16px', borderRadius: '8px',
    backgroundColor: '#0a0a0c', border: '1px dashed #3f3f46'
  },
  textarea: {
    width: '100%', minHeight: '60px', padding: '12px', borderRadius: '6px',
    fontSize: '14px', lineHeight: '1.6', border: '1px solid #27272a',
    backgroundColor: '#111113', color: '#e4e4e7', outline: 'none', resize: 'vertical'
  },
  footer: {
    padding: '16px 28px', borderTop: '1px solid #18181b', backgroundColor: '#0a0a0c',
    display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0
  },
  primaryBtn: {
    backgroundColor: '#6366f1', color: 'white', padding: '10px 20px', borderRadius: '8px',
    fontWeight: '600', fontSize: '14px', border: 'none', cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
  },
  badge: {
    display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '4px',
    fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' as any, letterSpacing: '0.02em'
  }
};

const StatusBadge = ({ type, active }: { type: 'good' | 'growth', active: boolean }) => {
  if (!active) return null;
  return type === 'good'
    ? <span style={{ ...styles.badge, color: '#4ade80', backgroundColor: 'rgba(74, 222, 128, 0.1)' }}>Strength</span>
    : <span style={{ ...styles.badge, color: '#f87171', backgroundColor: 'rgba(248, 113, 113, 0.1)' }}>Growth</span>;
};

export const ConflictResolutionModal: React.FC<Props> = ({ isOpen, onClose, onResolve, localData, serverData }) => {
  const [resolvedIndicators, setResolvedIndicators] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (isOpen && localData && serverData) {
      const allItems: any[] = [];
      const localMeta = localData.meta || {};
      const lTeacher = (localMeta.teacherName || "").trim();
      const sTeacher = (serverData.teacher_name || "").trim();
      
      if (lTeacher !== sTeacher || (localMeta.schoolName || "").trim() !== (serverData.school_name || "").trim()) {
        allItems.push({
          id: 'META_CONFLICT', number: 'ID', title: 'Header Information', isMeta: true,
          _localText: `Teacher: ${lTeacher}\nSchool: ${localMeta.schoolName}`,
          _serverText: `Teacher: ${sTeacher}\nSchool: ${serverData.school_name}`,
          commentText: `Teacher: ${lTeacher}\nSchool: ${localMeta.schoolName}`,
          _isConflict: true, _selectedSource: 'local'
        });
      }

      const mergedInds = (localData.indicators || []).map((lInd: any) => {
        const sInd = (serverData.indicators || []).find((i: any) => i.id === lInd.id);
        const isConflict = (lInd.commentText || "").trim() !== (sInd?.commentText || "").trim() || (lInd.good !== sInd?.good);
        return {
          ...lInd, _localText: lInd.commentText, _serverText: sInd?.commentText || "",
          _localGood: lInd.good, _localGrowth: lInd.growth, _serverVersion: sInd,
          _isConflict: isConflict, _selectedSource: 'local'
        };
      });
      setResolvedIndicators([...allItems, ...mergedInds]);
    }
  }, [isOpen, localData, serverData]);

  if (!isOpen || !mounted) return null;

  const handleSelect = (idx: number, src: 'local' | 'server') => {
    setResolvedIndicators(prev => {
      const copy = [...prev];
      const item = copy[idx];
      copy[idx] = { 
        ...item, _selectedSource: src, _isConflict: false,
        commentText: src === 'local' ? item._localText : item._serverText,
        good: src === 'local' ? item._localGood : item._serverVersion?.good,
        growth: src === 'local' ? item._localGrowth : item._serverVersion?.growth,
      };
      return copy;
    });
  };

  const handleFinalize = () => {
    const cleanIndicators = resolvedIndicators.filter(i => !i.isMeta).map(({ _localText, _serverText, _serverVersion, _isConflict, _selectedSource, _localGood, _localGrowth, ...clean }) => clean);
    onResolve({ ...localData, indicators: cleanIndicators, updatedAt: Date.now(), lastSync: Date.now() });
  };

  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={{display:'flex', alignItems:'center', gap:'12px'}}>
            <span style={{fontSize:'20px'}}>⚡</span>
            <h2 style={{margin:0, fontSize:'18px', fontWeight:600}}>Review Conflicts</h2>
          </div>
          <button onClick={onClose} style={{...styles.btn, backgroundColor:'transparent', color:'#71717a'}}>Close</button>
        </div>

        <div style={styles.body}>
          {resolvedIndicators.map((ind, idx) => (
            <div key={ind.id} style={styles.cardContainer}>
              <div style={{...styles.statusStrip, backgroundColor: ind._isConflict ? '#ef4444' : '#10b981'}} />
              
              <div style={styles.indicatorTitle}>
                <span style={{color:'#6366f1'}}>{ind.number}</span> {ind.title}
              </div>

              <div style={styles.comparisonGrid}>
                {['local', 'server'].map((src) => {
                  const isSelected = ind._selectedSource === src;
                  return (
                    <div key={src} 
                         onClick={() => handleSelect(idx, src as any)}
                         style={{...styles.choiceCard, ...(isSelected ? styles.choiceSelected : {})}}>
                      <div style={styles.checkCircle}>
                        {isSelected && "✓"}
                      </div>
                      <div style={{fontSize:'12px', color:'#71717a', fontWeight:600, textTransform:'uppercase'}}>
                        {src === 'local' ? 'On iPad' : 'On Server'}
                      </div>
                      <div style={{display:'flex', gap:'8px'}}>
                        <StatusBadge type="good" active={src === 'local' ? ind._localGood : ind._serverVersion?.good} />
                        <StatusBadge type="growth" active={src === 'local' ? ind._localGrowth : ind._serverVersion?.growth} />
                      </div>
                      <div style={{fontSize:'14px', color: isSelected ? '#fff' : '#a1a1aa', whiteSpace:'pre-wrap'}}>
                        {(src === 'local' ? ind._localText : ind._serverText) || <span style={{fontStyle:'italic', opacity:0.3}}>No comment</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={styles.resultBox}>
                <div style={{fontSize:'11px', color:'#71717a', marginBottom:'8px', fontWeight:600}}>RESULTING COMMENT</div>
                <textarea 
                  style={styles.textarea} 
                  value={ind.commentText} 
                  onChange={(e) => setResolvedIndicators(prev => prev.map((item, i) => i === idx ? {...item, commentText: e.target.value, _selectedSource:'manual', _isConflict:false} : item))}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={styles.footer}>
          <button onClick={handleFinalize} style={styles.primaryBtn}>Update & Sync</button>
        </div>
      </div>
    </div>,
    document.body
  );
};