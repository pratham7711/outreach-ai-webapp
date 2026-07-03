"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button, Skeleton, Textarea, Badge, Tag } from "@pratham7711/ui";
import { toast } from "sonner";
import { Save } from "lucide-react";

const PLATFORMS = [
  { value: "TIKTOK", label: "TikTok" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "TWITTER", label: "Twitter" },
];

const NICHES = [
  "MUSIC", "FASHION", "TECH", "FITNESS", "BEAUTY", "FOOD",
  "TRAVEL", "GAMING", "COMEDY", "EDUCATION", "LIFESTYLE", "SPORTS",
];

type Connection = {
  id: string;
  platform: string;
  handle: string;
  tokenExpiry: string | null;
  connected: boolean;
  encrypted: boolean;
};

type ProviderFlags = { instagram: boolean; tiktok: boolean; youtube: boolean };

const CONNECT_PLATFORMS: { key: keyof ProviderFlags; enumValue: string; label: string }[] = [
  { key: "instagram", enumValue: "INSTAGRAM", label: "Instagram" },
  { key: "tiktok", enumValue: "TIKTOK", label: "TikTok" },
  { key: "youtube", enumValue: "YOUTUBE", label: "YouTube" },
];

type Profile = {
  name: string;
  handle: string;
  bio: string | null;
  platform: string | null;
  niches: string[];
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIFSC: string | null;
  bankSwift: string | null;
  bankRoutingNumber: string | null;
};

