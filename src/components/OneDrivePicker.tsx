// src/components/OneDrivePicker.tsx
import React, { useEffect, useState } from "react";
import { getGraphAccessToken } from "../msal/getGraphToken";
type PickerMode = "file" | "folder";
interface DriveItem {
  id: string;
  name: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  parentReference?: { driveId: string };
}
interface OneDrivePickerProps {
  mode: PickerMode;
  title?: string;
  onSelect: (item: { name: string; driveId: string; itemId: string }) => void;
  onCancel: () => void;
  // new optional props
  initialDriveId?: string;
  initialFolderId?: string;
  initialFolderName?: string;
}
export const OneDrivePicker: React.FC<OneDrivePickerProps> = ({
  mode,
  title,
  onSelect,
  onCancel,
  initialDriveId,
  initialFolderId,
  initialFolderName,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  // Navigation State – start from the initial folder if provided
  const [driveId, setDriveId] = useState<string | null>(initialDriveId || null);
  const [folderId, setFolderId] = useState<string>(initialFolderId || "root");
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>(
    initialFolderId
      ? [{ id: initialFolderId, name: initialFolderName || "Folder" }]
      : [{ id: "root", name: "OneDrive" }]
  );
  // 1. Init Token
  useEffect(() => {
    let isMounted = true;
    getGraphAccessToken()
      .then((accessToken) => {
        if (isMounted) {
          setToken(accessToken);
          setError(null);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        if (err.message?.includes("interaction_in_progress")) {
          console.warn("Ignored MSAL interaction race condition.");
          return;
        }
        setError("Could not sign in to Microsoft: " + err.message);
      });
    return () => { isMounted = false; };
  }, []);
  // 2. Fetch Items when Folder changes
  useEffect(() => {
    if (!token) return;
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;
    setLoading(true);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load folder");
        return res.json();
      })
      .then((data) => {
        setItems(data.value || []);
        // Resolve driveId from first item if not already known
        if (!driveId && data.value && data.value.length > 0) {
          setDriveId(data.value[0].parentReference.driveId);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [token, folderId, driveId]);
  const handleNavigate = (newFolderId: string, newName: string) => {
    setFolderId(newFolderId);
    setBreadcrumbs((prev) => [...prev, { id: newFolderId, name: newName }]);
  };
  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumbs[index];
    setFolderId(target.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };
  const handleSelection = (item: DriveItem) => {
    const dId = item.parentReference?.driveId || driveId;
    if (!dId) {
      alert("Error: Could not determine Drive ID");
      return;
    }
    onSelect({ name: item.name, driveId: dId, itemId: item.id });
  };
  const handleSelectCurrentFolder = () => {
    const current = breadcrumbs[breadcrumbs.length - 1];
    if (!driveId) {
      alert("Wait for items to load first.");
      return;
    }
    onSelect({ name: current.name, driveId, itemId: folderId });
  };
  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ height: "80vh", display: "flex", flexDirection: "column" }}>
        {/* HEADER */}
        <div className="modal-header">
          <div className="modal-title">{title || "Select from OneDrive"}</div>
          <button onClick={onCancel} className="btn">×</button>
        </div>
        {/* BREADCRUMBS */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #eee", background: "#f9fafb", fontSize: "14px" }}>
          {breadcrumbs.map((b, i) => (
            <span key={b.id}>
              {i > 0 && " / "}
              <span
                style={{
                  cursor: "pointer",
                  color: i === breadcrumbs.length - 1 ? "black" : "#2563eb",
                  fontWeight: i === breadcrumbs.length - 1 ? "600" : "400"
                }}
                onClick={() => handleBreadcrumbClick(i)}
              >
                {b.name}
              </span>
            </span>
          ))}
        </div>
        {/* SEARCH */}
        <div style={{ padding: "10px 20px 0 20px" }}>
          <input
            type="text"
            placeholder="Search files & folders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
              fontSize: "14px",
            }}
          />
        </div>
        {/* LIST */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px" }}>
          {loading && <div style={{ padding: 20, textAlign: "center", color: "#666" }}>Loading files...</div>}
          {error && items.length === 0 && <div style={{ color: "red", padding: 20 }}>{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", fontStyle: "italic", color: "#999" }}>Empty folder</div>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items
              .filter(item => {
                if (!searchTerm.trim()) return true;
                const term = searchTerm.toLowerCase();
                return item.name.toLowerCase().includes(term);
              })
              .map((item) => {
                const isFolder = !!item.folder;
                const isDimmed = mode === "folder" && !isFolder;
                return (
                  <li
                    key={item.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "10px", padding: "12px 8px",
                      borderBottom: "1px solid #f0f0f0",
                      cursor: isDimmed ? "default" : "pointer",
                      opacity: isDimmed ? 0.5 : 1
                    }}
                    onClick={() => {
                      if (isFolder) {
                        handleNavigate(item.id, item.name);
                      } else if (mode === "file") {
                        handleSelection(item);
                      }
                    }}
                  >
                    <span style={{ fontSize: "20px" }}>{isFolder ? "📁" : "📄"}</span>
                    <span style={{ flex: 1, fontWeight: isFolder ? 600 : 400 }}>{item.name}</span>
                    {mode === "file" && !isFolder && (
                      <button className="btn btn-sm btn-ghost" style={{ fontSize: '12px' }}>Select</button>
                    )}
                    {isFolder && <span style={{ color: "#ccc" }}>›</span>}
                  </li>
                );
              })}
          </ul>
          {!loading && !error && items.length > 0 && searchTerm.trim() &&
            items.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
              <div style={{ padding: 20, textAlign: "center", fontStyle: "italic", color: "#999" }}>
                No files or folders match your search.
              </div>
            )}
        </div>
        {/* FOOTER */}
        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>
            {mode === "folder" ? "Navigate to the destination folder and click select." : "Choose a file."}
          </div>
          <div>
            <button onClick={onCancel} className="btn" style={{ marginRight: 10 }}>Cancel</button>
            {mode === "folder" && (
              <button
                className="btn btn-primary"
                onClick={handleSelectCurrentFolder}
                disabled={loading}
              >
                Select Current Folder "{breadcrumbs[breadcrumbs.length - 1].name}"
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};