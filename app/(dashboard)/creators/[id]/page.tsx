"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import {
  Eye, Heart, MessageCircle, Share2, Play, ChevronRight, ExternalLink, DollarSign, Pencil, Plus, Trash2, Users,
  User, Video, ClipboardList, Link2, Combine,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Badge, EmptyState, Skeleton, Modal, Input, Tooltip } from "@pratham7711/ui";
import { Dropdown, MetricTile } from "@/components/ds";
import { formatDateAbs, platformLabel, formatFull, formatFullCurrency } from "@/lib/format";
import { campaignStatusLabel } from "@/lib/statusColors";
import { ACTIVATION_STATUS_LABEL } from "@/lib/activationQueues";
import { enumLabel } from "@/lib/ui/enumLabel";
import { toast } from "sonner";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import PlatformChips from "@/components/creators/PlatformChips";
import HandleFix from "@/components/creators/HandleFix";
import MergeCreatorModal from "@/components/creators/MergeCreatorModal";
import { handleProblemText, type HandleProblem } from "@/lib/creators/handleCheck";
import {
  avgViewsValue,
  creatorEngagementValue,
  followersValue,
  isUnknownMetric,
  postCounterValue,
  postEngagementValue,
} from "@/lib/creators/metricValue";
import MetricFigure from "@/components/creators/MetricFigure";
import CreatorAccess from "@/components/creators/CreatorAccess";
import { AgeLabel } from "@/components/ds/AgeLabel";
import PostStatusChip from "@/components/posts/PostStatusChip";
import { postAgeContext, postMeasuredAt, postStatus } from "@/lib/posts/postStatus";
import { dataAsOf } from "@/lib/dataAge";
import type { FigureTimeDto } from "@/lib/creators/figureTime";

function formatNumber(num: number): string {
  return formatFull(num);
}

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "var(--cc-brand-tiktok)",
  INSTAGRAM: "var(--cc-brand-instagram)",
  YOUTUBE: "var(--cc-brand-youtube)",
  TWITTER: "var(--cc-brand-twitter)",
};

const STATUS_VARIANT: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  PROCESSING: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
  AWAITING_DRAFT: "warning",
  DRAFT_SUBMITTED: "neutral",
  APPROVED: "success",
  POSTED: "success",
  COMPLETE: "success",
  DECLINED: "danger",
};

type Tab = "profile" | "posts" | "campaigns" | "social";

type SocialAccount = {
  id: string;
  platform: string;
  handle: string;
  followersCount: number;
  avgViews: number;
  tokenExpiry: string | null;
  /** When the account's own statistics were last read; null for one entered by hand. */
  statsSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type TikTokVideo = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  coverImageUrl: string | null;
  shareUrl: string | null;
  embedLink: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
};

type Post = {
  id: string;
  platform: string;
  postUrl: string;
  caption: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  engagementRate: number;
  /** Set only when we read the post ourselves; what tells a measured 0 from an unread one. */
  lastSyncedAt?: string | null;
  platformMetrics?: unknown;
  /** Read by lib/posts/postStatus and the counters' age. */
  fetchState?: string | null;
  lastFreshAt?: string | null;
  trackingEnabled?: boolean | null;
  trackingExpiresAt?: string | null;
  campaign: { id: string; title: string } | null;
};

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  bio: string | null;
  contactEmail: string | null;
  followersCount: number;
  averageViews: number;
  /** When the tracker last tried to read this creator, and why it failed. */
  trackerLastAttemptAt?: string | null;
  trackerLastError?: string | null;
  rate: number | null;
  notes: string | null;
  activations: {
    id: string;
    status: string;
    deliverableDueDate: string | null;
    campaign: { id: string; title: string; status: string; budget: number | null; currency: string };
  }[];
  posts: Post[];
  /** Distinct campaigns, counted from posts as well as activations. */
  campaignCount: number;
  /** The campaigns behind that count, derived the same way. */
  campaigns: {
    id: string;
    title: string;
    status: string;
    budget: number | null;
    currency: string;
    postCount: number;
    activation: { id: string; status: string; deliverableDueDate: string | null } | null;
  }[];
  /** The org's tags and flags applied to this creator. */
  tagLinks?: { tag: { id: string; name: string } }[];
  flagLinks?: { flag: { id: string; name: string; emoji: string | null } }[];
  _count: { activations: number; posts: number };
  /** Every account on the roster for this person, primary (TikTok first) at the head. */
  profileLinks?: {
    id: string;
    platform: string;
    handle: string;
    url: string | null;
    followersCount: number | null;
    averageViews: number | null;
    isPrimary: boolean;
    refreshedAt?: string | null;
    /** The platform could not find this account; see lib/creators/handleCheck. */
    problem: HandleProblem | null;
    /** When its count was measured (lib/creators/figureTime). */
    age?: FigureTimeDto;
  }[];
  /** When the headline figures were measured and by what (plan A6). */
  figureTimes?: { followers: FigureTimeDto };
  /** Set when the follower count was read through the org's own Instagram account. */
  instagramReadVia?: { username: string } | null;
  detail?: { country: string | null; audienceCountry: string | null; niche: string | null; source: string | null; signedUpAt: string | null } | null;
  lists?: { id: string; name: string }[];
};

type LabelDef = { id: string; name: string; emoji?: string | null };

/**
 * The reference's Tags section and Flag Creator action, both on the creator's
 * own profile, both drawing on the lists in Settings → General.
 *
 * Every change sends the whole set rather than a single add or remove. The card
 * already knows the full selection, and a set means clicking the same tag twice
 * cannot leave a duplicate or a half-applied state behind.
 */
