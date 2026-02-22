import React, { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';

interface GrapeSeedLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void; // Passes the token back so the app can immediately use it
}

export const GrapeSeedLoginModal: React.FC<GrapeSeedLoginModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setError('');

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
      
      const response = await fetch(`${API_BASE_URL}/api/login-grapeseed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid email or password.');
      }

      // 1. Save to browser storage for the session
      localStorage.setItem('grapeseed_token', data.access_token);
      
      // 2. Pass it back to the parent component
      onSuccess(data.access_token);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="obs-action-modal-backdrop" style={{ zIndex: 9999, backdropFilter: "blur(2px)", backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}>
      <div className="obs-action-modal" style={{ width: 400, maxWidth: "95vw", background: "#ffffff", borderRadius: 8, overflow: "hidden", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
        
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", background: "#f8fafc", display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={18} color="#0f172a" />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#0f172a" }}>Connect GrapeSEED</h2>
        </div>

        {/* Body Form */}
        <form onSubmit={handleLogin} style={{ padding: "24px" }}>
          <p style={{ margin: "0 0 20px 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            To fetch your specific class schedules, please log in with your GrapeSEED portal credentials.
          </p>

          {error && (
            <div style={{ padding: "10px", marginBottom: "16px", background: "#fef2f2", color: "#ef4444", borderRadius: 6, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#334155", marginBottom: 6 }}>Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14 }}
              placeholder="trainer@grapeseed.com"
            />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#334155", marginBottom: 6 }}>Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button type="button" onClick={onClose} disabled={isLoading} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#475569", cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={isLoading} style={{ padding: "8px 16px", background: "#2563eb", border: "none", borderRadius: 6, color: "#fff", fontWeight: 500, cursor: isLoading ? "wait" : "pointer", opacity: isLoading ? 0.7 : 1 }}>
              {isLoading ? "Connecting..." : "Log In"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};