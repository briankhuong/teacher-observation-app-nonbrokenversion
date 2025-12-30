import React, { useState, useEffect } from "react";

// Helper: Check if a specific indicator is different
const hasChanged = (local: any, server: any) => {
  if (!local || !server) return true;
  if (local.commentText !== server.commentText) return true;
  if (local.good !== server.good) return true;
  if (local.growth !== server.growth) return true;
  return false;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResolve: (mergedData: any) => void;
  localData: any; 
  serverData: any;
}

export const ConflictResolutionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onResolve,
  localData,
  serverData,
}) => {
  const [resolvedIndicators, setResolvedIndicators] = useState<any[]>([]);

  // 🟢 Load Data on Open
  useEffect(() => {
    if (isOpen && localData && serverData) {
      // We map over LOCAL indicators. If the server has a matching ID, we compare.
      // Default Strategy: Keep LOCAL version initially, but flag conflicts.
      const merged = localData.indicators.map((lInd: any) => {
        const sInd = serverData.indicators.find((s: any) => s.id === lInd.id);
        
        return {
          ...lInd, 
          _serverVersion: sInd, 
          // It's a conflict if server exists AND data is different
          _isConflict: sInd && hasChanged(lInd, sInd)
        };
      });
      setResolvedIndicators(merged);
    }
  }, [isOpen, localData, serverData]);

  if (!isOpen || !localData || !serverData) return null;

  // 🟢 Merge Logic (The Core Feature)
  const handleMergeAction = (index: number, action: 'keep_local' | 'keep_server' | 'combine') => {
    setResolvedIndicators(prev => {
      const copy = [...prev];
      const current = copy[index];
      const server = current._serverVersion;

      if (!server) return prev;

      if (action === 'keep_local') {
        // Just force local values
        copy[index] = { ...current, ...current, _isConflict: false }; 
        // We keep _serverVersion hidden but accessible just in case
      } 
      else if (action === 'keep_server') {
        // Overwrite with server values
        copy[index] = { ...server, _serverVersion: server, _isConflict: false };
      } 
      else if (action === 'combine') {
        // 🧠 Smart Merge: Concat text
        const combinedText = [
          current.commentText?.trim(),
          "----------------",
          "[Server Update]:",
          server.commentText?.trim()
        ].filter(Boolean).join("\n");

        copy[index] = {
          ...current,
          commentText: combinedText,
          // Union flags: If either said "Good", it's Good.
          good: current.good || server.good,
          growth: current.growth || server.growth,
          _isConflict: false // Mark resolved
        };
      }
      return copy;
    });
  };

  const handleFinalize = () => {
    // Clean up internal flags before saving
    const cleanIndicators = resolvedIndicators.map(({ _serverVersion, _isConflict, ...rest }) => rest);
    
    const finalPayload = {
      ...localData, // Keep local meta fields (Teacher Name etc) by default
      indicators: cleanIndicators,
      updatedAt: Date.now(), // Bump timestamp so WE become the "Newest" version
    };

    onResolve(finalPayload);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-sm">
      <div className="bg-slate-900 w-full max-w-6xl h-[90vh] flex flex-col rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
        
        {/* HEADER */}
        <div className="p-4 border-b border-slate-700 bg-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-red-500">⚔️</span> 
              Conflict Detected
            </h2>
            <p className="text-slate-400">
              The server has a newer version. Review changes below to prevent data loss.
            </p>
          </div>
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded">
            Cancel
          </button>
        </div>

        {/* SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900/95">
          
          <div className="grid grid-cols-3 gap-4 mb-2 font-bold text-slate-300 uppercase tracking-wider text-xs">
            <div className="text-center p-2 bg-indigo-900/40 rounded border border-indigo-500/20">📱 Your iPad</div>
            <div className="text-center p-2 bg-sky-900/40 rounded border border-sky-500/20">☁️ Server</div>
            <div className="text-center p-2 bg-emerald-900/40 rounded border border-emerald-500/20">✅ Result</div>
          </div>

          {resolvedIndicators.map((ind, idx) => {
            if (!ind._isConflict) return null; // Hide non-conflicts to reduce noise
            const sInd = ind._serverVersion;

            return (
              <div key={ind.id} className="grid grid-cols-3 gap-4 bg-slate-800/40 p-4 rounded-lg border border-slate-700">
                
                {/* 1. LOCAL */}
                <div className="space-y-2">
                  <div className="font-bold text-indigo-400">{ind.number} {ind.title}</div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-700 text-slate-300 min-h-[60px] whitespace-pre-wrap">
                    {localData.indicators.find((x:any) => x.id === ind.id)?.commentText || <span className="opacity-50">Empty</span>}
                  </div>
                  <button onClick={() => handleMergeAction(idx, 'keep_local')} className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold">
                    Keep Mine
                  </button>
                </div>

                {/* 2. SERVER */}
                <div className="space-y-2">
                  <div className="font-bold text-sky-400 text-right">Server Version</div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-700 text-slate-300 min-h-[60px] whitespace-pre-wrap">
                    {sInd.commentText || <span className="opacity-50">Empty</span>}
                  </div>
                  <button onClick={() => handleMergeAction(idx, 'keep_server')} className="w-full py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold">
                    Use Server's
                  </button>
                </div>

                {/* 3. RESULT */}
                <div className="space-y-2 relative">
                  <div className="font-bold text-emerald-400 text-center">Merged Output</div>
                  <textarea 
                    className="w-full h-[60px] bg-black text-white p-2 rounded border border-emerald-500/50 focus:ring-1 focus:ring-emerald-500"
                    value={ind.commentText}
                    onChange={(e) => {
                       const val = e.target.value;
                       setResolvedIndicators(prev => prev.map((x, i) => i === idx ? { ...x, commentText: val } : x));
                    }}
                  />
                  <button onClick={() => handleMergeAction(idx, 'combine')} className="w-full py-1.5 border border-slate-600 hover:bg-slate-700 text-slate-300 rounded">
                    🔗 Combine Both
                  </button>
                </div>

              </div>
            );
          })}

          {resolvedIndicators.every(i => !i._isConflict) && (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <div className="text-4xl mb-2">🎉</div>
              <div>No conflicts found in text content.</div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t border-slate-700 bg-slate-800 flex justify-end gap-4">
          <button onClick={onClose} className="px-4 py-2 text-slate-300">Close</button>
          <button 
            onClick={handleFinalize}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow-lg shadow-emerald-900/50"
          >
            💾 Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
};