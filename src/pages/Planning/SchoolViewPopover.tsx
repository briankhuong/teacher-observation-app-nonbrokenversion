import React, { useState } from 'react';
import { X, Check, Eraser as EraserIcon } from 'lucide-react';
export interface SchoolViewPopoverRow {
    teacherId: string;
    name: string;
    statusLabel: string;
    defaultChecked: boolean;
}
interface SchoolViewPopoverProps {
    x: number;
    y: number;
    mode: 'apply' | 'erase';
    school: string;
    campus: string;
    monthLabel: string;
    rows: SchoolViewPopoverRow[];
    onClose: () => void;
    onConfirm: (checkedIds: Set<string>) => void;
}
const SchoolViewPopover: React.FC<SchoolViewPopoverProps> = ({
    x, y, mode, school, campus, monthLabel, rows, onClose, onConfirm
}) => {
    const [checked, setChecked] = useState<Set<string>>(
        new Set(rows.filter(r => r.defaultChecked).map(r => r.teacherId))
    );
    const style = {
        top: Math.min(y, window.innerHeight - 360),
        left: Math.min(x, window.innerWidth - 280),
    };
    const toggle = (id: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const handleConfirm = () => {
        onConfirm(checked);
        onClose();
    };
    return (
        <>
            <div className="menu-overlay" onClick={onClose} />
            <div className="planning-context-menu school-view-popover" style={style}>
                <div className="menu-header">
                    <span>{mode === 'apply' ? 'Apply Visit' : 'Erase Visit'} — {campus} ({monthLabel})</span>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                        <X size={14} />
                    </button>
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '8px' }}>{school}</div>
                <div className="school-view-popover-list">
                    {rows.length === 0 && (
                        <div style={{ fontSize: '11px', color: '#64748b', padding: '8px 0' }}>
                            No teachers to {mode === 'apply' ? 'plan' : 'erase'}.
                        </div>
                    )}
                    {rows.map(row => (
                        <label key={row.teacherId} className="school-view-popover-row">
                            <input
                                type="checkbox"
                                checked={checked.has(row.teacherId)}
                                onChange={() => toggle(row.teacherId)}
                            />
                            <span className="school-view-popover-name">{row.name}</span>
                            <span className="school-view-popover-status">{row.statusLabel}</span>
                        </label>
                    ))}
                </div>
                <button
                    className="btn-save"
                    onClick={handleConfirm}
                    disabled={rows.length === 0}
                    style={{
                        background: mode === 'erase' ? '#ef4444' : '#3b82f6',
                        opacity: rows.length === 0 ? 0.6 : 1,
                        cursor: rows.length === 0 ? 'not-allowed' : 'pointer'
                    }}
                >
                    {mode === 'apply'
                        ? <Check size={12} style={{ marginRight: '6px' }} />
                        : <EraserIcon size={12} style={{ marginRight: '6px' }} />}
                    {mode === 'apply' ? `Apply to ${checked.size} teacher(s)` : `Erase ${checked.size} teacher(s)`}
                </button>
            </div>
        </>
    );
};
export default SchoolViewPopover;