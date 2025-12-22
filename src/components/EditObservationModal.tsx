import React, { useState, useEffect, useMemo } from 'react';
import type { DashboardObservationRow } from '../DashboardShell';
import { supabase } from '../supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { SCHOOL_MASTER_LIST } from '../schoolMaster';

interface SchoolRow {
  id: string;
  trainer_id: string;
  school_name: string;
  campus_name: string;
  am_name: string | null;
  am_email: string | null;
  admin_name: string | null;
  admin_email: string | null;
  admin_phone: string | null;
  address_line1: string | null;
  city: string | null;
}

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
  const { user } = useAuth();
  const [teacherName, setTeacherName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [campus, setCampus] = useState('');
  const [unit, setUnit] = useState('');
  const [lesson, setLesson] = useState('');
  const [supportType, setSupportType] = useState<DashboardObservationRow['supportType']>('Visit');
  const [date, setDate] = useState(''); // ISO date string YYYY-MM-DD

  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadSchools() {
      try {
        setSchoolsLoading(true);
        setSchoolsError(null);

        const { data, error } = await supabase
          .from("schools")
          .select("school_name, campus_name")
          .eq("trainer_id", user!.id)
          .order("school_name", { ascending: true })
          .order("campus_name", { ascending: true });

        if (error) {
          console.error("[DB] load schools error", error);
          if (!cancelled) setSchoolsError(error.message);
          return;
        }

        if (!cancelled && data) {
          setSchools(data as SchoolRow[]);
        }
      } finally {
        if (!cancelled) setSchoolsLoading(false);
      }
    }

    loadSchools();
    return () => { cancelled = true; };
  }, [user]);

  const schoolOptions = useMemo(() => {
    const names = (schools.length
      ? schools.map((s) => s.school_name)
      : SCHOOL_MASTER_LIST.map((s) => s.schoolName)
    ).filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [schools]);

  const campusOptions = useMemo(() => {
    if (!schoolName) return [];
    if (schools.length) {
      const campuses = schools
        .filter((s) => s.school_name === schoolName)
        .map((s) => s.campus_name)
        .filter(Boolean);
      return Array.from(new Set(campuses));
    }
    return SCHOOL_MASTER_LIST.filter((s) => s.schoolName === schoolName)
      .map((s) => s.campusName)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }, [schoolName, schools]);

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
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="modal-header">
          <div className="modal-title">Edit Observation Metadata</div>
          <div className="modal-subtitle">
            {observation?.teacherName} – {observation?.schoolName}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="modal-body" style={{ flexGrow: 1, overflowY: "auto" }}>
          <div className="form-row">
            <label>Teacher Name:</label>
            <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} className="input" required />
          </div>
          <div className="form-row">
            <label>School Name:</label>
            <select
              className="select"
              value={schoolName}
              onChange={(e) => { setSchoolName(e.target.value); setCampus(''); }}
              required
            >
              <option value="">Select school…</option>
              {schoolOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {schoolsError && <div className="field-error">Could not load schools ({schoolsError}).</div>}
          </div>
          <div className="form-row">
            <label>Campus:</label>
            <select
              className="select"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              disabled={!schoolName || campusOptions.length === 0}
            >
              <option value="">Select campus…</option>
              {campusOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
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