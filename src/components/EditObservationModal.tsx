import React, { useState, useEffect } from 'react';
import type { DashboardObservationRow } from '../DashboardShell';

interface EditObservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  observation: DashboardObservationRow | null;
  onSave: (id: string, updatedMeta: Partial<DashboardObservationRow['meta']>) => void;
}

export const EditObservationModal: React.FC<EditObservationModalProps> = ({
  isOpen,
  onClose,
  observation,
  onSave,
}) => {
  const [teacherName, setTeacherName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [campus, setCampus] = useState('');
  const [unit, setUnit] = useState('');
  const [lesson, setLesson] = useState('');
  const [supportType, setSupportType] = useState<DashboardObservationRow['supportType']>('Visit');
  const [date, setDate] = useState(''); // ISO date string YYYY-MM-DD

  useEffect(() => {
    if (isOpen && observation) {
      setTeacherName(observation.teacherName || '');
      setSchoolName(observation.schoolName || '');
      setCampus(observation.campus || '');
      setUnit(observation.unit || '');
      setLesson(observation.lesson || '');
      setSupportType(observation.supportType || 'Visit');
      setDate(observation.isoDate || '');
    }
  }, [isOpen, observation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (observation) {
      onSave(observation.id, {
        teacherName,
        schoolName,
        campus,
        unit,
        lesson,
        supportType,
        date,
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Edit Observation Metadata</div>
          <div className="modal-subtitle">
            {observation?.teacherName} – {observation?.schoolName}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-row">
            <label>Teacher Name:</label>
            <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} className="input" required />
          </div>
          <div className="form-row">
            <label>School Name:</label>
            <input type="text" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className="input" required />
          </div>
          <div className="form-row">
            <label>Campus:</label>
            <input type="text" value={campus} onChange={(e) => setCampus(e.target.value)} className="input" />
          </div>
          <div className="form-row">
            <label>Unit:</label>
            <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} className="input" />
          </div>
          <div className="form-row">
            <label>Lesson:</label>
            <input type="text" value={lesson} onChange={(e) => setLesson(e.target.value)} className="input" />
          </div>
          <div className="form-row">
            <label>Support Type:</label>
            <select value={supportType} onChange={(e) => setSupportType(e.target.value as DashboardObservationRow['supportType'])} className="select">
              <option value="Training">Training</option>
              <option value="LVA">LVA</option>
              <option value="Visit">Visit</option>
            </select>
          </div>
          <div className="form-row">
            <label>Date (YYYY-MM-DD):</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
};