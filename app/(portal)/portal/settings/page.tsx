"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea } from "@pratham7711/ui";
import { toast } from "sonner";
import { Link2, UserRound, X } from "lucide-react";
import type { PlatformCapability } from "@/lib/capabilities";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { connectFailureText } from "@/lib/portal/connectFailureText";
import {
  OAUTH_PLATFORMS,
  toPlatformEnum,
  type OAuthPlatform,
} from "@/lib/oauth/providers";
import {
  Banner,
  Button,
  Dropdown,
  Field,
  FieldRow,
  PageHeader,
  SectionCard,
  SettingsForm,
  Skeleton,
  StatusBadge,
} from "@/components/ds";
import { useDirty } from "@/lib/useDirty";
import { instagramCardLabel } from "@/lib/oauth/instagramUnified";

const PLATFORMS = [
  { value: "TIKTOK", label: "TikTok" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "TWITTER", label: "X" },
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
  /** Which flow minted the row — see lib/platforms/accountOrigin. */
  origin: string | null;
};

type ProviderFlags = Partial<Record<OAuthPlatform, boolean>>;

const PLATFORM_LABELS: Record<OAuthPlatform, string> = {
  instagram: instagramCardLabel(),
  "instagram-login": "Instagram (Instagram login)",
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
  const [saved, setSaved] = useState<Profile | null>(null);
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

  /* The connect result, read straight out of the URL during the first render.

     This used to be a toast fired from a mount effect, and it never appeared
     once: measured 2026-09-09 on
     /portal/settings?error=instagram-login&reason=creator, the effect ran
     (console at 110ms, and it stripped the query) while
     section[aria-label^="Notifications"] stayed at zero children for six
     seconds. Delaying the emit a frame, then a full second, then moving it
     into the layout beside <Toaster /> all failed the same way, while the
     identical toast.error fired from a click rendered immediately -- so every
     connect failure the OAuth callback redirects back with was silent, and the
     creator just landed on Settings with the account still not connected and
     no reason given.

     A banner is the better vehicle regardless: this is the one message on the
     screen a creator may need to read twice, and a four-second toast is the
     worst place to put it. Rendering from state means there is no ordering to
     get wrong. */
  const [connectResult] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("error");
    if (!connected && !failed) return null;
    /* The callback names which step failed (state, token_exchange, identity…);
       lib/portal/connectFailureText.ts turns it into what to do next. */
    const reason = params.get("reason");
    const platform = connected ?? failed ?? "";
    /* PLATFORM_LABELS is how the rest of the screen names these, so
       "instagram-login" reads "Instagram (Instagram login)" and not
       "Instagram-login". An unknown slug falls back to itself. */
    const name =
      PLATFORM_LABELS[platform as OAuthPlatform] ??
      `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
    if (connected) return { tone: "success" as const, message: `${name} connected.` };
    if (reason === "creator")
      return {
        tone: "error" as const,
        message: `Couldn't connect ${name}: no brand has added you to a campaign yet. Join a campaign from Discover, then connect.`,
      };
    if (reason === "provider")
      return {
        tone: "error" as const,
        message: `${name} sign-in is not configured yet. Submit your post URL on the campaign instead and we will still track it.`,
      };
    return { tone: "error" as const, message: connectFailureText(name, reason, "us") };
  });
  const [connectResultShown, setConnectResultShown] = useState(true);

  useEffect(() => {
    /* Drop the params so a refresh or a shared URL does not replay the banner. */
    if (connectResult) window.history.replaceState(null, "", window.location.pathname);
  }, [connectResult]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

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
          const loaded: Profile = {
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
          };
          setForm(loaded);
          setSaved(loaded);
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const set = (patch: Partial<Profile>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = useDirty(saved, form);

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
        setSaved(form);
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
        <Skeleton width={200} height={32} />
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={160} radius="var(--cc-r-card)" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rsp-page" style={{ maxWidth: 720 }}>
      <PageHeader title="Settings" subtitle="Manage your profile and payment details" />

      {connectResult && connectResultShown && (
        <Banner
          tone={connectResult.tone === "success" ? "success" : "danger"}
          role="alert"
          style={{ marginBottom: 24 }}
          action={
            <button
              type="button"
              onClick={() => setConnectResultShown(false)}
              aria-label="Dismiss"
              style={{ display: "inline-flex", background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 2 }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          }
        >
          {connectResult.message}
        </Banner>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <SettingsForm
          icon={UserRound}
          title="Profile"
          description="Your profile, niches and bank details"
          dirty={dirty}
          saving={saving}
          onSubmit={handleSave}
          onCancel={() => saved && setForm(saved)}
        >
          <FieldRow>
            <Field label="Name">
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
            </Field>
            <Field label="Handle">
              <Input value={form.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="yourhandle" />
            </Field>
          </FieldRow>
          <Field label="Bio">
            <Textarea
              value={form.bio ?? ""}
              onChange={(e) => set({ bio: e.target.value || null })}
              placeholder="Tell brands about yourself"
              rows={3}
            />
          </Field>
          <Field label="Primary platform">
            <Dropdown
              align="left"
              fullWidth
              value={form.platform ?? ""}
              onChange={(v) => set({ platform: v || null })}
              options={[
                { value: "", label: "Select platform" },
                ...PLATFORMS.map((p) => ({ value: p.value, label: p.label })),
              ]}
            />
          </Field>
          <Field label="Niches" group helper="Select the categories that best describe your content">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {NICHES.map((niche) => {
                const selected = form.niches.includes(niche);
                return (
                  <button
                    key={niche}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleNiche(niche)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: selected ? "1px solid var(--cc-primary)" : "1px solid var(--cc-border)",
                      background: selected ? "var(--cc-primary-light)" : "var(--cc-card)",
                      color: selected ? "var(--cc-primary)" : "var(--cc-text-muted)",
                    }}
                  >
                    {niche.charAt(0) + niche.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </Field>
          <FieldRow>
            <Field label="Account name">
              <Input
                value={form.bankAccountName ?? ""}
                onChange={(e) => set({ bankAccountName: e.target.value || null })}
                placeholder="Name on account"
              />
            </Field>
            <Field label="Account number">
              <Input
                value={form.bankAccountNumber ?? ""}
                onChange={(e) => set({ bankAccountNumber: e.target.value || null })}
                placeholder={form.bankAccountNumber ? maskAccount(form.bankAccountNumber) : "Account number"}
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="IFSC code">
              <Input value={form.bankIFSC ?? ""} onChange={(e) => set({ bankIFSC: e.target.value || null })} placeholder="IFSC code" />
            </Field>
            <Field label="SWIFT code">
              <Input value={form.bankSwift ?? ""} onChange={(e) => set({ bankSwift: e.target.value || null })} placeholder="SWIFT/BIC code" />
            </Field>
          </FieldRow>
          <Field label="Routing number">
            <Input
              value={form.bankRoutingNumber ?? ""}
              onChange={(e) => set({ bankRoutingNumber: e.target.value || null })}
              placeholder="Routing number"
            />
          </Field>
        </SettingsForm>

        <SectionCard
          icon={Link2}
          title="Connected accounts"
          description="Link your accounts and your posts report themselves: no screenshots, no pasting links, and brands can verify your reach."
        >
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "var(--cc-r-control)",
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
                <Skeleton key={i} width="100%" height={56} radius="var(--cc-r-control)" />
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
                /* Both Instagram cards carry enumValue "INSTAGRAM", so the
                   platform alone cannot say which card an account belongs
                   under — without the origin split, one connection would be
                   listed twice and each card's Disconnect would appear to
                   govern the other's account. */
                const accounts = connections.filter(
                  (c) =>
                    c.platform === enumValue &&
                    (enumValue !== "INSTAGRAM" ||
                      isInstagramLoginRow(c.origin) === (key === "instagram-login")),
                );
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
                      borderRadius: "var(--cc-r-control)",
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
                            <StatusBadge tone="success">
                              {accounts.length === 1
                                ? "Connected"
                                : `${accounts.length} accounts`}
                            </StatusBadge>
                            {!configured && <StatusBadge tone="warning">Dev mode</StatusBadge>}
                          </>
                        ) : comingSoon ? (
                          <>
                            <StatusBadge tone="neutral">Coming soon</StatusBadge>
                            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                              {capability?.connectNote}
                            </span>
                          </>
                        ) : (
                          <>
                            <StatusBadge tone="neutral">Not connected</StatusBadge>
                            {/* A gated platform still shows a Connect button —
                                in dev it runs the synthetic connect path, which
                                is the only way to exercise the flow locally.
                                Without this note, an environment where the
                                credentials are absent offered a button whose
                                only outcome was a raw 503, with nothing on
                                screen saying why. */}
                            {connectStatus === "gated" && capability?.connectNote && (
                              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                                {capability.connectNote}
                              </span>
                            )}
                          </>
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
                          {account.isVerified && <StatusBadge tone="info">Verified</StatusBadge>}
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
        </SectionCard>
      </div>
    </div>
  );
}