export default function PortalSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Profile>({
    name: "",
    handle: "",
    bio: null,
    platform: null,
    niches: [],
    bankAccountName: null,
    bankAccountNumber: null,
    bankIFSC: null,
    bankSwift: null,
    bankRoutingNumber: null,
  });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<ProviderFlags | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionsError(false);
    try {
      const res = await fetch("/api/portal/connections");
      if (res.status === 401) {
        router.push("/portal/login");
        return;
      }
      if (!res.ok) throw new Error("Failed to load connections");
      const data = await res.json();
      setConnections(data.accounts ?? []);
      setProviders(data.providers ?? null);
    } catch {
      setConnectionsError(true);
    } finally {
      setConnectionsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("error");
    if (connected) toast.success(`${connected.charAt(0).toUpperCase()}${connected.slice(1)} connected`);
    if (failed) toast.error(`Failed to connect ${failed}`);
    if (connected || failed) window.history.replaceState(null, "", "/portal/settings");
  }, []);

  const handleDisconnect = async (id: string) => {
    setDisconnectingId(id);
    try {
      const res = await fetch(`/api/portal/connections?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Account disconnected");
        await loadConnections();
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Failed to disconnect");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDisconnectingId(null);
    }
  };

  useEffect(() => {
    fetch("/api/portal/me")
      .then((r) => {
        if (r.status === 401) { router.push("/portal/login"); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setForm({
            name: data.name ?? "",
            handle: data.handle ?? "",
            bio: data.bio ?? null,
            platform: data.platform ?? null,
            niches: data.niches ?? [],
            bankAccountName: data.bankAccountName ?? null,
            bankAccountNumber: data.bankAccountNumber ?? null,
            bankIFSC: data.bankIFSC ?? null,
            bankSwift: data.bankSwift ?? null,
            bankRoutingNumber: data.bankRoutingNumber ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const set = (patch: Partial<Profile>) => setForm((f) => ({ ...f, ...patch }));

  const toggleNiche = (niche: string) => {
    setForm((f) => ({
      ...f,
      niches: f.niches.includes(niche)
        ? f.niches.filter((n) => n !== niche)
        : [...f.niches, niche],
    }));
  };

  const maskAccount = (val: string | null) => {
    if (!val || val.length < 4) return val ?? "";
    return "*".repeat(val.length - 4) + val.slice(-4);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/portal/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success("Profile updated");
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
        <Skeleton width="200px" height="32px" />
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="160px" borderRadius="12px" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Settings
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Manage your profile and payment details
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <Card variant="outlined" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 20 }}>
            Profile
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Your name"
            />
            <Input
              label="Handle"
              value={form.handle}
              onChange={(e) => set({ handle: e.target.value })}
              placeholder="yourhandle"
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <Textarea
              label="Bio"
              value={form.bio ?? ""}
              onChange={(e) => set({ bio: e.target.value || null })}
              placeholder="Tell brands about yourself..."
              rows={3}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
              Primary Platform
            </label>
            <select
              value={form.platform ?? ""}
              onChange={(e) => set({ platform: e.target.value || null })}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--cc-border)",
                background: "var(--cc-card)",
                color: "var(--cc-text)",
                fontSize: 14,
                outline: "none",
              }}
            >
              <option value="">Select platform</option>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </Card>

        <Card variant="outlined" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
            Connected Accounts
          </h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 16 }}>
            Link your social accounts so brands can verify your reach
          </p>
          {connectionsLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} width="100%" height="56px" borderRadius="10px" />
              ))}
            </div>
          ) : connectionsError ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                Failed to load connected accounts
              </p>
              <Button variant="ghost" size="sm" onClick={loadConnections}>
                Retry
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {CONNECT_PLATFORMS.map(({ key, enumValue, label }) => {
                const account = connections.find((c) => c.platform === enumValue);
                const configured = providers?.[key] ?? false;
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 16px",
                      border: "1px solid var(--cc-border)",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", minWidth: 80 }}>
                        {label}
                      </span>
                      {account ? (
                        <>
                          <Badge variant="success" size="sm">Connected</Badge>
                          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                            {account.handle}
                          </span>
                          {!configured && (
                            <Tag variant="warning" outlined>Dev mode</Tag>
                          )}
                        </>
                      ) : (
                        <Badge variant="neutral" size="sm">Not connected</Badge>
                      )}
                    </div>
                    {account ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={disconnectingId === account.id}
                        onClick={() => handleDisconnect(account.id)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          window.location.href = `/api/portal/connections/${key}/start`;
                        }}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card variant="outlined" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
            Niches
          </h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 16 }}>
            Select the categories that best describe your content
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {NICHES.map((niche) => {
              const selected = form.niches.includes(niche);
              return (
                <button
                  key={niche}
                  onClick={() => toggleNiche(niche)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: selected
                      ? "1.5px solid var(--cc-primary)"
                      : "1.5px solid var(--cc-border)",
                    background: selected ? "rgba(91, 91, 214, 0.08)" : "var(--cc-card)",
                    color: selected ? "var(--cc-primary)" : "var(--cc-text-muted)",
                    transition: "all 0.15s",
                  }}
                >
                  {niche.charAt(0) + niche.slice(1).toLowerCase()}
                </button>
              );
            })}
          </div>
        </Card>

        <Card variant="outlined" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 20 }}>
            Bank Details
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Input
              label="Account Name"
              value={form.bankAccountName ?? ""}
              onChange={(e) => set({ bankAccountName: e.target.value || null })}
              placeholder="Name on account"
            />
            <Input
              label="Account Number"
              value={form.bankAccountNumber ?? ""}
              onChange={(e) => set({ bankAccountNumber: e.target.value || null })}
              placeholder={
                form.bankAccountNumber
                  ? maskAccount(form.bankAccountNumber)
                  : "Account number"
              }
            />
            <Input
              label="IFSC Code"
              value={form.bankIFSC ?? ""}
              onChange={(e) => set({ bankIFSC: e.target.value || null })}
              placeholder="IFSC code"
            />
            <Input
              label="SWIFT Code"
              value={form.bankSwift ?? ""}
              onChange={(e) => set({ bankSwift: e.target.value || null })}
              placeholder="SWIFT/BIC code"
            />
            <Input
              label="Routing Number"
              value={form.bankRoutingNumber ?? ""}
              onChange={(e) => set({ bankRoutingNumber: e.target.value || null })}
              placeholder="Routing number"
            />
          </div>
        </Card>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Save size={14} /> Save Changes
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
