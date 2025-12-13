// src/components/EmailComposeModal.tsx
import React, { useState, useRef, useEffect } from "react";
import { sendGraphEmail } from "../msal/graphEmail";

export type EmailMode = "simple" | "sandwich";

interface EmailComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  mode: EmailMode;
  
  initialTo: string[];
  initialCc?: string[]; // <--- NEW PROP
  initialSubject: string;
  initialBodyHtml?: string;
  sandwichData?: { intro: string; tableHtml: string; outro: string };
}

export const EmailComposeModal: React.FC<EmailComposeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  mode,
  initialTo,
  initialCc = [], // Default to empty
  initialSubject,
  initialBodyHtml,
  sandwichData
}) => {
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState(""); // <--- NEW STATE
  const [subject, setSubject] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");

  const simpleEditorRef = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState("");
  const [outro, setOutro] = useState("");

  useEffect(() => {
    if (isOpen) {
      setToInput(initialTo.join(", "));
      setCcInput(initialCc.join(", ")); // <--- Initialize CC
      setSubject(initialSubject);
      setActiveTab("edit");

      if (mode === "simple") {
        setTimeout(() => {
          if (simpleEditorRef.current) {
            simpleEditorRef.current.innerHTML = initialBodyHtml || "";
          }
        }, 0);
      } else if (mode === "sandwich" && sandwichData) {
        setIntro(sandwichData.intro);
        setOutro(sandwichData.outro);
      }
    }
  }, [isOpen, initialTo, initialCc, initialSubject, initialBodyHtml, mode, sandwichData]);

  if (!isOpen) return null;

  const getFinalHtml = () => {
    if (mode === "simple") {
      return simpleEditorRef.current?.innerHTML || "";
    } else {
      const formatText = (text: string) => 
        text.split('\n').map(line => `<p style="margin:0 0 8px 0;">${line}</p>`).join("");
      
      return `
        <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937;">
          ${formatText(intro)}
          ${sandwichData?.tableHtml || ""}
          ${formatText(outro)}
        </div>
      `;
    }
  };

  const handleSend = async () => {
    const recipients = toInput.split(",").map((s) => s.trim()).filter(Boolean);
    const ccRecipients = ccInput.split(",").map((s) => s.trim()).filter(Boolean); // <--- Parse CC

    if (recipients.length === 0) {
      alert("Please enter at least one email address in the 'To' field.");
      return;
    }

    setIsSending(true);
    try {
      // ✅ Pass CC to the updated API function
      await sendGraphEmail(recipients, ccRecipients, subject, getFinalHtml());
      alert("✅ Email sent successfully!");
      if (onSuccess) onSuccess();
      onClose();
    } catch (error: any) {
      console.error("Send failed", error);
      alert(`❌ Failed to send: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="obs-action-modal-backdrop" style={{ zIndex: 9999, backdropFilter: "blur(2px)", backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="obs-action-modal" style={{ width: 800, maxWidth: "95vw", height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
        
        {/* HEADER */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff" }}>
          <div>
             <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#111827" }}>
               {mode === "simple" ? "Compose Message" : "Monthly Summary Report"}
             </h2>
             <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Sending via Outlook (Me)</p>
          </div>
          <button onClick={onClose} disabled={isSending} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>

        {/* METADATA BAR (To / CC / Subject) */}
        <div style={{ background: "#f9fafb", padding: "12px 24px", borderBottom: "1px solid #e5e7eb", display: "grid", gap: 12 }}>
          
          {/* TO Row */}
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", alignItems: "center" }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>To:</label>
            <input 
              className="input" 
              value={toInput} 
              onChange={(e) => setToInput(e.target.value)} 
              style={{ width: "100%", padding: "6px 10px", fontSize: 14 }}
              placeholder="recipient@example.com"
            />
          </div>

          {/* ✅ CC Row (NEW) */}
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", alignItems: "center" }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>Cc:</label>
            <input 
              className="input" 
              value={ccInput} 
              onChange={(e) => setCcInput(e.target.value)} 
              style={{ width: "100%", padding: "6px 10px", fontSize: 14 }}
              placeholder="manager@example.com, admin@school.com"
            />
          </div>

          {/* SUBJECT Row */}
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", alignItems: "center" }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>Subject:</label>
            <input 
              className="input" 
              value={subject} 
              onChange={(e) => setSubject(e.target.value)} 
              style={{ width: "100%", padding: "6px 10px", fontWeight: 500 }}
            />
          </div>
        </div>

        {/* ... (Rest of component remains the same: MAIN CONTENT AREA, TABS, PREVIEW, FOOTER) ... */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff", overflow: "hidden" }}>
           <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", padding: "0 24px" }}>
             <button onClick={() => setActiveTab("edit")} style={{ padding: "12px 0", marginRight: 20, background: "none", border: "none", borderBottom: activeTab === "edit" ? "2px solid #2563eb" : "2px solid transparent", color: activeTab === "edit" ? "#2563eb" : "#6b7280", fontWeight: 500, cursor: "pointer" }}>Write</button>
             <button onClick={() => setActiveTab("preview")} style={{ padding: "12px 0", background: "none", border: "none", borderBottom: activeTab === "preview" ? "2px solid #2563eb" : "2px solid transparent", color: activeTab === "preview" ? "#2563eb" : "#6b7280", fontWeight: 500, cursor: "pointer" }}>Preview</button>
           </div>
           <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: activeTab === "preview" ? "#f3f4f6" : "#fff" }}>
             {activeTab === "preview" ? (
               <div style={{ background: "white", padding: 30, borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", maxWidth: 700, margin: "0 auto", border: "1px solid #e5e7eb" }}>
                 <div dangerouslySetInnerHTML={{ __html: getFinalHtml() }} />
               </div>
             ) : (
               <>
                 {mode === "simple" ? (
                    <div ref={simpleEditorRef} contentEditable style={{ outline: "none", minHeight: "300px", fontSize: 14, lineHeight: 1.6 }} />
                 ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>OPENING MESSAGE</label>
                        <textarea className="input" rows={4} value={intro} onChange={e => setIntro(e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 6, border: "1px solid #d1d5db" }} />
                      </div>
                      <div>
                         <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>REPORT TABLE (READ-ONLY)</label>
                         <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden", background: "#f9fafb", padding: 4 }} dangerouslySetInnerHTML={{ __html: sandwichData?.tableHtml || "" }} />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>CLOSING MESSAGE</label>
                        <textarea className="input" rows={4} value={outro} onChange={e => setOutro(e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 6, border: "1px solid #d1d5db" }} />
                      </div>
                    </div>
                 )}
               </>
             )}
           </div>
        </div>
        <div style={{ padding: "16px 24px", background: "#f9fafb", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button className="btn" onClick={onClose} disabled={isSending} style={{ background: "#fff", border: "1px solid #d1d5db" }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSend} disabled={isSending} style={{ backgroundColor: "#2563eb", color: "white", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, opacity: isSending ? 0.7 : 1 }}>
            {isSending ? <span>Sending...</span> : <><span>Send Email</span> <span>→</span></>}
          </button>
        </div>
      </div>
    </div>
  );
};