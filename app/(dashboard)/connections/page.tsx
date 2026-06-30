"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Card, Badge, Modal, Input, Skeleton } from "@pratham7711/ui";

type PlatformConnection = {
  platform: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  connected: boolean;
  connectedAt: string | null;
  accountName: string | null;
};

export default function ConnectionsPage() {
  const [platforms, setPlatforms] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectModal, setConnectModal] = useState<PlatformConnection | null>(null);
  const [disconnectModal, setDisconnectModal] = useState<PlatformConnection | null>(null);
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (res.ok) {
        const data = await res.json();
        setPlatforms(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlatforms();
  }, [fetchPlatforms]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleConnect = async () => {
    if (!connectModal) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: connectModal.platform, accountName: accountName || undefined }),
      });
      if (res.ok) {
        setToast(`${connectModal.name} connected successfully`);
        setConnectModal(null);
        setAccountName("");
        await fetchPlatforms();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectModal) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/connections?platform=${disconnectModal.platform}`, { method: "DELETE" });
      if (res.ok) {
        setToast(`${disconnectModal.name} disconnected`);
        setDisconnectModal(null);
        await fetchPlatforms();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const socialPlatforms = platforms.filter(p => p.category === "social");
  const messagingPlatforms = platforms.filter(p => p.category === "messaging");
  const paymentPlatforms = platforms.filter(p => p.category === "payment");
  const connectedCount = platforms.filter(p => p.connected).length;

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (loading) {
    return (
      <div className="cc-page-content">
        <div style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 8 }}><Skeleton width={200} height={28} /></div>
          <Skeleton width={320} height={16} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={180} borderRadius={12} />
          ))}
        </div>
      </div>
    );
  }

  const renderPlatformCard = (p: PlatformConnection) => (
    <Card key={p.platform} variant="outlined" style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, background: "var(--cc-bg)",
        }}>
          {p.icon}
        </div>
        {p.connected && (
          <Badge variant="success" size="sm" dot>Connected</Badge>
        )}
      </div>
      <h3 style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)", marginBottom: 4 }}>{p.name}</h3>
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.5, marginBottom: 12 }}>{p.description}</p>
      {p.connected && (
        <div style={{ marginBottom: 12 }}>
          {p.accountName && (
            <p style={{ fontSize: 13, color: "var(--cc-text)", marginBottom: 2 }}>
              <span style={{ color: "var(--cc-text-muted)" }}>Account:</span> {p.accountName}
            </p>
          )}
          {p.connectedAt && (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              Connected: {formatDate(p.connectedAt)}
            </p>
          )}
        </div>
      )}
      {p.connected ? (
        <Button variant="ghost" fullWidth onClick={() => setDisconnectModal(p)}>Disconnect</Button>
      ) : (
        <Button variant="primary" fullWidth onClick={() => { setConnectModal(p); setAccountName(""); }}>Connect</Button>
      )}
    </Card>
  );

  return (
    <div className="cc-page-content">
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 24, right: 24, zIndex: 9999,
          background: "var(--cc-text)", color: "white",
          padding: "12px 20px", borderRadius: 8, fontSize: 14, fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Connections</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Connect your platforms and payment providers
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Badge variant="neutral" size="sm">{connectedCount} connected</Badge>
          <Badge variant="neutral" size="sm">{platforms.length - connectedCount} available</Badge>
        </div>
      </div>

      {/* Social Platforms */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--cc-text)", marginBottom: 16 }}>Social Platforms</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {socialPlatforms.map(renderPlatformCard)}
        </div>
      </div>

      {/* Messaging Channels */}
      {messagingPlatforms.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>Messaging Channels</h2>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
              Connect messaging apps to notify creators and run automated campaign flows.
              Discord can be connected using an{" "}
              <a href="/settings/api-keys" style={{ color: "var(--cc-primary)", textDecoration: "underline" }}>API key</a>.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {messagingPlatforms.map(renderPlatformCard)}
          </div>
        </div>
      )}

      {/* Payment Providers */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--cc-text)", marginBottom: 16 }}>Payment Providers</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {paymentPlatforms.map(renderPlatformCard)}
        </div>
      </div>

      {/* Connect Modal */}
      {connectModal && (
        <Modal
          open={true}
          onClose={() => setConnectModal(null)}
          title={`Connect ${connectModal.name}`}
        >
          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 16 }}>
              Enter your account name or identifier for {connectModal.name}.
            </p>
            <Input
              placeholder="Account name (e.g. @brandaccount)"
              value={accountName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccountName(e.target.value)}
              style={{ marginBottom: 16, width: "100%" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setConnectModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleConnect} disabled={submitting}>
                {submitting ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Disconnect Confirmation Modal */}
      {disconnectModal && (
        <Modal
          open={true}
          onClose={() => setDisconnectModal(null)}
          title={`Disconnect ${disconnectModal.name}?`}
        >
          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 16 }}>
              Are you sure you want to disconnect {disconnectModal.name}? You can reconnect it later.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setDisconnectModal(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleDisconnect}
                disabled={submitting}
                style={{ background: "#DC2626", borderColor: "#DC2626" }}
              >
                {submitting ? "Disconnecting..." : "Disconnect"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
