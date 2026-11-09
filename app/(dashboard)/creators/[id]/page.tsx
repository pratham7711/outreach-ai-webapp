"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import {
  Eye, Heart, MessageCircle, Share2, ExternalLink, Pencil, Plus, Trash2, Users,
  User, Video, ClipboardList, Link2, Combine, Megaphone, Image as ImageIcon, Activity, StickyNote, Tag, Flag, ListChecks, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, EmptyState, Input } from "@pratham7711/ui";
import { Modal, ModalSection } from "@/components/ds/Modal";
import { NotFoundState } from "@/components/errors/NotFoundState";
import {
  Button,
  DataTable,
  Dropdown,
  Field,
  FieldRow,
  MetricTile,
  MoreMenu,
  PageHeader,
  SectionCard,
  Skeleton,
  StatusBadge,
  StatusTabs,
  statusTone,
  useConfirm,
  type DataTableColumn,
} from "@/components/ds";
import { PlatformTag } from "@/components/ds/StatusBadge";
import { PageHeaderSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { useDirty } from "@/lib/useDirty";
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
  unknownMetric,
} from "@/lib/creators/metricValue";
import MetricFigure from "@/components/creators/MetricFigure";
import CreatorAccess from "@/components/creators/CreatorAccess";
import { PlatformTile } from "@/components/ui/PlatformTile";
import InstagramDiscoveryPanel from "@/components/creators/InstagramDiscoveryPanel";
import InstagramInsightsPanel from "@/components/insights/InstagramInsightsPanel";
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

