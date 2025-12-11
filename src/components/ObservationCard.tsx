// src/components/ObservationCard.tsx
import React from "react";

export interface ObservationCardProps {
  observation: {
    id: string;
    teacherName: string;
    schoolName: string;
    campus: string;
    unit: string;
    lesson: string;
    supportType: "Training" | "LVA" | "Visit";
    date: string;
    status: "draft" | "saved"; // lock/completed
    teacherWorkbookUrl?: string | null;
    adminWorkbookUrl?: string | null;
    indicatorsCompletedCount?: number;
    indicatorsTotalCount?: number;
  };
  onOpen: () => void;

  onPreCallEmail: () => void;
  onPostCallEmail: () => void;
  onMergeTeacherWorkbook: () => void;
  onMergeAdminWorkbook: () => void;
  onAdminUpdateEmail: () => void;
}

export const ObservationCard: React.FC<ObservationCardProps> = ({
  observation,
  onOpen,
  onPreCallEmail,
  onPostCallEmail,
  onMergeTeacherWorkbook,
  onMergeAdminWorkbook,
  onAdminUpdateEmail,
}) => {
  const {
    teacherName,
    schoolName,
    campus,
    unit,
    lesson,
    supportType,
    date,
    status,
    indicatorsCompletedCount,
    indicatorsTotalCount,
  } = observation;

  const statusLabel = status === "saved" ? "Completed" : "Draft";

  return (
    <button
      type="button"
      className="observation-card"
      onClick={onOpen}
    >
      {/* main card content */}
      <div className="observation-card-main">
        <div className="observation-card-title-row">
          <div className="observation-card-title">{teacherName}</div>
          <div className="observation-card-date">
            {new Date(date).toLocaleDateString()}
          </div>
        </div>

        <div className="observation-card-subtitle">
          {schoolName} – {campus} • Unit {unit} – Lesson {lesson} •{" "}
          {supportType}
        </div>

        <div className="observation-card-meta-row">
          <span
            className={`status-pill status-pill--${
              status === "saved" ? "completed" : "draft"
            }`}
          >
            {statusLabel}
          </span>
          <span className="observation-card-indicators">
            {indicatorsCompletedCount ?? 0} / {indicatorsTotalCount ?? 18}{" "}
            indicators
          </span>
        </div>
      </div>

      {/* ACTION BUTTON ROW – 5 buttons */}
      <div className="observation-card-actions">
        <button
          type="button"
          className="btn btn-xs"
          onClick={(e) => {
            e.stopPropagation();
            onPreCallEmail();
          }}
        >
          Pre call
        </button>

        <button
          type="button"
          className="btn btn-xs"
          onClick={(e) => {
            e.stopPropagation();
            onPostCallEmail();
          }}
        >
          Post call
        </button>

        <button
          type="button"
          className="btn btn-xs"
          onClick={(e) => {
            e.stopPropagation();
            onMergeTeacherWorkbook();
          }}
        >
          Merge teacher
        </button>

        <button
          type="button"
          className="btn btn-xs"
          onClick={(e) => {
            e.stopPropagation();
            onMergeAdminWorkbook();
          }}
        >
          Merge admin
        </button>

        <button
          type="button"
          className="btn btn-xs"
          onClick={(e) => {
            e.stopPropagation();
            onAdminUpdateEmail();
          }}
        >
          Admin update
        </button>
      </div>
    </button>
  );
};