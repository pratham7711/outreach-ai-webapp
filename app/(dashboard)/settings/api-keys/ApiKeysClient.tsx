"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle } from "lucide-react";

interface ApiKeyItem {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeysClient() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setNewName("");
        fetchKeys();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await fetch(`/api/keys/${id}`, { method: "DELETE" });
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div className="rsp-page page-enter" style={{ paddingBottom: 64 }}>
      {/* Page Header */}
      <div className="rsp-header">
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "var(--cc-text)",
              marginBottom: 4,
            }}
          >
            API Keys
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Manage API access to your organization
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setCreatedKey(null);
            setCopied(false);
          }}
          style={{
            background: "var(--cc-primary)",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Plus size={16} />
          Create API Key
        </button>
      </div>

      {/* Created Key Banner */}
      {createdKey && (
        <div
          style={{
            marginBottom: 24,
            background: "color-mix(in srgb, var(--cc-warning) 14%, transparent)",
            border: "1px solid color-mix(in srgb, var(--cc-warning) 35%, transparent)",
            borderRadius: 12,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <AlertTriangle size={16} style={{ color: "var(--cc-warning)" }} />
            <span
              style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-warning)" }}
            >
              Save this key — it won&apos;t be shown again
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <code
              style={{
                flex: 1,
                fontSize: 13,
                fontFamily: "monospace",
                color: "var(--cc-text)",
                wordBreak: "break-all",
              }}
            >
              {createdKey}
            </code>
            <button
              onClick={() => handleCopy(createdKey)}
              style={{
                background: "none",
                border: "1px solid var(--cc-border)",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "var(--cc-text-muted)",
              }}
            >
              {copied ? (
                <>
                  <Check size={14} style={{ color: "var(--cc-success)" }} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && !createdKey && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setShowCreate(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--cc-card)",
              borderRadius: 16,
              padding: 24,
              width: 420,
              maxWidth: "90vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            }}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--cc-text)",
                marginBottom: 16,
              }}
            >
              Create API Key
            </h2>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cc-text)",
                marginBottom: 6,
                display: "block",
              }}
            >
              Key Name
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Production Backend"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--cc-border)",
                outline: "none",
                color: "var(--cc-text)",
                background: "var(--cc-card)",
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 20,
              }}
            >
              <button
                onClick={() => setShowCreate(false)}
                style={{
                  padding: "9px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  color: "var(--cc-text)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                style={{
                  padding: "9px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "none",
                  background: newName.trim()
                    ? "var(--cc-primary)"
                    : "var(--cc-border)",
                  color: "white",
                  cursor: newName.trim() ? "pointer" : "not-allowed",
                  opacity: creating ? 0.6 : 1,
                }}
              >
                {creating ? "Creating..." : "Create Key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Revoke Modal */}
      {confirmRevoke && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setConfirmRevoke(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--cc-card)",
              borderRadius: 16,
              padding: 24,
              width: 400,
              maxWidth: "90vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            }}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--cc-text)",
                marginBottom: 8,
              }}
            >
              Revoke API Key?
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--cc-text-muted)",
                marginBottom: 20,
              }}
            >
              This action cannot be undone. Any systems using this key will
              lose access immediately.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                onClick={() => setConfirmRevoke(null)}
                style={{
                  padding: "9px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  color: "var(--cc-text)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevoke(confirmRevoke)}
                disabled={revoking === confirmRevoke}
                style={{
                  padding: "9px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "none",
                  background: "#DC2626",
                  color: "white",
                  cursor: "pointer",
                  opacity: revoking === confirmRevoke ? 0.6 : 1,
                }}
              >
                {revoking === confirmRevoke ? "Revoking..." : "Revoke Key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Usage Instructions */}
      <div
        style={{
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          How to use your API key
        </h2>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 16 }}>
          Pass the key in the <code style={{ fontFamily: "monospace", background: "var(--cc-bg)", padding: "1px 5px", borderRadius: 4 }}>Authorization</code> header of any API request.
        </p>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
            REST / cURL
          </p>
          <div style={{ background: "#1C2048", borderRadius: 8, padding: "12px 16px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "#A5B4FC", whiteSpace: "pre" }}>
              {`curl -H "Authorization: Bearer oai_YOUR_KEY_HERE" \\
  https://your-domain.com/api/campaigns`}
            </code>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
            MCP Server config
          </p>
          <div style={{ background: "#1C2048", borderRadius: 8, padding: "12px 16px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "#A5B4FC", whiteSpace: "pre" }}>
              {`{
  "headers": {
    "Authorization": "Bearer oai_YOUR_KEY_HERE"
  }
}`}
            </code>
          </div>
        </div>
        <div
          style={{
            background: "var(--cc-primary-light)",
            border: "1px solid var(--cc-primary-medium)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--cc-primary)",
          }}
        >
          For Discord bots, use this key in your bot&apos;s HTTP client when calling campaign, creator, or payout endpoints.
        </div>
      </div>

      {/* Keys Table */}
      <div
        style={{
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
              Loading...
            </p>
          </div>
        ) : keys.length === 0 ? (
          <div
            style={{
              padding: "60px 40px",
              textAlign: "center",
            }}
          >
            <Key
              size={40}
              style={{
                color: "var(--cc-text-subtle)",
                marginBottom: 12,
              }}
            />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--cc-text)",
                marginBottom: 4,
              }}
            >
              No API keys yet
            </h3>
            <p
              style={{
                fontSize: 14,
                color: "var(--cc-text-muted)",
                marginBottom: 16,
              }}
            >
              Create an API key to access your organization programmatically.
            </p>
            <button
              onClick={() => {
                setShowCreate(true);
                setCreatedKey(null);
              }}
              style={{
                background: "var(--cc-primary)",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "9px 16px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Create your first key
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--cc-border)",
                }}
              >
                {["Name", "Created", "Last Used", "Actions"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--cc-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  style={{
                    borderBottom: "1px solid var(--cc-border)",
                  }}
                >
                  <td
                    style={{
                      padding: "14px 16px",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--cc-text)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Key
                        size={15}
                        style={{ color: "var(--cc-text-muted)" }}
                      />
                      {k.name}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      fontSize: 13,
                      color: "var(--cc-text-muted)",
                    }}
                  >
                    {formatDate(k.createdAt)}
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      fontSize: 13,
                      color: "var(--cc-text-muted)",
                    }}
                  >
                    {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <button
                      onClick={() => setConfirmRevoke(k.id)}
                      style={{
                        background: "none",
                        border: "1px solid color-mix(in srgb, var(--cc-danger) 30%, transparent)",
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--cc-danger)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Trash2 size={13} />
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