/** "ROSTER" reads "roster"; a source someone typed is left as they typed it. */
const joinedVia = (source: string) => (/^[A-Z0-9_]+$/.test(source) ? enumLabel(source).toLowerCase() : source);

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
  /** Typed in by the agency rather than connected by the creator (decided server-side). */
  addedByHand?: boolean;
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
    <SectionCard icon={kind === "tags" ? Tag : Flag} title={title}>
      {selected.length === 0 ? (
        <p className="cd-empty-line">{emptyLabel}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
    </SectionCard>
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
    <SectionCard icon={ListChecks} title="On lists">
      {shown.length === 0 ? (
        <p className="cd-empty-line">Not on any list yet.</p>
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
    </SectionCard>
  );
}

const responsiveStyles = `
  .cd-stats { margin-bottom: 24px; }
  /* Two column stacks rather than one grid: five cards in a 2-column grid
     left "On lists" alone in its row and stretched Notes to the height of
     About. Each stack is as tall as its own cards. */
  .cd-profile {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .cd-profile-col {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
  }
  .cd-empty-line {
    margin: 0;
    font-size: var(--cc-t-14);
    line-height: 1.5;
    color: var(--cc-text-muted);
  }
  .cd-bio {
    margin: 0;
    font-size: var(--cc-t-14);
    line-height: 1.6;
    color: var(--cc-text);
  }
  /* Label over value, in a 2-column grid: the label is the muted 12px line,
     the value 14px medium in the ink. */
  .cd-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 32px;
    margin: 0;
  }
  .cd-bio + .cd-facts { margin-top: 20px; }
  .cd-facts > div { min-width: 0; }
  .cd-facts dt {
    margin: 0 0 4px;
    font-size: var(--cc-t-12);
    color: var(--cc-text-muted);
  }
  .cd-facts dd {
    margin: 0;
    font-size: var(--cc-t-14);
    font-weight: var(--cc-fw-medium);
    color: var(--cc-text);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .cd-facts dd[data-figure] {
    font-size: var(--cc-t-18);
    font-weight: 700;
  }
  .cd-account-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--cc-border);
    font-size: var(--cc-t-12);
    color: var(--cc-text-muted);
  }
  .cd-account-foot > span { display: inline-flex; align-items: center; gap: 6px; }
  .cd-section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .cd-section-head h2 {
    margin: 0;
    font-size: var(--cc-t-16);
    font-weight: 600;
    color: var(--cc-text);
  }
  .cd-post-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .cd-post-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--cc-t-13);
    color: var(--cc-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .cd-social-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 480px) {
    .cd-social-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (min-width: 900px) {
    .cd-profile { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cd-social-grid { grid-template-columns: repeat(3, 1fr); }
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

const percentText = (n: number) => `${n.toFixed(1)}%`;

/** A creator's posts: the caption opens the post on its platform. */
const POST_COLUMNS: DataTableColumn<Post>[] = [
  {
    key: "post",
    header: "Post",
    minWidth: 240,
    render: (post) => (
      <>
        <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="cc-dt-primary cc-dt-truncate" title={post.caption ?? undefined}>
          {post.caption?.slice(0, 80) || "Untitled post"}
          <ExternalLink size={12} aria-hidden="true" style={{ marginLeft: 4, verticalAlign: "-1px", display: "inline" }} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <span className="cc-dt-sub" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {formatDateAbs(post.postedAt)}
          <PostAge post={post} />
        </span>
      </>
    ),
  },
  { key: "campaign", header: "Campaign", width: 200, truncate: (p) => p.campaign?.title, render: (p) => p.campaign?.title ?? "—" },
  { key: "views", header: "Views", width: 112, align: "right", render: (p) => <MetricFigure value={postCounterValue(p.viewsCount, p, "views")} format={formatFull} /> },
  { key: "likes", header: "Likes", width: 104, align: "right", render: (p) => <MetricFigure value={postCounterValue(p.likesCount, p, "likes")} format={formatFull} /> },
  { key: "comments", header: "Comments", width: 112, align: "right", render: (p) => <MetricFigure value={postCounterValue(p.commentsCount, p, "comments")} format={formatFull} /> },
  { key: "shares", header: "Shares", width: 96, align: "right", render: (p) => <MetricFigure value={postCounterValue(p.sharesCount, p, "shares")} format={formatFull} /> },
  { key: "eng", header: "Eng. rate", width: 104, align: "right", render: (p) => <MetricFigure value={postEngagementValue(p)} format={percentText} /> },
];

type CreatorCampaign = Creator["campaigns"][number];

/** The activation's status when there is one; otherwise the campaign's own. */
function campaignRowStatus(c: CreatorCampaign) {
  const raw = c.activation?.status ?? c.status;
  const label = c.activation?.status
    ? ACTIVATION_STATUS_LABEL[c.activation.status] ?? enumLabel(c.activation.status)
    : campaignStatusLabel(c.status);
  return <StatusBadge tone={statusTone(raw)}>{label}</StatusBadge>;
}

const CAMPAIGN_COLUMNS: DataTableColumn<CreatorCampaign>[] = [
  {
    key: "title",
    header: "Campaign",
    primary: true,
    minWidth: 240,
    render: (c) => (
      <>
        <span className="cc-dt-truncate" title={c.title}>{c.title}</span>
        <span className="cc-dt-sub">
          {c.postCount > 0 ? `${formatFull(c.postCount)} post${c.postCount === 1 ? "" : "s"}` : "No posts"}
          {c.activation?.deliverableDueDate ? ` · Due ${formatDateAbs(c.activation.deliverableDueDate)}` : ""}
        </span>
      </>
    ),
  },
  { key: "status", header: "Status", width: 168, render: campaignRowStatus },
  {
    key: "budget",
    header: "Budget",
    width: 136,
    align: "right",
    render: (c) => (c.budget ? formatCurrency(Number(c.budget), c.currency) : "—"),
  },
];

/** The loaded page's shape: header band, the four tiles, then the cards. */
function LoadingSkeleton() {
  return (
    <div className="rsp-page">
      <style>{responsiveStyles}</style>
      <PageHeaderSkeleton />
      <TileGridSkeleton count={4} style={{ marginBottom: 24 }} />
      <div className="cd-profile">
        <Skeleton height={220} radius="var(--cc-r-card)" />
        <Skeleton height={220} radius="var(--cc-r-card)" />
      </div>
    </div>
  );
}

const PLATFORMS = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER"] as const;
const PLATFORM_OPTIONS = PLATFORMS.map((p) => ({ value: p, label: platformLabel(p) }));

type EditForm = {
  name: string; handle: string; platform: string; bio: string; contactEmail: string; rate: string;
  notes: string; country: string; audienceCountry: string; niche: string;
};

/** The edit form as the creator stands now: what "unchanged" is measured against. */
function editFormOf(creator: Creator): EditForm {
  return {
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
  };
}

function EditCreatorModal({ open, onClose, creator, onSaved }: { open: boolean; onClose: () => void; creator: Creator; onSaved: () => void }) {
  const [saved, setSaved] = useState<EditForm>(() => editFormOf(creator));
  const [form, setForm] = useState<EditForm>(saved);
  const [saving, setSaving] = useState(false);
  /* Save waits for a change, and for the two fields the creator cannot be
     without. Typing a character and deleting it again is not a change. */
  const dirty = useDirty(saved, form);
  const missing = !form.name.trim() || !form.handle.trim();

  useEffect(() => {
    if (open) {
      const next = editFormOf(creator);
      setSaved(next);
      setForm(next);
    }
  }, [open, creator]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !dirty || missing) return;
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

  const set = (key: keyof EditForm, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Pencil}
      title="Edit creator"
      description={<>Update the details on <strong className="cc-dialog__subject">{creator.name}</strong>&rsquo;s profile.</>}
      size="md"
      dismissible={false}
      footer={
        <div className="cc-modal-footer">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-creator-form" variant="primary" size="sm" loading={saving} disabled={!dirty || missing}>
            Save changes
          </Button>
        </div>
      }
    >
      <form id="edit-creator-form" onSubmit={handleSubmit}>
        <ModalSection title="Profile">
          <div className="cc-dialog-stack">
            <FieldRow>
              <Field label="Name" required>
                <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)} />
              </Field>
              <Field label="Handle" required>
                <Input value={form.handle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("handle", e.target.value)} />
              </Field>
            </FieldRow>
            <Field label="Platform">
              <Dropdown
                id="edit-creator-platform"
                align="left"
                fullWidth
                value={form.platform}
                onChange={v => set("platform", v)}
                options={PLATFORM_OPTIONS}
              />
            </Field>
            <Field label="Bio">
              <textarea id="edit-creator-bio" className="ui-textarea" rows={3} value={form.bio} onChange={e => set("bio", e.target.value)} />
            </Field>
          </div>
        </ModalSection>
        <ModalSection title="Contact and rate">
          <FieldRow>
            <Field label="Contact email">
              <Input type="email" value={form.contactEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("contactEmail", e.target.value)} />
            </Field>
            <Field label="Rate per post (USD)">
              <Input type="number" value={form.rate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("rate", e.target.value)} />
            </Field>
          </FieldRow>
        </ModalSection>
        <ModalSection title="Location and niche">
          <div className="cc-dialog-stack">
            <FieldRow>
              <Field label="Country">
                <Input value={form.country} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("country", e.target.value)} />
              </Field>
              <Field label="Audience country">
                <Input value={form.audienceCountry} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("audienceCountry", e.target.value)} />
              </Field>
            </FieldRow>
            <Field label="Niche">
              <Input value={form.niche} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("niche", e.target.value)} />
            </Field>
          </div>
        </ModalSection>
        <ModalSection>
          <Field label="Notes">
            <textarea id="edit-creator-notes" className="ui-textarea" rows={3} value={form.notes} onChange={e => set("notes", e.target.value)} />
          </Field>
        </ModalSection>
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
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [showAddSocial, setShowAddSocial] = useState(false);
  const [addSocialForm, setAddSocialForm] = useState({ platform: "INSTAGRAM", handle: "" });
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
        }),
      });
      if (res.ok) {
        setShowAddSocial(false);
        setAddSocialForm({ platform: "INSTAGRAM", handle: "" });
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

  const deleteCreator = async () => {
    if (!creator || deleting) return;
    const posts = creator._count.posts;
    const ok = await confirm({
      verb: "delete",
      subject: creator.name,
      description:
        "They come off the roster and out of every list, and their profiles stop refreshing. " +
        (posts > 0
          ? `Their ${formatFull(posts)} ${posts === 1 ? "post stays" : "posts stay"} in the campaigns they ran in. `
          : "") +
        "This can't be undone.",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/creators/${id}`, { method: "DELETE" });
      if (res.status === 403) throw new Error("Your role can't delete creators. Ask an admin or manager.");
      if (!res.ok && res.status !== 404) throw new Error("Couldn't delete this creator. Try again.");
      toast.success(`${creator.name} deleted`);
      router.push("/creators");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete this creator. Try again.");
      setDeleting(false);
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
    { label: "Social accounts", value: "social" },
  ];

  if (loading) return <LoadingSkeleton />;
  if (!creator) return (
    <div className="rsp-page">
      <NotFoundState
        icon={<User size={32} />}
        title="Creator not found"
        description="This creator doesn't exist or has been removed from your roster."
        primary={{ href: "/creators", label: "Back to creators" }}
      />
    </div>
  );

  /* "Unknown" is never shown as 0 (plan A1). The primary account's read is the
     one that writes followersCount, so its stamp and its problem explain a
     missing count; the tracker's own attempt is the fallback. */
  const primaryLink = creator.profileLinks?.find((l) => l.isPrimary) ?? null;
  const ownFollowers = followersValue(creator.followersCount, {
    readError: primaryLink?.problem ? handleProblemText(primaryLink.platform, primaryLink.handle, primaryLink.problem) : null,
    lastError: creator.trackerLastError ?? null,
    attemptedAt: primaryLink?.refreshedAt ?? creator.trackerLastAttemptAt ?? null,
  });
  /* The account chips in the header show each linked account's own count, so
     a merged person read "TikTok · 5,000" there and "— not known" on this tile:
     the merge kept the primary account's imported count on the link and left
     the creator's own field empty. When the creator's field is unknown, the
     tile takes the primary account's count with that account's own age (which
     says "not read by us yet" when nothing read it). With no primary count,
     the reason names what the other accounts hold rather than contradicting
     them in silence. */
  const primaryHeld =
    isUnknownMetric(ownFollowers) && primaryLink && (primaryLink.followersCount ?? 0) > 0 ? primaryLink : null;
  const otherCounts = isUnknownMetric(ownFollowers) && !primaryHeld
    ? (creator.profileLinks ?? [])
        .filter((l) => (l.followersCount ?? 0) > 0)
        .map((l) => `${platformLabel(l.platform)} · ${formatNumber(l.followersCount ?? 0)}`)
    : [];
  const followers = primaryHeld
    ? (primaryHeld.followersCount as number)
    : otherCounts.length > 0 && isUnknownMetric(ownFollowers)
      ? unknownMetric(
          `${ownFollowers.reason} The primary account has no count; other linked accounts hold ${otherCounts.join(", ")}, shown on their chips.`,
        )
      : ownFollowers;
  /* Over the posts that were read, never over the zeroes of the ones that were
     not -- see creatorEngagementValue. */
  const avgEngagement = creatorEngagementValue(creator.posts);
  const percent = (n: number) => `${n.toFixed(1)}%`;
  /* Ages for the tiles (plan A6). Followers: the read that produced the count,
     decided on the server. Engagement: the newest read among the posts it is
     averaged over -- an average of posts read at different times has no single
     age, so it is labelled as the newest one and never called stale. */
  const followersAt = primaryHeld ? primaryHeld.age ?? null : creator.figureTimes?.followers ?? null;
  const engagementAsOf = dataAsOf(creator.posts.map((p) => p.lastSyncedAt));
  /* Only the facts that are filled in; an empty one is not a fact. */
  const profileFacts = (
    [
      ["Price per video", creator.rate ? formatFullCurrency(creator.rate) : null],
      ["Email", creator.contactEmail],
      ["Country", creator.detail?.country],
      ["Audience", creator.detail?.audienceCountry],
      ["Niche", creator.detail?.niche],
    ] as [string, string | null | undefined][]
  ).filter((f): f is [string, string] => Boolean(f[1]));

  return (
    <div className="rsp-page">
      <style>{responsiveStyles}</style>

      {/* The band, not a hero card: the KPI tiles below were cards inside the
          header's card, and the platform wash under the name was a grey
          gradient in light and nothing at all in dark. The account chips are
          the platform when there are any, so they take the badge's place. */}
      <PageHeader
        title={creator.name}
        back={{ href: "/creators", label: "Creator Roster" }}
        leading={<CreatorAvatar id={creator.id} name={creator.name} size="md" />}
        badges={
          creator.profileLinks && creator.profileLinks.length > 0 ? (
            <PlatformChips links={creator.profileLinks} />
          ) : (
            <PlatformTag platform={creator.platform} />
          )
        }
        meta={
          <>
            <span>{creator.handle.startsWith("@") ? creator.handle : `@${creator.handle}`}</span>
            {creator.contactEmail && <span>{creator.contactEmail}</span>}
            {creator.detail?.source && <span>Joined via {joinedVia(creator.detail.source)}</span>}
            {creator.detail?.signedUpAt && <span>Signed up {formatDateAbs(creator.detail.signedUpAt)}</span>}
          </>
        }
        actions={
          <>
            <Button variant="secondary" iconLeft={<Pencil size={16} />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <MoreMenu
              label={`More actions for ${creator.name}`}
              items={[
                { label: "Merge duplicate", icon: <Combine size={15} />, onClick: () => setMergeOpen(true) },
                { label: deleting ? "Deleting…" : "Delete creator", icon: <Trash2 size={15} />, onClick: deleteCreator, disabled: deleting, danger: true },
              ]}
            />
          </>
        }
      />

      {creator.profileLinks?.some((l) => l.problem) && (
        <div className="cc-handle-fixes" style={{ marginTop: 0, marginBottom: 16 }}>
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
      <div className="cc-tiles-balanced cd-stats">
        <MetricTile
          metric="followers"
          icon={Users}
          value={<MetricFigure value={followers} format={formatNumber} breakable />}
          footer={
            followersAt && !isUnknownMetric(followers) ? (
              <>
                <AgeLabel
                  at={followersAt.at}
                  field={followersAt.field}
                  source={primaryHeld ? `${platformLabel(primaryHeld.platform)} account, as on its chip` : followersAt.source}
                  never={primaryHeld ? `${platformLabel(primaryHeld.platform)} account · ${followersAt.missing}` : followersAt.missing}
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
        <MetricTile metric="creatorCampaigns" icon={Megaphone} value={String(creator.campaignCount)} />
        <MetricTile metric="posts" label="Posts" icon={ImageIcon} value={formatNumber(creator._count.posts)} />
        <MetricTile
          metric="engagementRate"
          icon={Activity}
          label="Avg engagement"
          value={<MetricFigure value={avgEngagement} format={percent} breakable />}
          footer={
            !isUnknownMetric(avgEngagement) ? (
              <AgeLabel at={engagementAsOf} field="post" ctx={{ tracked: false }} prefix="Newest read" source="Tracked posts" never="no post read by us yet" />
            ) : undefined
          }
        />
      </div>

      {/* Tabs */}
      <StatusTabs
        ariaLabel={`${creator.name}'s details`}
        idBase="creator"
        tabs={tabsList.map((t) => ({ key: t.value, label: t.label, count: t.count }))}
        active={activeTab}
        onChange={(key) => setActiveTab(key as Tab)}
        style={{ marginBottom: 24 }}
      />

      <motion.div
        key={activeTab}
        role="tabpanel"
        id="creator-panel"
        aria-labelledby={`creator-tab-${activeTab}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="cd-profile">
            <div className="cd-profile-col">
              <SectionCard icon={User} title="About">
                {/* Their bio or nothing. The fallback was a sentence nobody wrote,
                    printed where the creator's own words go. */}
                {creator.bio?.trim() ? <p className="cd-bio">{creator.bio}</p> : <p className="cd-empty-line">No bio.</p>}
                {profileFacts.length > 0 ? (
                  <dl className="cd-facts">
                    {profileFacts.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </SectionCard>
              <SectionCard icon={StickyNote} title="Notes">
                {creator.notes?.trim() ? <p className="cd-bio">{creator.notes}</p> : <p className="cd-empty-line">No notes yet.</p>}
              </SectionCard>
            </div>
            <div className="cd-profile-col">
              <LabelCard
                creatorId={id}
                kind="tags"
                title="Tags"
                emptyLabel="No tags yet."
                addLabel="Add tag"
                selected={(creator.tagLinks ?? []).map((l) => l.tag)}
                onSaved={refreshCreator}
              />
              <LabelCard
                creatorId={id}
                kind="flags"
                title="Flags"
                emptyLabel="No flags."
                addLabel="Flag creator"
                selected={(creator.flagLinks ?? []).map((l) => l.flag)}
                onSaved={refreshCreator}
              />
              <ListsCard creatorId={id} lists={creator.lists ?? []} onSaved={refreshCreator} />
            </div>
          </div>
        )}
        {activeTab === "profile" && (
          <>
            <InstagramDiscoveryPanel creatorId={id} />
            <InstagramInsightsPanel
              url={`/api/creators/${encodeURIComponent(id)}/instagram-insights`}
              hideWhen={["not_connected"]}
              title="Instagram account insights"
              subtitle="From the Instagram professional account this creator connected to your campaigns."
            />
          </>
        )}

        {/* Posts Tab */}
        {activeTab === "posts" && (
          creator.posts.length === 0 ? (
            <EmptyState icon={<Video size={32} color="var(--cc-text-subtle)" />} title="No posts yet" description="Posts will appear here when synced from social platforms." />
          ) : (
            <DataTable caption={`${creator.name}'s posts`} columns={POST_COLUMNS} rows={creator.posts} rowKey={(p) => p.id} />
          )
        )}

        {/* Campaigns Tab */}
        {activeTab === "campaigns" && (
          /* Driven by creator.campaigns, not creator.activations. Activations did
             not import with the roster, so 1,824 of 1,834 creators had none and
             this tab said "No campaigns yet" directly under a badge reading 215. */
          (creator.campaigns ?? []).length === 0 ? (
            <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="No campaigns yet" description="This creator has no posts on, and no activation for, any campaign." />
          ) : (
            <DataTable
              caption={`Campaigns ${creator.name} is on`}
              columns={CAMPAIGN_COLUMNS}
              rows={creator.campaigns}
              rowKey={(c) => c.id}
              rowHref={(c) => `/campaigns/${c.id}`}
            />
          )
        )}

        {/* Social Accounts Tab */}
        {activeTab === "social" && (
          <div>
            <div className="cd-section-head">
              <h2>Social accounts</h2>
              {!showAddSocial && (
                <Button variant="secondary" size="sm" iconLeft={<Plus size={16} />} onClick={() => setShowAddSocial(true)}>
                  Add account
                </Button>
              )}
            </div>

            {/* Add form */}
            {showAddSocial && (
              <Card variant="outlined" style={{ marginBottom: 16 }}>
                <form
                  className="cc-dialog-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleAddSocial();
                  }}
                >
                  <FieldRow>
                    <Field label="Platform">
                      <Dropdown
                        id="add-social-platform"
                        align="left"
                        fullWidth
                        value={addSocialForm.platform}
                        onChange={v => setAddSocialForm(prev => ({ ...prev, platform: v }))}
                        options={PLATFORM_OPTIONS}
                      />
                    </Field>
                    <Field label="Handle" required helper="Followers and views are read from the platform, not typed in.">
                      <Input
                        value={addSocialForm.handle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, handle: e.target.value }))}
                        placeholder="@username"
                      />
                    </Field>
                  </FieldRow>
                  {/* No Followers / Avg Views inputs: an account's figures come
                      from the platform, never typed in (Pratham, 2026-10-13). */}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddSocial(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" loading={addingSocial} disabled={!addSocialForm.handle.trim()}>
                      Add account
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {socialLoading ? (
              <div className="cd-social-grid">
                {[1, 2, 3].map(i => <Skeleton key={i} height={140} radius="var(--cc-r-card)" />)}
              </div>
            ) : socialAccounts.length === 0 ? (
              <EmptyState icon={<Link2 size={32} color="var(--cc-text-subtle)" />} title="No social accounts" description="Link social media accounts to track cross-platform presence." />
            ) : (
              <div className="cd-social-grid">
                {socialAccounts.map(acct => (
                  <Card key={acct.id} variant="outlined">
                    {(() => {
                      const followers = followersValue(acct.followersCount);
                      const avgViews = avgViewsValue(acct.avgViews);
                      const figures = [
                        { key: "followers", label: acct.platform === "YOUTUBE" ? "Subscribers" : "Followers", value: followers },
                        { key: "views", label: "Avg views", value: avgViews },
                      ].filter((f) => !isUnknownMetric(f.value));
                      const firstUnknown = [followers, avgViews].find(isUnknownMetric);
                      return (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <PlatformTile platform={acct.platform} size={40} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: "var(--cc-t-12)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text-muted)" }}>
                                {platformLabel(acct.platform)}
                              </div>
                              <div style={{ fontWeight: 700, fontSize: "var(--cc-t-15)", color: "var(--cc-text)", overflowWrap: "anywhere" }}>
                                {acct.handle.startsWith("@") ? acct.handle : `@${acct.handle}`}
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveSocial(acct.id)}
                              disabled={removingSocial === acct.id}
                              aria-busy={removingSocial === acct.id}
                              aria-label={`Remove ${platformLabel(acct.platform)} account ${acct.handle}`}
                              style={{
                                alignSelf: "flex-start",
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
                          {/* Only the figures we have. Both columns default to 0 on a
                              connected account, so an unknown one is left out and the
                              reason is said once, instead of a row of dashes. */}
                          {figures.length > 0 ? (
                            <dl className="cd-facts" style={{ marginTop: 16 }}>
                              {figures.map(({ key, label, value }) => (
                                <div key={key}>
                                  <dt>{label}</dt>
                                  <dd data-figure="">
                                    <MetricFigure value={value} format={formatNumber} breakable />
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            firstUnknown && (
                              <p style={{ margin: "14px 0 0", fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", lineHeight: 1.45 }}>
                                {firstUnknown.reason}
                              </p>
                            )
                          )}
                          {/* The account's own statistics are read daily (plan A6); one
                              entered by hand has never been read, and says so. "Connected"
                              only for a creator's own connection; a handle the agency
                              typed in was added, nobody connected anything. */}
                          <div className="cd-account-foot">
                            <span>
                              <RefreshCw size={12} aria-hidden="true" />
                              <AgeLabel at={acct.statsSyncedAt ?? null} field="account" prefix="Read" source="Connected account" never="never read by us" />
                            </span>
                            <span>
                              {acct.addedByHand ? <Plus size={12} aria-hidden="true" /> : <Link2 size={12} aria-hidden="true" />}
                              {acct.addedByHand ? "Added" : "Connected"} {formatDateAbs(acct.createdAt)}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </Card>
                ))}
              </div>
            )}

            <CreatorAccess creatorId={id} />

            {socialAccounts.some(a => a.platform === "TIKTOK") && tiktokNotConnected === false && (
              <div style={{ marginTop: 32 }}>
                <div className="cd-section-head" style={{ marginBottom: 4 }}>
                  <h2>TikTok posts</h2>
                  <Button variant="secondary" size="sm" iconLeft={<RefreshCw size={16} />} loading={tiktokLoading} onClick={fetchTikTokVideos}>
                    Refresh
                  </Button>
                </div>
                <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: "0 0 16px" }}>
                  Public posts and their performance, read from TikTok with the creator&rsquo;s permission.
                </p>
                {tiktokLoading ? (
                  <div className="cd-social-grid">
                    {[1, 2, 3].map(i => <Skeleton key={i} height={200} radius="var(--cc-r-card)" />)}
                  </div>
                ) : tiktokError ? (
                  <EmptyState icon={<Video size={32} color="var(--cc-text-subtle)" />} title="Could not load TikTok posts" description={tiktokError} />
                ) : tiktokVideos.length === 0 ? (
                  <EmptyState icon={<Video size={32} color="var(--cc-text-subtle)" />} title="No public posts yet" description="This creator has not published any public TikTok videos." />
                ) : (
                  <div className="cd-social-grid">
                    {tiktokVideos.map(video => (
                      <Card key={video.id} variant="outlined" noPadding style={{ overflow: "hidden" }}>
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
