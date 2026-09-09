"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Skeleton, Textarea, Badge, Tag } from "@pratham7711/ui";
import { toast } from "sonner";
import { Save } from "lucide-react";
import type { PlatformCapability } from "@/lib/capabilities";
import {
  OAUTH_PLATFORMS,
  toPlatformEnum,
  type OAuthPlatform,
} from "@/lib/oauth/providers";
import { Dropdown, Button } from "@/components/ds";

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
  avatarUrl: string | null;
  profileUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  mediaCount: number | null;
};

type ProviderFlags = Partial<Record<OAuthPlatform, boolean>>;

const PLATFORM_LABELS: Record<OAuthPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  threads: "Threads",
};

/* Derived from OAUTH_PLATFORMS, so a provider added to the code shows up here
   instead of having to be remembered in a second hand-written list. Declared
   after PLATFORM_LABELS on purpose: this evaluates at module load and a const
   read before its initialiser throws. */
const CONNECT_PLATFORMS: { key: OAuthPlatform; enumValue: string; label: string }[] =
  OAUTH_PLATFORMS.map((key) => ({
    key,
    enumValue: toPlatformEnum(key),
    label: PLATFORM_LABELS[key],
  }));

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
  const [capabilities, setCapabilities] = useState<PlatformCapability[]>([]);
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
      setCapabilities(data.capabilities ?? []);
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
    /* The callback names which step failed (state, token_exchange, identity…);
       showing it turns "Failed to connect facebook" into something a reader
       can act on without opening the server log. */
    const reason = params.get("reason");
    if (connected) toast.success(`${connected.charAt(0).toUpperCase()}${connected.slice(1)} connected`);
    if (failed && reason === "creator")
      toast.error(
        `Couldn't connect ${failed}: no brand has added you to a campaign yet. Join a campaign from Discover, then connect.`,
      );
    else if (failed)
      toast.error(
        reason
          ? `Failed to connect ${failed} (${reason.replace(/_/g, " ")})`
          : `Failed to connect ${failed}`,
      );
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
      <div className="rsp-page" style={{ maxWidth: 720 }}>
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
    <div className="rsp-page" style={{ maxWidth: 720 }}>
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
          <div className="rsp-grid-2">
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
            <Dropdown
              ariaLabel="Primary Platform"
              align="left"
              fullWidth
              value={form.platform ?? ""}
              onChange={(v) => set({ platform: v || null })}
              options={[
                { value: "", label: "Select platform" },
                ...PLATFORMS.map((p) => ({ value: p.value, label: p.label })),
              ]}
            />
          </div>
        </Card>

        <Card variant="outlined" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
            Connected Accounts
          </h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 12 }}>
            Link your accounts and your posts report themselves — no screenshots, no pasting
            links, and brands can verify your reach.
          </p>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--cc-bg)",
              fontSize: 12,
              lineHeight: 1.7,
              color: "var(--cc-text-muted)",
              marginBottom: 16,
            }}
          >
            <strong style={{ color: "var(--cc-text)" }}>What we read:</strong> your public
            profile, follower count, and the view, like, comment and share counts on your public
            posts.
            <br />
            <strong style={{ color: "var(--cc-text)" }}>What we never touch:</strong> direct
            messages, private or unpublished videos, and we never post, edit or delete anything.
            <br />
            <strong style={{ color: "var(--cc-text)" }}>Revoke anytime</strong> with Disconnect
            below — we delete the stored tokens immediately.
          </div>
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
                /* Every account on this platform, not just the first. A creator
                   can link several — a personal and a brand handle — and this
                   used to `.find()` one, so the second one they authorised was
                   invisible even once it was stored. */
                const accounts = connections.filter((c) => c.platform === enumValue);
                const configured = providers?.[key] ?? false;
                const capability = capabilities.find((c) => c.platform === key);
                const connectStatus = capability?.connect ?? "gated";
                const comingSoon = connectStatus === "coming_soon";
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: "12px 16px",
                      border: "1px solid var(--cc-border)",
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", minWidth: 80 }}>
                          {label}
                        </span>
                        {accounts.length > 0 ? (
                          <>
                            <Badge variant="success" size="sm">
                              {accounts.length === 1
                                ? "Connected"
                                : `${accounts.length} accounts`}
                            </Badge>
                            {!configured && <Tag variant="warning" outlined>Dev mode</Tag>}
                          </>
                        ) : comingSoon ? (
                          <>
                            <Badge variant="neutral" size="sm">Coming soon</Badge>
                            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                              {capability?.connectNote}
                            </span>
                          </>
                        ) : (
                          <Badge variant="neutral" size="sm">Not connected</Badge>
                        )}
                      </div>
                      {!comingSoon && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            window.location.href = `/api/portal/connections/${key}/start`;
                          }}
                        >
                          {accounts.length > 0 ? `Add another ${label}` : "Connect"}
                        </Button>
                      )}
                    </div>

                    {accounts.map((account) => (
                      <div
                        key={account.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "8px 12px",
                          background: "var(--cc-bg)",
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          {account.avatarUrl && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={account.avatarUrl}
                              alt=""
                              width={24}
                              height={24}
                              style={{ borderRadius: "50%", objectFit: "cover" }}
                            />
                          )}
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                            {account.profileUrl ? (
                              <a
                                href={account.profileUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "var(--cc-text)" }}
                              >
                                {account.handle}
                              </a>
                            ) : (
                              account.handle
                            )}
                          </span>
                          {account.isVerified && <Tag variant="accent" outlined>Verified</Tag>}
                          <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                            {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
                              account.followersCount,
                            )}{" "}
                            followers
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={disconnectingId === account.id}
                          onClick={() => handleDisconnect(account.id)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ))}
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
          <div className="rsp-grid-2">
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