function LabelCard({
  creatorId,
  kind,
  title,
  emptyLabel,
  addLabel,
  selected,
  onSaved,
}: {
  creatorId: string;
  kind: "tags" | "flags";
  title: string;
  emptyLabel: string;
  addLabel: string;
  selected: LabelDef[];
  onSaved: () => void;
}) {
  const [defs, setDefs] = useState<LabelDef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The definitions are only needed once the reader wants to add one, but they
  // also decide whether an "add" control makes sense at all, so they load with
  // the card.
  useEffect(() => {
    const list = kind === "tags" ? "creator-tags" : "creator-flags";
    fetch(`/api/settings/taxonomy/${list}`)
      .then((r) => r.json())
      .then((d) => setDefs(Array.isArray(d.items) ? d.items : []))
      .catch(() => setDefs([]));
  }, [kind]);

  async function save(ids: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/creators/${creatorId}/labels/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Could not save (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const selectedIds = selected.map((s) => s.id);
  const available = (defs ?? []).filter((d) => !selectedIds.includes(d.id));

  return (
    <Card variant="outlined" style={{ padding: 24 }}>
      <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>
        {title}
      </span>

      {selected.length === 0 ? (
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", lineHeight: 1.6 }}>{emptyLabel}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {selected.map((s) => (
            <span
              key={s.id}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 8, padding: "6px 8px 6px 12px", fontSize: "var(--cc-t-13)", color: "var(--cc-text)",
              }}
            >
              {s.emoji ? `${s.emoji} ` : ""}{s.name}
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                disabled={busy}
                onClick={() => void save(selectedIds.filter((v) => v !== s.id))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "inline-flex", padding: 0 }}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {defs === null ? null : available.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <Dropdown
            ariaLabel={addLabel}
            value=""
            placeholder={addLabel}
            disabled={busy}
            align="left"
            minWidth={180}
            onChange={(v) => void save([...selectedIds, v])}
            options={available.map((d) => ({
              value: d.id,
              label: d.emoji ? `${d.emoji} ${d.name}` : d.name,
            }))}
          />
        </div>
      ) : (
        <p style={{ marginTop: 12, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
          {(defs ?? []).length === 0
            ? `No ${kind} defined yet — add them in Settings → General.`
            : `All ${kind} applied.`}
        </p>
      )}

      {error && (
        <p role="alert" style={{ marginTop: 8, fontSize: "var(--cc-t-12)", color: "var(--cc-danger)" }}>{error}</p>
      )}
    </Card>
  );
}

/** The lists this creator is on, each a link, with a way onto another. */
function ListsCard({ creatorId, lists, onSaved }: { creatorId: string; lists: { id: string; name: string }[]; onSaved: () => void }) {
  const [all, setAll] = useState<{ id: string; name: string }[] | null>(null);
  const [shown, setShown] = useState(lists);
  const [busy, setBusy] = useState(false);

  useEffect(() => setShown(lists), [lists]);

  useEffect(() => {
    fetch("/api/lists")
      .then((r) => r.json())
      .then((d) => setAll(Array.isArray(d.lists) ? d.lists.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })) : []))
      .catch(() => setAll([]));
  }, []);

  async function change(url: string, init: RequestInit, done: string, next: (s: typeof lists) => typeof lists) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Could not save (${res.status})`);
      }
      toast.success(done);
      setShown(next);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const onIds = shown.map((l) => l.id);
  const available = (all ?? []).filter((l) => !onIds.includes(l.id));

  return (
    <Card variant="outlined" style={{ padding: 24 }}>
      <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>
        On lists
      </span>
      {shown.length === 0 ? (
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", lineHeight: 1.6 }}>Not on any list yet.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {shown.map((l) => (
            <span
              key={l.id}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 8, padding: "6px 8px 6px 12px", fontSize: "var(--cc-t-13)",
              }}
            >
              <Link href={`/lists/${l.id}`} style={{ color: "var(--cc-text)", textDecoration: "none" }}>
                {l.name}
              </Link>
              <button
                type="button"
                aria-label={`Remove from ${l.name}`}
                disabled={busy}
                onClick={() => void change(`/api/lists/${l.id}/creators/${creatorId}`, { method: "DELETE" }, `Removed from ${l.name}`, (s) => s.filter((x) => x.id !== l.id))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {all && available.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Dropdown
            ariaLabel="Add to list"
            value=""
            placeholder="Add to list"
            disabled={busy}
            align="left"
            minWidth={180}
            onChange={(listId) => {
              const name = available.find((l) => l.id === listId)?.name ?? "the list";
              void change(
                "/api/lists/from-roster",
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId, creatorIds: [creatorId] }) },
                `Added to ${name}`,
                (s) => [{ id: listId, name }, ...s.filter((x) => x.id !== listId)],
              );
            }}
            options={available.map((l) => ({ value: l.id, label: l.name }))}
          />
        </div>
      )}
    </Card>
  );
}

const responsiveStyles = `
  .cd-stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-top: 24px;
  }
  .cd-profile-header {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin: 0 -16px;
    padding: 20px 16px;
  }
  .cd-profile-info { flex: 1; padding-bottom: 4px; min-width: 180px; }
  .cd-profile-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .cd-banner-inner { padding: 0 16px 20px; }
  .cd-tabs-bar-wrap {
    position: relative;
    margin-bottom: 24px;
  }
  .cd-tabs-bar-wrap::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 1px;
    width: 48px;
    pointer-events: none;
    background: linear-gradient(to right, transparent, var(--cc-bg));
  }
  .cd-banner-band {
    background: linear-gradient(to right, color-mix(in srgb, var(--cd-band) 13%, transparent), color-mix(in srgb, var(--cd-band) 7%, transparent));
  }
  :root.light .cd-banner-band { --cd-band: var(--cc-text); }
  .cd-tabs-bar {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--cc-border);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .cd-tabs-bar::-webkit-scrollbar { display: none; }
  .cd-tabs-bar button { white-space: nowrap; flex-shrink: 0; }
  .cd-profile-cards {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cd-posts-table-header,
  .cd-posts-table-row {
    display: none;
  }
  .cd-post-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--cc-border);
    text-decoration: none;
  }
  .cd-post-card:first-child { border-top: none; }
  .cd-post-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .cd-post-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--cc-text-muted);
  }
  .cd-payouts-header,
  .cd-payout-row {
    display: none;
  }
  .cd-payout-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--cc-border);
  }
  .cd-payout-card:first-child { border-top: none; }
  .cd-campaign-row-budget { display: none; }
  .cd-campaign-row-chevron { display: none; }
  .cd-social-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 480px) {
    .cd-social-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (min-width: 640px) {
    .cd-stats-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .cd-banner-inner { padding: 0 24px 24px; }
    .cd-profile-header { margin: 0 -24px; padding: 24px; }
    .cd-profile-cards { grid-template-columns: 1fr 1fr; gap: 24px; }
    .cd-campaign-row-budget { display: block; }
    .cd-campaign-row-chevron { display: block; }
    .cd-payouts-header {
      display: grid;
      grid-template-columns: 1fr 120px 100px 100px;
      gap: 12px;
      padding: 12px 24px;
      border-bottom: 1px solid var(--cc-border);
      background: var(--cc-bg);
    }
    .cd-payout-row {
      display: grid;
      grid-template-columns: 1fr 120px 100px 100px;
      gap: 12px;
      padding: 14px 24px;
      align-items: center;
    }
    .cd-payout-card { display: none; }
  }

  @media (min-width: 768px) {
    .cd-stats-grid { grid-template-columns: repeat(4, 1fr); }
  }

  @media (min-width: 900px) {
    .cd-social-grid { grid-template-columns: repeat(3, 1fr); }
  }

  @media (min-width: 1024px) {
    .cd-posts-table-header {
      display: grid;
      grid-template-columns: 1fr 120px 100px 80px 80px 80px 80px;
      gap: 12px;
      padding: 12px 24px;
      border-bottom: 1px solid var(--cc-border);
      background: var(--cc-bg);
    }
    .cd-posts-table-row {
      display: grid;
      grid-template-columns: 1fr 120px 100px 80px 80px 80px 80px;
      gap: 12px;
      padding: 14px 24px;
      align-items: center;
      text-decoration: none;
    }
    .cd-post-card { display: none; }
  }
`;

/**
 * A post's status chip (when it is anything but live) and its counters' age,
 * the same two facts the campaign posts list shows (plan A5/A6).
 */
function PostAge({ post }: { post: Post }) {
  const status = postStatus(post);
  const measured = postMeasuredAt(post);
  return (
    <>
      <PostStatusChip status={status} compact />
      <AgeLabel
        at={measured.at}
        field="post"
        ctx={postAgeContext(post, status)}
        source={measured.source}
        prefix="read"
        never="not read by us yet"
      />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rsp-page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="100%" height="220px" borderRadius="12px" />
      <div className="cd-stats-grid">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="80px" borderRadius="10px" />)}
      </div>
      <Skeleton width="100%" height="300px" borderRadius="12px" />
      <style>{responsiveStyles}</style>
    </div>
  );
}

function EditCreatorModal({ open, onClose, creator, onSaved }: { open: boolean; onClose: () => void; creator: Creator; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: creator.name,
    handle: creator.handle,
    platform: creator.platform,
    bio: creator.bio ?? "",
    contactEmail: creator.contactEmail ?? "",
    rate: creator.rate != null ? String(creator.rate) : "",
    notes: creator.notes ?? "",
    country: creator.detail?.country ?? "",
    audienceCountry: creator.detail?.audienceCountry ?? "",
    niche: creator.detail?.niche ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: creator.name,
        handle: creator.handle,
        platform: creator.platform,
        bio: creator.bio ?? "",
        contactEmail: creator.contactEmail ?? "",
        rate: creator.rate != null ? String(creator.rate) : "",
        notes: creator.notes ?? "",
        country: creator.detail?.country ?? "",
        audienceCountry: creator.detail?.audienceCountry ?? "",
        niche: creator.detail?.niche ?? "",
      });
    }
  }, [open, creator]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    const payload: Record<string, unknown> = {};
    if (form.name !== creator.name) payload.name = form.name;
    if (form.handle !== creator.handle) payload.handle = form.handle;
    if (form.platform !== creator.platform) payload.platform = form.platform;
    if (form.bio !== (creator.bio ?? "")) payload.bio = form.bio || null;
    if (form.contactEmail !== (creator.contactEmail ?? "")) payload.contactEmail = form.contactEmail || null;
    const rateNum = form.rate ? Number(form.rate) : null;
    if (rateNum !== (creator.rate != null ? Number(creator.rate) : null)) payload.rate = rateNum;
    if (form.notes !== (creator.notes ?? "")) payload.notes = form.notes || null;
    for (const k of ["country", "audienceCountry", "niche"] as const) {
      if (form[k].trim() !== (creator.detail?.[k] ?? "")) payload[k] = form[k].trim() || null;
    }

    try {
      const res = await fetch(`/api/creators/${creator.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        // The modal used to stay open with no message, so an invalid handle
        // read as a dead Save button.
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error ?? "Couldn't save those changes.");
      }
    } catch {
      toast.error("The request didn't go through. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const textareaStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--cc-border)",
    borderRadius: 8,
    padding: 10,
    fontSize: "var(--cc-t-14)",
    color: "var(--cc-text)",
    resize: "vertical",
    minHeight: 80,
    fontFamily: "inherit",
    background: "var(--cc-card)",
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Creator">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 4 }}>
        <Input label="Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)} required />
        <Input label="Handle" value={form.handle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("handle", e.target.value)} required />
        <div>
          <label htmlFor="edit-creator-platform" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Platform</label>
          <Dropdown
            ariaLabel="Platform"
            align="left"
            fullWidth
            value={form.platform}
            onChange={v => set("platform", v)}
            options={["INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER"].map((p) => ({ value: p, label: p }))}
          />
        </div>
        <div>
          <label htmlFor="edit-creator-bio" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Bio</label>
          <textarea id="edit-creator-bio" value={form.bio} onChange={e => set("bio", e.target.value)} style={textareaStyle} />
        </div>
        <Input label="Contact Email" type="email" value={form.contactEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("contactEmail", e.target.value)} />
        <Input label="Rate per Post (USD)" type="number" value={form.rate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("rate", e.target.value)} />
        <Input label="Country" value={form.country} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("country", e.target.value)} />
        <Input label="Audience country" value={form.audienceCountry} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("audienceCountry", e.target.value)} />
        <Input label="Niche" value={form.niche} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("niche", e.target.value)} />
        <div>
          <label htmlFor="edit-creator-notes" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Notes</label>
          <textarea id="edit-creator-notes" value={form.notes} onChange={e => set("notes", e.target.value)} style={textareaStyle} />
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{
            background: "var(--cc-primary)",
            color: "var(--cc-on-primary)",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: "var(--cc-t-14)",
            fontWeight: "var(--cc-fw-strong)",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </Modal>
  );
}

