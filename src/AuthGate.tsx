// src/AuthGate.tsx
import React, { useEffect } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./auth/AuthContext";
import { fetchTeachers } from "./db/teachers";

interface AuthGateProps {
  children: ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { session, loading, signInWithAzure } = useAuth();

  // Load initial teacher data once the user is logged in
  useEffect(() => {
    if (!session) return; // not logged in yet → do nothing

    (async () => {
      try {
        await fetchTeachers();
      } catch (err) {
        console.error("[DB] Could not load teachers", err);
      }
    })();
  }, [session]);

  // 1) While Supabase is restoring the session
  if (loading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title">Teacher Observation</div>
          <div className="auth-subtitle">Restoring your session…</div>
        </div>
      </div>
    );
  }

  // 2) Not authenticated → show login screen
  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title">Teacher Observation</div>
          <div className="auth-subtitle">
            Sign in with your Grapeseed / Office 365 account to continue.
          </div>

          <button
            type="button"
            className="btn auth-btn"
            onClick={signInWithAzure}
          >
            Sign in with Microsoft
          </button>

          <div className="auth-hint">
            You will be redirected to the Microsoft login page, then back here.
          </div>
        </div>
      </div>
    );
  }

  // 3) Authenticated → just render the app.
  // App.tsx will provide the main header / toolbar.
  return <>{children}</>;
};