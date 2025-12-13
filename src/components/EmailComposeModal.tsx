// src/components/EmailComposeModal.tsx
import React, { useState, useRef, useEffect } from "react";
import { sendGraphEmail } from "../msal/graphEmail";

export type EmailMode = "simple" | "sandwich";

interface EmailComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: EmailMode;
  
  // Common Fields
  initialTo: string[];
  initialSubject: string;
  
  // For 'simple' mode (One big editable box)
  initialBodyHtml?: string;

  // For 'sandwich' mode (AM Summary)
  sandwichData?: {
    intro: string;
    tableHtml: string;
    outro: string;
  };
}

export const EmailComposeModal: React.FC<EmailComposeModalProps> = ({
  isOpen,
  onClose,
  mode,
  initialTo,
  initialSubject,
  initialBodyHtml,
  sandwichData
}) => {
  const [toInput, setToInput] = useState("");
  const [subject, setSubject] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Simple Mode Ref
  const simpleEditorRef = useRef<HTMLDivElement>(null);

  // Sandwich Mode State
  const [intro, setIntro] = useState("");
  const [outro, setOutro] = useState("");

  useEffect(() => {
    if (isOpen) {
      setToInput(initialTo.join(", "));
      setSubject(initialSubject);

      if (mode === "simple" && simpleEditorRef.current) {
        // Wait a tick for the DOM to render the div
        setTimeout(() => {
          if (simpleEditorRef.current) {
            simpleEditorRef.current.innerHTML = initialBodyHtml || "";
          }
        }, 0);
      } 
      else if (mode === "sandwich" && sandwichData) {
        setIntro(sandwichData.intro);
        setOutro(sandwichData.outro);
      }
    }
  }, [isOpen, initialTo, initialSubject, initialBodyHtml, mode, sandwichData]);

  if (!isOpen) return null;

  const handleSend = async () => {
    // 1. Construct Final HTML
    let finalHtml = "";

    if (mode === "simple") {
      finalHtml = simpleEditorRef.current?.innerHTML || "";
    } else {
      // Sandwich assembly
      // Convert newlines to <br/> or wrap in <p> for Outlook safety
      const formatText = (text: string) => 
        text.split('\n').map(line => `<p style="margin:0 0 8px 0;">${line}</p>`).join("");

      finalHtml = `
        <div style="font-family: sans-serif; color: #1f2937;">
          ${formatText(intro)}
          ${sandwichData?.tableHtml || ""}
          ${formatText(outro)}
        </div>
      `;
    }

    // 2. Parse Recipients
    const recipients = toInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) {
      alert("Please enter at least one email address.");
      return;
    }

    setIsSending(true);
    try {
      await sendGraphEmail(recipients, subject, finalHtml);
      alert("✅ Email sent successfully via Outlook!");
      onClose();
    } catch (error: any) {
      console.error("Send failed", error);
      alert(`❌ Failed to send: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="obs-action-modal-backdrop" style={{ zIndex: 9999 }}>
      <div className="obs-action-modal" style={{ width: 750, maxWidth: "95vw" }}>
        
        <div className="obs-action-modal-header">
          <div className="obs-action-modal-title">
            {mode === "simple" ? "Review & Send Email" : "Preview Summary Report"}
          </div>
          <button className="btn" onClick={onClose} disabled={isSending}>✕</button>
        </div>

        <div className="obs-action-modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          
          {/* Header Fields */}
          <div style={{ display: "grid", gap: 10, background: "#f9fafb", padding: 10, borderRadius: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>To</label>
              <input className="input" value={toInput} onChange={(e) => setToInput(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Subject</label>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          </div>

          {/* EDITOR AREA */}
          <div style={{ flex: 1, minHeight: 300, maxHeight: "55vh", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
            
            {mode === "simple" ? (
              // SIMPLE MODE: One big editable box
              <div
                ref={simpleEditorRef}
                contentEditable
                style={{ padding: 16, outline: "none", minHeight: 300 }}
              />
            ) : (
              // SANDWICH MODE
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                
                {/* Top Bun: Intro */}
                <div>
                  <label style={{fontSize: 12, color: "#9ca3af", marginBottom: 4, display: "block"}}>Opening Message</label>
                  <textarea 
                    className="input" 
                    rows={3} 
                    value={intro} 
                    onChange={e => setIntro(e.target.value)} 
                    style={{width: "100%", fontFamily: "sans-serif"}}
                  />
                </div>

                {/* Meat: The Table (Read Only) */}
                <div>
                   <label style={{fontSize: 12, color: "#9ca3af", marginBottom: 4, display: "block"}}>Table Preview (Read-only)</label>
                   <div 
                     style={{ border: "1px dashed #d1d5db", padding: 8, background: "#fdfdfd" }}
                     dangerouslySetInnerHTML={{ __html: sandwichData?.tableHtml || "" }} 
                   />
                </div>

                {/* Bottom Bun: Outro */}
                <div>
                  <label style={{fontSize: 12, color: "#9ca3af", marginBottom: 4, display: "block"}}>Closing Message</label>
                  <textarea 
                    className="input" 
                    rows={3} 
                    value={outro} 
                    onChange={e => setOutro(e.target.value)} 
                    style={{width: "100%", fontFamily: "sans-serif"}}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="obs-action-modal-footer">
          <button className="btn" onClick={onClose} disabled={isSending}>Cancel</button>
          <button 
            className="btn btn-primary" 
            onClick={handleSend} 
            disabled={isSending}
            style={{ backgroundColor: "#2563eb", color: "white", paddingLeft: 20, paddingRight: 20 }}
          >
            {isSending ? "Sending..." : "Send via Outlook"}
          </button>
        </div>
      </div>
    </div>
  );
};