export default function CreatorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [showAddSocial, setShowAddSocial] = useState(false);
  const [addSocialForm, setAddSocialForm] = useState({ platform: "INSTAGRAM", handle: "", followersCount: "", avgViews: "" });
  const [addingSocial, setAddingSocial] = useState(false);
  const [removingSocial, setRemovingSocial] = useState<string | null>(null);

  const [tiktokVideos, setTiktokVideos] = useState<TikTokVideo[]>([]);
  const [tiktokLoading, setTiktokLoading] = useState(false);
  const [tiktokError, setTiktokError] = useState<string | null>(null);
  // A handle typed into the roster is a TikTok "account" with no grant behind
  // it. The panel used to open on "Could not load TikTok posts" for every such
  // creator; with nothing connected there is nothing to show, so it stays shut.
  // Null until the first answer, so the panel does not open and then vanish.
  const [tiktokNotConnected, setTiktokNotConnected] = useState<boolean | null>(null);

  const fetchSocialAccounts = () => {
    setSocialLoading(true);
    fetch(`/api/creators/${id}/social-accounts`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSocialAccounts(data);
          if (data.some((a: SocialAccount) => a.platform === "TIKTOK")) fetchTikTokVideos();
        }
      })
      .finally(() => setSocialLoading(false));
  };

  const fetchTikTokVideos = () => {
    setTiktokLoading(true);
    setTiktokError(null);
    fetch(`/api/creators/${id}/tiktok-videos`)
      .then(r => r.json())
      .then(data => {
        setTiktokVideos(Array.isArray(data.videos) ? data.videos : []);
        setTiktokNotConnected(data.code === "not_connected");
        if (data.error) setTiktokError(data.error);
      })
      .catch(() => { setTiktokNotConnected(false); setTiktokError("Request failed"); })
      .finally(() => setTiktokLoading(false));
  };

  const handleAddSocial = async () => {
    if (addingSocial || !addSocialForm.handle.trim()) return;
    setAddingSocial(true);
    try {
      const res = await fetch(`/api/creators/${id}/social-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: addSocialForm.platform,
          handle: addSocialForm.handle.trim(),
          followersCount: addSocialForm.followersCount ? Number(addSocialForm.followersCount) : 0,
          avgViews: addSocialForm.avgViews ? Number(addSocialForm.avgViews) : 0,
        }),
      });
      if (res.ok) {
        setShowAddSocial(false);
        setAddSocialForm({ platform: "INSTAGRAM", handle: "", followersCount: "", avgViews: "" });
        fetchSocialAccounts();
      } else {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error ?? "Couldn't add that account.");
      }
    } catch {
      toast.error("The request didn't go through. No account was added.");
    } finally {
      setAddingSocial(false);
    }
  };

  const handleRemoveSocial = async (accountId: string) => {
    setRemovingSocial(accountId);
    try {
      const res = await fetch(`/api/creators/${id}/social-accounts?accountId=${accountId}`, { method: "DELETE" });
      if (res.ok) {
        fetchSocialAccounts();
        return;
      }
      toast.error("Couldn't remove that account. It is still linked.");
    } catch {
      toast.error("The request didn't go through. The account is still linked.");
    } finally {
      setRemovingSocial(null);
    }
  };

  const refreshCreator = () => {
    fetch(`/api/creators/${id}`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setCreator(data); });
  };

  useEffect(() => {
    fetch(`/api/creators/${id}`)
      .then((r) => r.json())
      .then((data) => { setCreator(data.error ? null : data); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (activeTab === "social") fetchSocialAccounts();
  }, [activeTab]);

  const tabsList: { label: string; value: Tab; count?: number }[] = [
    { label: "Profile", value: "profile" },
    { label: "Posts", value: "posts", count: creator?._count.posts },
    { label: "Campaigns", value: "campaigns", count: creator?.campaignCount },
    { label: "Social Accounts", value: "social" },
  ];

  if (loading) return <LoadingSkeleton />;
  if (!creator) return (
    <div className="rsp-page">
      <EmptyState icon={<User size={32} color="var(--cc-text-subtle)" />} title="Creator not found" description="This creator doesn't exist or has been removed." />
    </div>
  );

  /* "Unknown" is never shown as 0 (plan A1). The primary account's read is the
     one that writes followersCount, so its stamp and its problem explain a
     missing count; the tracker's own attempt is the fallback. */
  const primaryLink = creator.profileLinks?.find((l) => l.isPrimary) ?? null;
  const followers = followersValue(creator.followersCount, {
    readError: primaryLink?.problem ? handleProblemText(primaryLink.platform, primaryLink.handle, primaryLink.problem) : null,
    lastError: creator.trackerLastError ?? null,
    attemptedAt: primaryLink?.refreshedAt ?? creator.trackerLastAttemptAt ?? null,
  });
  /* Over the posts that were read, never over the zeroes of the ones that were
     not -- see creatorEngagementValue. */
  const avgEngagement = creatorEngagementValue(creator.posts);
  const percent = (n: number) => `${n.toFixed(1)}%`;
  /* Ages for the tiles (plan A6). Followers: the read that produced the count,
     decided on the server. Engagement: the newest read among the posts it is
     averaged over -- an average of posts read at different times has no single
     age, so it is labelled as the newest one and never called stale. */
  const followersAt = creator.figureTimes?.followers ?? null;
  const engagementAsOf = dataAsOf(creator.posts.map((p) => p.lastSyncedAt));

  return (
    <div className="rsp-page">
      <style>{responsiveStyles}</style>

      {/* No in-page trail: the top bar already reads Creators > <name>, at
          every width, and two stacked trails was the only detail page that
          had them. */}

      {/* Banner + Profile */}
      <Card variant="outlined" noPadding style={{ marginBottom: 24 }}>
        {/* The platform's colour as a 13%-to-7% wash. color-mix rather than a
            hex alpha suffix: the old `${colour}22` turned the fallback into
            "var(--cc-primary)22", which is not a colour, so an unknown platform
            drew no band at all. Light swaps the hue for ink (see .cd-banner-band).
            The band is the identity row's own background now, not an 80px strip
            the row was pulled up over: the strip ended mid-header, through the
            @handle line and across the Edit and Merge buttons. */}
        <div className="cd-banner-inner" style={{ "--cd-band": PLATFORM_COLORS[creator.platform] ?? "var(--cc-primary)" } as React.CSSProperties}>
          <div className="cd-profile-header cd-banner-band">
            <CreatorAvatar id={creator.id} name={creator.name} size="lg" />
            <div className="cd-profile-info">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h1 className="cc-page-title" data-mb="0">{creator.name}</h1>
                {!creator.profileLinks?.length && <Badge variant="neutral">{platformLabel(creator.platform)}</Badge>}
              </div>
              <div style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", marginTop: 2 }}>
                {creator.handle.startsWith("@") ? creator.handle : `@${creator.handle}`}
                {creator.contactEmail && <> · {creator.contactEmail}</>}
              </div>
              {creator.profileLinks && creator.profileLinks.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <PlatformChips links={creator.profileLinks} />
                </div>
              )}
              {(creator.detail?.source || creator.detail?.signedUpAt) && (
                <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 6 }}>
                  {creator.detail.source ? `Joined via ${creator.detail.source}` : "Signed up"}
                  {creator.detail.signedUpAt && <> · {formatDateAbs(creator.detail.signedUpAt)}</>}
                </div>
              )}
            </div>
            <div className="cd-profile-actions">
              <button
                onClick={() => setEditOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
                  color: "var(--cc-primary)", background: "var(--cc-card)",
                  border: "1.5px solid var(--cc-primary)", borderRadius: 8, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                onClick={() => setMergeOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
                  color: "var(--cc-text)", background: "var(--cc-card)",
                  border: "1.5px solid var(--cc-border)", borderRadius: 8, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Combine size={14} /> Merge duplicate
              </button>
            </div>
          </div>

          {creator.profileLinks?.some((l) => l.problem) && (
            <div className="cc-handle-fixes">
              {creator.profileLinks.map((l) =>
                l.problem ? (
                  <HandleFix key={l.id} creatorId={creator.id} link={{ ...l, problem: l.problem }} onSaved={refreshCreator} />
                ) : null,
              )}
            </div>
          )}

          {/* Stats row */}
          {/* Every tile, always. Follower counts and engagement rates are
              absent for most of the imported roster; a tile reading 0 would
              claim a measurement that was never taken, so an unknown one reads
              "—" and says why on hover (plan A1). Hiding it instead left the
              reader to guess whether the figure was missing or the page was. */}
          <div className="cd-stats-grid">
            <MetricTile
              metric="followers"
              value={<MetricFigure value={followers} format={formatNumber} />}
              footer={
                followersAt && !isUnknownMetric(followers) ? (
                  <>
                    <AgeLabel
                      at={followersAt.at}
                      field={followersAt.field}
                      source={followersAt.source}
                      never={followersAt.missing}
                      style={{ whiteSpace: "normal" }}
                    />
                    {creator.instagramReadVia ? (
                      <span className="cc-ig-read-via">
                        via your Instagram Business account (@{creator.instagramReadVia.username})
                      </span>
                    ) : null}
                  </>
                ) : undefined
              }
            />
            <MetricTile metric="creatorCampaigns" value={String(creator.campaignCount)} />
            <MetricTile metric="posts" label="Posts" value={formatNumber(creator._count.posts)} />
            <MetricTile
              metric="engagementRate"
              label="Avg engagement"
              value={<MetricFigure value={avgEngagement} format={percent} />}
              footer={
                !isUnknownMetric(avgEngagement) ? (
                  <AgeLabel at={engagementAsOf} field="post" ctx={{ tracked: false }} prefix="Newest read" source="Tracked posts" never="no post read by us yet" />
                ) : undefined
              }
            />
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="cd-tabs-bar-wrap">
        <div className="cd-tabs-bar" role="tablist">
          {tabsList.map(tab => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => setActiveTab(tab.value)}
              style={{
                padding: "10px 16px", fontSize: "var(--cc-t-14)", fontWeight: 500,
                background: "none", border: "none", cursor: "pointer",
                borderBottom: activeTab === tab.value ? "2px solid var(--cc-primary)" : "2px solid transparent",
                color: activeTab === tab.value ? "var(--cc-primary)" : "var(--cc-text-muted)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span style={{ fontSize: "var(--cc-t-11)", background: "var(--cc-bg)", borderRadius: 10, padding: "1px 7px", color: "var(--cc-text-muted)" }}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="cd-profile-cards">
            <Card variant="outlined" style={{ padding: 24 }}>
              <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>About</span>
              {/* Their bio or nothing. The fallback was a sentence nobody wrote,
                  printed where the creator's own words go. */}
              {creator.bio?.trim() ? (
                <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", lineHeight: 1.6 }}>
                  {creator.bio}
                </p>
              ) : (
                <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-subtle)", lineHeight: 1.6 }}>
                  No bio.
                </p>
              )}
              {creator.contactEmail && (
                <div style={{ marginTop: 16, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                  <strong>Email:</strong> {creator.contactEmail}
                </div>
              )}
              {[
                ["Price per video", creator.rate ? formatFullCurrency(creator.rate) : null],
                ["Country", creator.detail?.country],
                ["Audience", creator.detail?.audienceCountry],
                ["Niche", creator.detail?.niche],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} style={{ marginTop: 8, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                    <strong>{label}:</strong> {value}
                  </div>
                ))}
            </Card>
            <Card variant="outlined" style={{ padding: 24 }}>
              <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>Notes</span>
              <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", lineHeight: 1.6 }}>
                {creator.notes ?? "No notes added yet."}
              </p>
            </Card>
            <LabelCard
              creatorId={id}
              kind="tags"
              title="Tags"
              emptyLabel="No tags added yet!"
              addLabel="Add Tag"
              selected={(creator.tagLinks ?? []).map((l) => l.tag)}
              onSaved={refreshCreator}
            />
            <LabelCard
              creatorId={id}
              kind="flags"
              title="Flags"
              emptyLabel="No flags added yet!"
              addLabel="Flag Creator"
              selected={(creator.flagLinks ?? []).map((l) => l.flag)}
              onSaved={refreshCreator}
            />
            <ListsCard creatorId={id} lists={creator.lists ?? []} onSaved={refreshCreator} />
          </div>
        )}

        {/* Posts Tab */}
        {activeTab === "posts" && (
          creator.posts.length === 0 ? (
            <EmptyState icon={<Video size={32} color="var(--cc-text-subtle)" />} title="No posts yet" description="Posts will appear here when synced from social platforms." />
          ) : (
            <Card variant="solid" noPadding>
              {/* Desktop table header */}
              <div className="cd-posts-table-header">
                {["Post", "Campaign", "Views", "Likes", "Comments", "Shares", "Eng %"].map(h => (
                  <span key={h} className="cc-microlabel">{h}</span>
                ))}
              </div>
              <div className="cc-stagger">
                {creator.posts.map((post, i) => (
                  <div key={post.id}>
                    {/* Desktop row */}
                    <a
                      href={post.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cd-posts-table-row cc-table-row"
                      style={{ borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                    >
                      <div>
                        <p title={post.caption ?? undefined} style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {post.caption?.slice(0, 60) ?? "Untitled Post"} <ExternalLink size={11} style={{ opacity: 0.4 }} />
                        </p>
                        <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          {formatDateAbs(post.postedAt)}
                          <PostAge post={post} />
                        </p>
                      </div>
                      <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{post.campaign?.title ?? "—"}</span>
                      <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}><MetricFigure value={postCounterValue(post.viewsCount, post, "views")} format={formatNumber} /></span>
                      <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}><MetricFigure value={postCounterValue(post.likesCount, post, "likes")} format={formatNumber} /></span>
                      <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}><MetricFigure value={postCounterValue(post.commentsCount, post, "comments")} format={formatNumber} /></span>
                      <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}><MetricFigure value={postCounterValue(post.sharesCount, post, "shares")} format={formatNumber} /></span>
                      <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-primary)" }}><MetricFigure value={postEngagementValue(post)} format={percent} /></span>
                    </a>
                    {/* Mobile card */}
                    <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="cd-post-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p title={post.caption ?? undefined} style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
                            {post.caption?.slice(0, 50) ?? "Untitled Post"} <ExternalLink size={11} style={{ opacity: 0.4 }} />
                          </p>
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "2px 0 0" }}>
                            {post.campaign?.title ?? "—"} · {formatDateAbs(post.postedAt)}
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <PostAge post={post} />
                          </div>
                        </div>
                        <span style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-primary)", flexShrink: 0 }}><MetricFigure value={postEngagementValue(post)} format={percent} /></span>
                      </div>
                      <div className="cd-post-stats">
                        <span className="cd-post-stat"><Eye size={13} /> <MetricFigure value={postCounterValue(post.viewsCount, post, "views")} format={formatNumber} /></span>
                        <span className="cd-post-stat"><Heart size={13} /> <MetricFigure value={postCounterValue(post.likesCount, post, "likes")} format={formatNumber} /></span>
                        <span className="cd-post-stat"><MessageCircle size={13} /> <MetricFigure value={postCounterValue(post.commentsCount, post, "comments")} format={formatNumber} /></span>
                        <span className="cd-post-stat"><Share2 size={13} /> <MetricFigure value={postCounterValue(post.sharesCount, post, "shares")} format={formatNumber} /></span>
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            </Card>
          )
        )}

        {/* Campaigns Tab */}
        {activeTab === "campaigns" && (
          /* Driven by creator.campaigns, not creator.activations. Activations did
             not import from CreatorCore, so 1,824 of 1,834 creators had none and
             this tab said "No campaigns yet" directly under a badge reading 215. */
          (creator.campaigns ?? []).length === 0 ? (
            <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="No campaigns yet" description="This creator has no posts on, and no activation for, any campaign." />
          ) : (
            <div className="cc-stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(creator.campaigns ?? []).map(c => (
                <Link prefetch={false} key={c.id} href={`/campaigns/${c.id}`} style={{ textDecoration: "none" }}>
                  <Card variant="outlined" style={{ padding: "16px 20px" }} clickable>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontWeight: 700, fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>{c.title}</div>
                        <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 2 }}>
                          {c.postCount > 0 ? `${c.postCount} post${c.postCount === 1 ? "" : "s"}` : "No posts"}
                          {c.activation?.deliverableDueDate ? ` · Due ${formatDateAbs(c.activation.deliverableDueDate)}` : ""}
                        </div>
                      </div>
                      {/* The activation status when there is one; otherwise the
                          campaign's own, rather than a blank where a pill was. */}
                      <Badge variant={STATUS_VARIANT[c.activation?.status ?? c.status] ?? "neutral"} dot>
                        {c.activation?.status
                          ? ACTIVATION_STATUS_LABEL[c.activation.status] ?? enumLabel(c.activation.status)
                          : campaignStatusLabel(c.status)}
                      </Badge>
                      {c.budget && (
                        <span className="cd-campaign-row-budget" style={{ fontWeight: 700, fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>
                          {formatCurrency(Number(c.budget), c.currency)}
                        </span>
                      )}
                      <span className="cd-campaign-row-chevron">
                        <ChevronRight size={16} style={{ color: "var(--cc-text-subtle)" }} />
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )
        )}

        {/* Social Accounts Tab */}
        {activeTab === "social" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: "var(--cc-t-16)", color: "var(--cc-text)" }}>Connected Accounts</span>
              <button
                onClick={() => setShowAddSocial(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--cc-primary)", color: "var(--cc-on-primary)", border: "none",
                  borderRadius: 8, padding: "7px 14px", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", cursor: "pointer",
                }}
              >
                <Plus size={14} /> Add Account
              </button>
            </div>

            {/* Add form */}
            {showAddSocial && (
              <Card variant="outlined" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label htmlFor="add-social-platform" style={{ display: "block", fontSize: "var(--cc-t-12)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 4 }}>Platform</label>
                      <Dropdown
                        ariaLabel="Platform"
                        align="left"
                        fullWidth
                        value={addSocialForm.platform}
                        onChange={v => setAddSocialForm(prev => ({ ...prev, platform: v }))}
                        options={["INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER"].map((p) => ({ value: p, label: p }))}
                      />
                    </div>
                    <Input
                      label="Handle"
                      value={addSocialForm.handle}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, handle: e.target.value }))}
                      placeholder="@username"
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Input
                      label="Followers"
                      type="number"
                      value={addSocialForm.followersCount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, followersCount: e.target.value }))}
                      placeholder="0"
                    />
                    <Input
                      label="Avg Views"
                      type="number"
                      value={addSocialForm.avgViews}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, avgViews: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setShowAddSocial(false)}
                      style={{
                        padding: "7px 14px", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", cursor: "pointer",
                        background: "var(--cc-card)", color: "var(--cc-text-muted)",
                        border: "1px solid var(--cc-border)", borderRadius: 8,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddSocial}
                      disabled={addingSocial || !addSocialForm.handle.trim()}
                      style={{
                        padding: "7px 14px", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", cursor: addingSocial ? "not-allowed" : "pointer",
                        background: "var(--cc-primary)", color: "var(--cc-on-primary)", border: "none", borderRadius: 8,
                        opacity: addingSocial || !addSocialForm.handle.trim() ? 0.5 : 1,
                      }}
                    >
                      {addingSocial ? "Adding..." : "Add"}
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {socialLoading ? (
              <div className="cd-social-grid">
                {[1, 2, 3].map(i => <Skeleton key={i} height="140px" borderRadius="12px" />)}
              </div>
            ) : socialAccounts.length === 0 ? (
              <EmptyState icon={<Link2 size={32} color="var(--cc-text-subtle)" />} title="No social accounts" description="Link social media accounts to track cross-platform presence." />
            ) : (
              <div className="cd-social-grid">
                {socialAccounts.map(acct => (
                  <Card key={acct.id} variant="outlined" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <Badge
                        variant="neutral"
                        style={{ background: `color-mix(in srgb, ${PLATFORM_COLORS[acct.platform] ?? "var(--cc-primary)"} 9.4%, transparent)`, color: PLATFORM_COLORS[acct.platform] ?? "var(--cc-primary)" }}
                      >
                        {acct.platform}
                      </Badge>
                      <button
                        onClick={() => handleRemoveSocial(acct.id)}
                        disabled={removingSocial === acct.id}
                        aria-busy={removingSocial === acct.id}
                        aria-label={`Remove ${acct.platform} account ${acct.handle}`}
                        style={{
                          background: "none", border: "none",
                          cursor: removingSocial === acct.id ? "not-allowed" : "pointer",
                          opacity: removingSocial === acct.id ? 0.5 : 1,
                          padding: 4,
                          color: "var(--cc-text-muted)", borderRadius: 4,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ fontWeight: "var(--cc-fw-strong)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", marginBottom: 4 }}>
                      {acct.handle.startsWith("@") ? acct.handle : `@${acct.handle}`}
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginBottom: 8 }}>
                      {/* Both columns default to 0 on a connected account, so 0 here
                          is "not read yet" far more often than a real count. */}
                      <span><Users size={12} style={{ marginRight: 4, verticalAlign: "middle" }} /><MetricFigure value={followersValue(acct.followersCount)} format={formatNumber} /> {acct.platform === "YOUTUBE" ? "subscribers" : "followers"}</span>
                      <span><Eye size={12} style={{ marginRight: 4, verticalAlign: "middle" }} /><MetricFigure value={avgViewsValue(acct.avgViews)} format={formatNumber} /> avg views</span>
                    </div>
                    {/* The account's own statistics are read daily (plan A6); one
                        entered by hand has never been read, and says so. */}
                    <div style={{ marginBottom: 6 }}>
                      <AgeLabel at={acct.statsSyncedAt ?? null} field="account" prefix="Read" source="Connected account" never="never read by us" />
                    </div>
                    <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)" }}>
                      Connected {formatDateAbs(acct.createdAt)}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <CreatorAccess creatorId={id} />

            {socialAccounts.some(a => a.platform === "TIKTOK") && tiktokNotConnected === false && (
              <div style={{ marginTop: 32 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: "var(--cc-t-16)", color: "var(--cc-text)" }}>TikTok posts</span>
                  <button
                    onClick={fetchTikTokVideos}
                    disabled={tiktokLoading}
                    style={{
                      background: "var(--cc-card)", color: "var(--cc-primary)",
                      border: "1.5px solid var(--cc-primary)", borderRadius: 8,
                      padding: "6px 12px", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
                      cursor: tiktokLoading ? "not-allowed" : "pointer",
                      opacity: tiktokLoading ? 0.5 : 1,
                    }}
                  >
                    {tiktokLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginBottom: 16 }}>
                  Public posts and their performance, read from TikTok with the creator&rsquo;s permission.
                </p>
                {tiktokLoading ? (
                  <div className="cd-social-grid">
                    {[1, 2, 3].map(i => <Skeleton key={i} height="200px" borderRadius="12px" />)}
                  </div>
                ) : tiktokError ? (
                  <EmptyState icon={<Video size={32} color="var(--cc-text-subtle)" />} title="Could not load TikTok posts" description={tiktokError} />
                ) : tiktokVideos.length === 0 ? (
                  <EmptyState icon={<Video size={32} color="var(--cc-text-subtle)" />} title="No public posts yet" description="This creator has not published any public TikTok videos." />
                ) : (
                  <div className="cd-social-grid">
                    {tiktokVideos.map(video => (
                      <Card key={video.id} variant="outlined" style={{ padding: 0, overflow: "hidden" }}>
                        {video.coverImageUrl && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={video.coverImageUrl}
                            alt=""
                            style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
                          />
                        )}
                        <div style={{ padding: 16 }}>
                          <div style={{ fontWeight: "var(--cc-fw-strong)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", marginBottom: 8 }}>
                            {video.description || video.title || "Untitled post"}
                          </div>
                          <div className="cd-post-stats" style={{ marginBottom: 8 }}>
                            <span className="cd-post-stat"><Eye size={12} />{formatNumber(video.viewsCount)}</span>
                            <span className="cd-post-stat"><Heart size={12} />{formatNumber(video.likesCount)}</span>
                            <span className="cd-post-stat"><MessageCircle size={12} />{formatNumber(video.commentsCount)}</span>
                            <span className="cd-post-stat"><Share2 size={12} />{formatNumber(video.sharesCount)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)" }}>
                            <span>{formatDateAbs(video.postedAt)}</span>
                            {video.shareUrl && (
                              <a href={video.shareUrl} target="_blank" rel="noreferrer" style={{ color: "var(--cc-primary)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                View <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </motion.div>

      <EditCreatorModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        creator={creator}
        onSaved={refreshCreator}
      />
      <MergeCreatorModal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        creator={creator}
        onMerged={refreshCreator}
      />
    </div>
  );
}
