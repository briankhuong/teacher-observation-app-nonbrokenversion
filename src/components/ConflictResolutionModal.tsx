import React, { useState, useEffect, useRef } from "react";
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
    backgroundColor: '#0a0a0c', width: '96%', maxWidth: '1100px', height: '92vh',
    borderRadius: '16px', border: '1px solid #27272a', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,255,255,0.05), 0 20px 50px rgba(0,0,0,0.5)',
    color: '#f4f4f5', position: 'relative'
  },
  header: {
    padding: '16px 28px', borderBottom: '1px solid #18181b', backgroundColor: '#0a0a0c',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0
  },
  navBar: {
    padding: '12px 24px', backgroundColor: '#0f0f12', borderBottom: '1px solid #18181b',
    display: 'flex', gap: '8px', overflowX: 'auto', flexShrink: 0, whiteSpace: 'nowrap',
    msOverflowStyle: 'none', scrollbarWidth: 'none'
  },
  navToken: {
    padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
    cursor: 'pointer', border: '1px solid #27272a', transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', gap: '6px'
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '24px', backgroundColor: '#0a0a0c',
    WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth'
  },
  scrollTopBtn: {
    position: 'absolute', bottom: '80px', right: '30px', width: '44px', height: '44px',
    borderRadius: '50%', backgroundColor: '#1e1e22', border: '1px solid #3f3f46',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 10,
    transition: 'opacity 0.3s'
  },
  cardContainer: {
    marginBottom: '32px', position: 'relative', borderRadius: '12px',
    backgroundColor: '#111113', border: '1px solid #27272a', overflow: 'hidden',
    transition: 'background-color 0.3s ease'
  },
  statusStrip: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px',
    transition: 'background-color 0.3s ease'
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
    backgroundColor: '#059669', color: 'white', padding: '10px 20px', borderRadius: '8px',
    fontWeight: '600', fontSize: '14px', border: 'none', cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(5, 150, 105, 0.3)'
  },
  stepperContainer: {
    display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto'
  },
  stepperBtn: {
    backgroundColor: '#18181b', color: '#a1a1aa', border: '1px solid #27272a',
    padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
    cursor: 'pointer'
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
function getDiff(oldString: string | null | undefined = "", newString: string | null | undefined = "") {
  const oldWords = (oldString || "").split(/(\s+)/);
  const newWords = (newString || "").split(/(\s+)/);
  const dp: number[][] = Array(oldWords.length + 1).fill(null).map(() => Array(newWords.length + 1).fill(0));
  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const result: { type: 'equal' | 'add' | 'remove', value: string }[] = [];
  let i = oldWords.length;
  let j = newWords.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      result.unshift({ type: 'equal', value: oldWords[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', value: newWords[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      result.unshift({ type: 'remove', value: oldWords[i - 1] });
      i--;
    }
  }
  return result;
}
export const ConflictResolutionModal: React.FC<Props> = ({ isOpen, onClose, onResolve, localData, serverData }) => {
  const [resolvedIndicators, setResolvedIndicators] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);
  const [showTopBtn, setShowTopBtn] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
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
          _textMismatch: true, _isConflict: true, _selectedSource: 'local'
        });
      }
      const mergedInds = (localData.indicators || []).map((lInd: any) => {
        const sInd = (serverData.indicators || []).find((i: any) => i.id === lInd.id);
        const lText = (lInd.commentText || "").trim();
        const sText = (sInd?.commentText || "").trim();
        const isConflict = lText !== sText || lInd.good !== sInd?.good || lInd.growth !== sInd?.growth;
        const isTextMismatch = lText !== sText;
        return {
          ...lInd, _localText: lInd.commentText, _serverText: sInd?.commentText || "",
          _localGood: lInd.good, _localGrowth: lInd.growth, _serverVersion: sInd,
          _textMismatch: isTextMismatch, _isConflict: isConflict, _selectedSource: 'local'
        };
      });
      setResolvedIndicators([...allItems, ...mergedInds]);
    }
  }, [isOpen, localData, serverData]);
  const handleScroll = () => {
    if (bodyRef.current) setShowTopBtn(bodyRef.current.scrollTop > 300);
  };
  const scrollToIndicator = (id: string) => {
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const findNextConflict = (dir: 'next' | 'prev') => {
    const conflicts = resolvedIndicators.filter(i => i._isConflict);
    if (conflicts.length > 0) scrollToIndicator(conflicts[0].id);
  };
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
    const cleanIndicators = resolvedIndicators.filter(i => !i.isMeta).map(({ _localText, _serverText, _serverVersion, _isConflict, _selectedSource, _localGood, _localGrowth, _textMismatch, ...clean }) => clean);
    onResolve({ ...localData, indicators: cleanIndicators, updatedAt: Date.now(), lastSync: Date.now() });
  };
  if (!isOpen || !mounted) return null;
  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Review Conflicts</h2>
          </div>
          <button onClick={onClose} style={{ ...styles.btn, backgroundColor: 'transparent', color: '#71717a' }}>Close</button>
        </div>
        <div style={styles.navBar}>
          <span style={{ color: '#52525b', fontSize: '11px', fontWeight: 700, alignSelf: 'center', marginRight: '8px' }}>PROGRESS:</span>
          {resolvedIndicators.map((ind) => {
            const isResolved = !ind._isConflict;
            return (
              <div key={`nav-${ind.id}`} onClick={() => scrollToIndicator(ind.id)}
                style={{
                  ...styles.navToken,
                  borderColor: isResolved ? '#27272a' : (ind._textMismatch ? '#a855f7' : '#27272a'),
                  backgroundColor: isResolved ? 'transparent' : (ind._textMismatch ? 'rgba(168, 85, 247, 0.1)' : '#18181b'),
                  opacity: isResolved ? 0.5 : 1
                }}>
                {isResolved && <span style={{ fontSize: '10px' }}>✓</span>}
                {ind.number}
                {!isResolved && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: ind.growth ? '#ef4444' : (ind.good ? '#10b981' : '#3f3f46') }} />}
              </div>
            );
          })}
        </div>
        {showTopBtn && <div style={styles.scrollTopBtn} onClick={() => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>↑</div>}
        <div style={styles.body} ref={bodyRef} onScroll={handleScroll}>
          {resolvedIndicators.map((ind, idx) => {
            const stripColor = ind.growth ? '#ef4444' : (ind.good ? '#10b981' : '#27272a');
            const cardBg = ind._textMismatch ? 'rgba(168, 85, 247, 0.06)' : '#111113';
            const cardBorder = ind._textMismatch ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid #27272a';
            return (
              <div key={ind.id} ref={(el) => { cardRefs.current[ind.id] = el; }}
                style={{ ...styles.cardContainer, backgroundColor: cardBg, border: cardBorder }}>
                <div style={{ ...styles.statusStrip, backgroundColor: stripColor }} />
                <div style={styles.indicatorTitle}>
                  <span style={{ color: ind._textMismatch ? '#a855f7' : '#6366f1' }}>{ind.number}</span> {ind.title}
                  {ind._textMismatch && <span style={{ fontSize: '10px', color: '#a855f7', fontWeight: 700, marginLeft: 'auto' }}>CONTENT MISMATCH</span>}
                </div>
                {/* 🔎 TRACK CHANGES DIFF */}
                {ind._textMismatch && (
                  <div style={{
                    margin: '0 20px 12px',
                    padding: '12px',
                    background: '#020617',
                    border: '1px solid rgba(168, 85, 247, 0.5)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.5',
                    color: '#e2e8f0'
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '6px', color: '#c084fc' }}>
                      Track Changes (Local → Server)
                    </div>
                    {getDiff(ind._localText, ind._serverText).map((part, idx) => {
                      if (part.type === 'add') {
                        return <span key={idx} style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', fontWeight: 600, padding: '0 2px', borderRadius: '2px' }}>{part.value}</span>;
                      } else if (part.type === 'remove') {
                        return <span key={idx} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', textDecoration: 'line-through', padding: '0 2px', borderRadius: '2px' }}>{part.value}</span>;
                      }
                      return <span key={idx}>{part.value}</span>;
                    })}
                  </div>
                )}
                <div style={styles.comparisonGrid}>
                  {['local', 'server'].map((src) => {
                    const isSelected = ind._selectedSource === src;
                    return (
                      <div key={src} onClick={() => handleSelect(idx, src as any)}
                        style={{ ...styles.choiceCard, ...(isSelected ? styles.choiceSelected : {}) }}>
                        <div style={{ ...styles.checkCircle, ...(isSelected ? { backgroundColor: '#6366f1', borderColor: '#6366f1', color: 'white' } : {}) }}>
                          {isSelected && "✓"}
                        </div>
                        <div style={{ fontSize: '12px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase' }}>
                          {src === 'local' ? 'On iPad' : 'On Server'}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <StatusBadge type="good" active={src === 'local' ? ind._localGood : ind._serverVersion?.good} />
                          <StatusBadge type="growth" active={src === 'local' ? ind._localGrowth : ind._serverVersion?.growth} />
                        </div>
                        <div style={{ fontSize: '14px', color: isSelected ? '#fff' : '#a1a1aa', whiteSpace: 'pre-wrap' }}>
                          {(src === 'local' ? ind._localText : ind._serverText) || <span style={{ fontStyle: 'italic', opacity: 0.3 }}>No comment</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={styles.resultBox}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px', fontWeight: 600 }}>RESULTING COMMENT</div>
                  <textarea style={styles.textarea} value={ind.commentText}
                    onChange={(e) => setResolvedIndicators(prev => prev.map((item, i) => i === idx ? { ...item, commentText: e.target.value, _selectedSource: 'manual', _isConflict: false } : item))} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={styles.footer}>
          <div style={styles.stepperContainer}>
            <button style={styles.stepperBtn} onClick={() => findNextConflict('prev')}>← Prev Conflict</button>
            <button style={{ ...styles.stepperBtn, borderColor: '#6366f1', color: '#6366f1' }} onClick={() => findNextConflict('next')}>Next Conflict →</button>
          </div>
          <button onClick={handleFinalize} style={styles.primaryBtn}>Update & Sync</button>
        </div>
      </div>
    </div>,
    document.body
  );
};