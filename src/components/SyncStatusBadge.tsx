import React from 'react';

type SyncStatus = 'synced' | 'local-changes' | 'server-newer' | 'conflict';

interface Props {
  status: SyncStatus;
  onPush?: () => void;
  onPull?: () => void;
}

export const SyncStatusBadge: React.FC<Props> = ({ status, onPush, onPull }) => {
  
  // ✅ STATE 1: SYNCED (Gradient Green)
  if (status === 'synced') {
    return (
      <div 
        title="Safe in Cloud"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: 'white', fontSize: '11px', fontWeight: '600',
          boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
        }}
      >
        <span style={{ fontSize: '12px' }}>✓</span>
        <span>Synced</span>
      </div>
    );
  }

  // ⬆️ STATE 2: LOCAL CHANGES (Push - Gradient Orange)
  if (status === 'local-changes') {
    return (
      <button 
        onClick={(e) => { e.stopPropagation(); onPush?.(); }}
        title="You have unsaved changes. Click to Push."
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 12px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
          color: 'white', border: 'none', cursor: 'pointer',
          fontSize: '11px', fontWeight: 'bold',
          boxShadow: '0 2px 5px rgba(234, 88, 12, 0.3)'
        }}
      >
        <span style={{ fontSize: '12px' }}>⬆</span>
        <span>Push</span>
      </button>
    );
  }

  // ⬇️ STATE 3: SERVER NEWER (Pull - Gradient Blue)
  if (status === 'server-newer') {
    return (
      <button 
        onClick={(e) => { e.stopPropagation(); onPull?.(); }}
        title="Server has newer data. Click to Update."
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 12px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          color: 'white', border: 'none', cursor: 'pointer',
          fontSize: '11px', fontWeight: 'bold',
          boxShadow: '0 2px 5px rgba(37, 99, 235, 0.3)'
        }}
      >
        <span style={{ fontSize: '12px' }}>⬇</span>
        <span>Pull</span>
      </button>
    );
  }

  // ⚔️ STATE 4: CONFLICT (Red - Phase 4)
  if (status === 'conflict') {
    return (
      <div 
        title="Conflict Detected"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', borderRadius: '20px',
          background: '#ef4444', color: 'white',
          fontSize: '11px', fontWeight: 'bold'
        }}
      >
        <span>⚔️ Conflict</span>
      </div>
    );
  }

  return null;
};