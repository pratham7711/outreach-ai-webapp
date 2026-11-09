"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, ModalNotice, ModalSection } from "@/components/ds/Modal";
import { AlertCircle, ExternalLink, Copy, Mail, MessageCircle, Search, Instagram, Youtube, Sparkles, Trash2 } from "lucide-react";
import { PageHeader, Button, LoadError } from "@/components/ds";
import { formatCompact, formatDateAbs } from "@/lib/format";
import {
  DISMISS_REASONS,
  INSTAGRAM_AI_WAITING,
  PROSPECT_STATUS_LABEL,
  instagramDmUrl,
  profileUrl,
  type DismissReason,
  type ProspectStatus,
} from "@/lib/creatorFinder/prospects";
import type { ContactRoute } from "@/lib/creatorFinder/contactRoutes";

type ProspectEvent = { fromStatus: string | null; toStatus: string; at: string; userId: string | null };
type Prospect = {
  id: string;
  platform: "INSTAGRAM" | "YOUTUBE";
  handle: string;
  channelId: string | null;
  status: ProspectStatus;
  source: string;
  note: string | null;
  dismissReason: DismissReason | null;
  createdAt: string;
  statusChangedAt: string;
  events: ProspectEvent[];
  aiTags: { tags: AiTag[]; model: string; at: string } | null;
};

type ProspectPatch = {
  status?: ProspectStatus;
  note?: string | null;
  dismissReason?: DismissReason;
  rejectTag?: { kind: string; label: string };
};

type AiTag = { kind: "content" | "language" | "city" | "brand_safety"; label: string; source: string };
type AiState = { on: boolean; instagram: boolean; code: string | null; reason: string | null };
const AI_OFF: AiState = { on: false, instagram: false, code: "ai_off", reason: null };

type JoinableCampaign = { id: string; title: string; joinPath: string };
type CampaignsRead = { campaigns: JoinableCampaign[]; otherOpen: number } | { failed: string };

const tagKey = (t: { kind: string; label: string }) => `${t.kind}:${t.label}`;

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; code: string; reason: string };

const BOARD: ProspectStatus[] = ["FOUND", "CONTACTED", "REPLIED", "JOINED"];
const NEXT: Partial<Record<ProspectStatus, ProspectStatus>> = { FOUND: "CONTACTED", CONTACTED: "REPLIED", REPLIED: "JOINED" };

const TEMPLATE_KEY = "creatorFinder.template";
const DEFAULT_TEMPLATE =
  "Hi {name}! We've been enjoying your {platform} posts and think you'd be a great fit for a few songs we're working on. Would you be open to a paid collab? Reply here and we'll send the details.";

function readTemplate(): string {
  try {
    return window.localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

function saveTemplate(value: string) {
  try {
    window.localStorage.setItem(TEMPLATE_KEY, value);
  } catch {
    /* Private window or blocked storage: the template still works for this visit. */
  }
}

/* {campaign} and {link} come from the campaign picked under "Invite to
   campaign". A template without {link} gets the link on its own line at the
   end, so picking a campaign always puts the way in into the message. */
function fillTemplate(
  template: string,
  p: { name: string; handle: string; platform: string },
  campaign?: { title: string; url: string } | null,
): string {
  const out = template
    .replaceAll("{name}", p.name)
    .replaceAll("{handle}", `@${p.handle}`)
    .replaceAll("{platform}", p.platform === "YOUTUBE" ? "YouTube" : "Instagram")
    .replaceAll("{campaign}", campaign?.title ?? "our campaign");
  if (!campaign) return out.replaceAll("{link}", "").trim();
  return out.includes("{link}") ? out.replaceAll("{link}", campaign.url) : `${out}\n\n${campaign.url}`;
}

type BoardRead = { prospects: Prospect[]; ai: AiState } | { failed: Extract<LoadState, { kind: "error" }> };

async function readBoard(): Promise<BoardRead> {
  try {
    const res = await fetch("/api/creator-finder", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { failed: { kind: "error", code: body.error ?? String(res.status), reason: body.reason ?? "Couldn't load the board." } };
    return { prospects: body.prospects ?? [], ai: body.ai ?? AI_OFF };
  } catch {
    return { failed: { kind: "error", code: "network", reason: "Couldn't reach the server." } };
  }
}

function daysSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function PlatformIcon({ platform }: { platform: string }) {
  const Icon = platform === "YOUTUBE" ? Youtube : Instagram;
  return <Icon aria-label={platform === "YOUTUBE" ? "YouTube" : "Instagram"} style={{ width: 14, height: 14, flexShrink: 0 }} />;
}

const card: React.CSSProperties = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 12,
};

function TagChip({ tag, active, onClick }: { tag: Pick<AiTag, "kind" | "label">; active?: boolean; onClick?: () => void }) {
  const flag = tag.kind === "brand_safety";
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    border: `1px solid ${active ? "var(--cc-primary)" : "var(--cc-border)"}`,
    background: active ? "var(--cc-primary)" : "var(--cc-card)",
    color: active ? "var(--cc-on-primary)" : flag ? "var(--cc-danger-ink)" : "var(--cc-text)",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 12,
    lineHeight: "18px",
    whiteSpace: "nowrap",
  };
  const text = flag ? `⚠ ${tag.label}` : tag.label;
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={!!active} style={{ ...style, cursor: "pointer", minHeight: 28 }}>
      {text}
    </button>
  ) : (
    <span style={style}>{text}</span>
  );
}

export default function CreatorFinderBoard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  /* Only the drawer reads it, and the drawer never renders on the server. */
  const [template, setTemplate] = useState(() => (typeof window === "undefined" ? DEFAULT_TEMPLATE : readTemplate()));
  const [ai, setAi] = useState<AiState>(AI_OFF);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsRead | null>(null);
  const [campaignId, setCampaignId] = useState("");

  const apply = useCallback((read: BoardRead) => {
    if ("failed" in read) {
      setState(read.failed);
      return;
    }
    setProspects(read.prospects);
    setAi(read.ai);
    setState({ kind: "ready" });
  }, []);

  const load = useCallback(async () => apply(await readBoard()), [apply]);

  useEffect(() => {
    let live = true;
    void readBoard().then((read) => {
      if (live) apply(read);
    });
    return () => {
      live = false;
    };
  }, [apply]);

  /* Every tag on an open card, most common first: what the board can be filtered by. */
  const tagCounts = useMemo(() => {
    const counts = new Map<string, { tag: AiTag; n: number }>();
    for (const p of prospects) {
      if (p.status === "DISMISSED") continue;
      for (const t of p.aiTags?.tags ?? []) {
        const k = tagKey(t);
        counts.set(k, { tag: t, n: (counts.get(k)?.n ?? 0) + 1 });
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  }, [prospects]);
  const activeFilter = tagFilter && tagCounts.some(([k]) => k === tagFilter) ? tagFilter : null;

  const byStatus = useMemo(() => {
    const map = new Map<ProspectStatus, Prospect[]>();
    for (const p of prospects) {
      if (activeFilter && p.status !== "DISMISSED" && !(p.aiTags?.tags ?? []).some((t) => tagKey(t) === activeFilter)) continue;
      map.set(p.status, [...(map.get(p.status) ?? []), p]);
    }
    return map;
  }, [prospects, activeFilter]);

  /* Read once, the first time a card is opened: the board itself never needs it. */
  const openCard = useCallback(
    (id: string) => {
      setOpenId(id);
      if (campaigns && !("failed" in campaigns)) return;
      void fetch("/api/creator-finder/campaigns", { cache: "no-store" })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          setCampaigns(res.ok ? { campaigns: body.campaigns ?? [], otherOpen: body.otherOpen ?? 0 } : { failed: body.reason ?? "Couldn't list your campaigns." });
        })
        .catch(() => setCampaigns({ failed: "Couldn't reach the server." }));
    },
    [campaigns],
  );

  const update = useCallback(async (id: string, patch: ProspectPatch) => {
    const res = await fetch(`/api/creator-finder/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Couldn't save");
    await load();
  }, [load]);

  const open = prospects.find((p) => p.id === openId) ?? null;

  return (
    <div className="rsp-page" data-testid="creator-finder">
      <PageHeader
        title="Creator Finder"
        subtitle="Creators worth adding to your roster. Your team sends every message; nothing is sent from here."
      />

      {state.kind === "error" ? (
        <LoadError description={state.reason} onRetry={() => void load()} />
      ) : (
        <>
          <AddPanel onAdded={load} />

          {tagCounts.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "0 0 12px" }} data-testid="cf-tag-filter">
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Filter by what they make:</span>
              {tagCounts.slice(0, 16).map(([k, { tag, n }]) => (
                <TagChip key={k} tag={{ kind: tag.kind, label: `${tag.label} ${n}` }} active={activeFilter === k} onClick={() => setTagFilter(activeFilter === k ? null : k)} />
              ))}
              {activeFilter ? (
                <Button variant="ghost" size="sm" onClick={() => setTagFilter(null)}>
                  Show all
                </Button>
              ) : null}
            </div>
          ) : null}

          {state.kind === "loading" ? (
            <p style={{ color: "var(--cc-text-muted)", fontSize: 14 }}>Loading the board…</p>
          ) : prospects.length === 0 ? (
            <div style={{ ...card, padding: 24, color: "var(--cc-text-muted)", fontSize: 14 }} data-testid="cf-empty">
              No creators on the board yet. Paste handles or search YouTube above to start.
            </div>
          ) : (
            <div
              data-testid="cf-board"
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}
            >
              {BOARD.map((status) => {
                const items = byStatus.get(status) ?? [];
                return (
                  <section key={status} style={{ ...card, padding: 12 }} data-testid={`cf-col-${status}`} aria-label={PROSPECT_STATUS_LABEL[status]}>
                    <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>
                      {PROSPECT_STATUS_LABEL[status]} <span style={{ color: "var(--cc-text-muted)", fontWeight: 500 }}>{items.length}</span>
                    </h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {items.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => openCard(p.id)}
                          data-testid="cf-card"
                          style={{
                            textAlign: "left",
                            border: "1px solid var(--cc-border)",
                            borderRadius: 8,
                            background: "var(--cc-bg)",
                            padding: "8px 10px",
                            cursor: "pointer",
                            color: "var(--cc-text)",
                            minHeight: 44,
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>
                            <PlatformIcon platform={p.platform} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{p.handle}</span>
                          </span>
                          <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>
                            {status === "FOUND" ? "Added" : PROSPECT_STATUS_LABEL[status]} {daysSince(p.statusChangedAt)}
                            {daysSince(p.statusChangedAt) === "today" ? "" : " ago"}
                            {p.note ? " · has a note" : ""}
                          </span>
                          {p.aiTags?.tags.length ? (
                            <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                              {[...p.aiTags.tags]
                                .sort((a, b) => Number(b.kind === "brand_safety") - Number(a.kind === "brand_safety"))
                                .slice(0, 3)
                                .map((t) => (
                                  <TagChip key={tagKey(t)} tag={t} />
                                ))}
                            </span>
                          ) : null}
                        </button>
                      ))}
                      {items.length === 0 ? <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>None</p> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {(byStatus.get("DISMISSED") ?? []).length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <Button variant="ghost" size="sm" onClick={() => setShowDismissed((v) => !v)}>
                {showDismissed ? "Hide" : "Show"} dismissed ({(byStatus.get("DISMISSED") ?? []).length})
              </Button>
              {showDismissed ? (
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                  {(byStatus.get("DISMISSED") ?? []).map((p) => (
                    <li key={p.id} style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                      <button type="button" onClick={() => openCard(p.id)} style={{ background: "none", border: 0, padding: 0, color: "var(--cc-primary)", cursor: "pointer" }}>
                        @{p.handle}
                      </button>{" "}
                      · {p.dismissReason ? DISMISS_REASONS[p.dismissReason] : "dismissed"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {open ? (
        <ProspectDrawer
          prospect={open}
          ai={ai}
          campaigns={campaigns}
          campaignId={campaignId}
          onCampaignChange={setCampaignId}
          template={template}
          onTemplateChange={(v) => {
            setTemplate(v);
            saveTemplate(v);
          }}
          onClose={() => setOpenId(null)}
          onUpdate={(patch) => update(open.id, patch)}
          onReload={load}
          onRemove={async () => {
            await fetch(`/api/creator-finder/${open.id}`, { method: "DELETE" });
            setOpenId(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

type YouTubeHit = {
  channelId: string;
  handle: string | null;
  title: string;
  thumbnailUrl: string | null;
  country: string | null;
  subscribers?: number;
  videos?: number;
  onBoard: boolean;
  onRoster: boolean;
};

function AddPanel({ onAdded }: { onAdded: () => Promise<void> }) {
  const [tab, setTab] = useState<"paste" | "youtube">("paste");
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<"INSTAGRAM" | "YOUTUBE">("INSTAGRAM");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [hits, setHits] = useState<YouTubeHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function add(payload: { text: string; platform: "INSTAGRAM" | "YOUTUBE"; source: string }) {
    setBusy(true);
    setSummary(null);
    try {
      const res = await fetch("/api/creator-finder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSummary(body.reason ?? body.error ?? "Couldn't add those.");
        return false;
      }
      const parts = [`Added ${body.added}.`];
      if (body.alreadyOnBoard?.length) parts.push(`Already on the board: ${body.alreadyOnBoard.join(", ")}.`);
      if (body.onRoster?.length) parts.push(`Already on your roster: ${body.onRoster.join(", ")}.`);
      if (body.skipped?.length)
        parts.push(`Skipped ${body.skipped.length}: ${body.skipped.map((s: { input: string; reason: string }) => `${s.input} (${s.reason})`).join("; ")}.`);
      if (body.overLimit) parts.push(`${body.overLimit} more were over the 100-per-paste limit.`);
      setSummary(parts.join(" "));
      await onAdded();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    setSearchError(null);
    setHits(null);
    setBusy(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (region.trim()) params.set("region", region.trim());
      const res = await fetch(`/api/creator-finder/youtube-search?${params}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSearchError(body.reason ?? body.error ?? "Search failed.");
        return;
      }
      setHits(body.results ?? []);
    } finally {
      setBusy(false);
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    border: 0,
    borderBottom: `2px solid ${active ? "var(--cc-primary)" : "transparent"}`,
    background: "none",
    padding: "8px 4px",
    marginRight: 16,
    fontSize: 14,
    fontWeight: 600,
    color: active ? "var(--cc-text)" : "var(--cc-text-muted)",
    cursor: "pointer",
  });

  return (
    <div style={{ ...card, padding: 16, marginBottom: 16 }} data-testid="cf-add">
      <div role="tablist" style={{ borderBottom: "1px solid var(--cc-border)", marginBottom: 12 }}>
        <button role="tab" aria-selected={tab === "paste"} style={tabStyle(tab === "paste")} onClick={() => setTab("paste")}>
          Paste handles
        </button>
        <button role="tab" aria-selected={tab === "youtube"} style={tabStyle(tab === "youtube")} onClick={() => setTab("youtube")}>
          Search YouTube
        </button>
      </div>

      {tab === "paste" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="cf-paste" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Handles or profile links, one per line or separated by commas. Up to 100 at a time.
          </label>
          <textarea
            id="cf-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={"@creator_one\nhttps://www.instagram.com/creator_two/\nhttps://www.youtube.com/@channel"}
            style={{ width: "100%", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 10, fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
              Bare handles are{" "}
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as "INSTAGRAM" | "YOUTUBE")}
                style={{ border: "1px solid var(--cc-border)", borderRadius: 6, padding: "4px 6px", color: "var(--cc-text)", background: "var(--cc-card)" }}
              >
                <option value="INSTAGRAM">Instagram</option>
                <option value="YOUTUBE">YouTube</option>
              </select>
            </label>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!text.trim()}
              onClick={async () => {
                if (await add({ text, platform, source: "PASTE" })) setText("");
              }}
            >
              Add to Found
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) void search();
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <input
              aria-label="Search YouTube channels"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "phonk car edit" or "passinho funk"'
              style={{ flex: "1 1 240px", border: "1px solid var(--cc-border)", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)" }}
            />
            <input
              aria-label="Country code"
              value={region}
              onChange={(e) => setRegion(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="Country, e.g. BR"
              style={{ width: 130, border: "1px solid var(--cc-border)", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)" }}
            />
            <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!query.trim()}>
              <Search style={{ width: 14, height: 14, marginRight: 4 }} />
              Search
            </Button>
          </form>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
            YouTube allows about 100 searches a day across the whole app, so search with specific phrases.
          </p>
          {searchError ? <p style={{ fontSize: 13, color: "var(--cc-danger-ink)", margin: 0 }}>{searchError}</p> : null}
          {hits ? (
            hits.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>No channels matched.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }} data-testid="cf-yt-results">
                {hits.map((h) => (
                  <li key={h.channelId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--cc-border)" }}>
                    {h.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.thumbnailUrl} alt="" width={36} height={36} style={{ borderRadius: "50%", flexShrink: 0 }} />
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</div>
                      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                        {h.handle ? `@${h.handle}` : h.channelId}
                        {h.subscribers !== undefined ? ` · ${formatCompact(h.subscribers)} subscribers` : " · subscribers hidden"}
                        {h.videos !== undefined ? ` · ${formatCompact(h.videos)} videos` : ""}
                        {h.country ? ` · ${h.country}` : ""}
                      </div>
                    </div>
                    {h.onRoster ? (
                      <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>On roster</span>
                    ) : h.onBoard ? (
                      <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>On board</span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await add({
                            text: h.handle ? `https://www.youtube.com/@${h.handle}` : `https://www.youtube.com/channel/${h.channelId}`,
                            platform: "YOUTUBE",
                            source: "YOUTUBE_SEARCH",
                          });
                          if (ok) setHits((prev) => prev?.map((x) => (x.channelId === h.channelId ? { ...x, onBoard: true } : x)) ?? null);
                        }}
                      >
                        Add
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      )}

      {summary ? (
        <p role="status" style={{ fontSize: 13, color: "var(--cc-text)", margin: "10px 0 0" }} data-testid="cf-add-summary">
          {summary}
        </p>
      ) : null}
    </div>
  );
}

type ProfileResponse =
  | {
      platform: "INSTAGRAM";
      instagram: {
        username: string;
        name: string | null;
        biography: string | null;
        website: string | null;
        profilePictureUrl: string | null;
        followers?: number;
        following?: number;
        posts?: number;
        media: Array<{ id: string; caption: string | null; permalink: string | null; thumbnailUrl: string | null; postedAt: string | null; views?: number; likes?: number; comments?: number }>;
      };
      contactRoutes: ContactRoute[];
      via: { username: string | null };
      readAt: string;
    }
  | {
      platform: "YOUTUBE";
      youtube: {
        channelId: string;
        handle: string | null;
        title: string;
        description: string | null;
        thumbnailUrl: string | null;
        country: string | null;
        subscribers?: number;
        videos?: number;
        recent: Array<{ id: string; title: string; publishedAt: string | null; views?: number }>;
      };
      contactRoutes: ContactRoute[];
      readAt: string;
    };

type AiRead = {
  tags: Array<AiTag & { quote: string; sourceLabel: string }>;
  contacts: Array<{ kind: string; value: string; quote: string; sourceLabel: string }>;
  dropped: number;
  model: string;
  at: string;
};
type AiDraft = { subject: string; body: string; dropped: number; model: string };

/* The text a stored tag points at, from the live read: the bio, or one post. */
function sourceOf(profile: ProfileResponse | null, source: string): { label: string; text: string } | null {
  if (!profile) return null;
  if (profile.platform === "INSTAGRAM") {
    if (source === "bio") return { label: "Bio", text: profile.instagram.biography ?? "" };
    const m = profile.instagram.media.find((x) => `post:${x.id}` === source);
    return m?.caption ? { label: "Post caption", text: m.caption } : null;
  }
  if (source === "bio") return { label: "Channel description", text: profile.youtube.description ?? profile.youtube.title };
  const v = profile.youtube.recent.find((x) => `post:${x.id}` === source);
  return v ? { label: "Video title", text: v.title } : null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ProspectDrawer({
  prospect,
  ai,
  campaigns,
  campaignId,
  onCampaignChange,
  template,
  onTemplateChange,
  onClose,
  onUpdate,
  onReload,
  onRemove,
}: {
  prospect: Prospect;
  ai: AiState;
  campaigns: CampaignsRead | null;
  campaignId: string;
  onCampaignChange: (id: string) => void;
  template: string;
  onTemplateChange: (v: string) => void;
  onClose: () => void;
  onUpdate: (patch: ProspectPatch) => Promise<void>;
  onReload: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [note, setNote] = useState(prospect.note ?? "");
  const [dismissReason, setDismissReason] = useState<DismissReason | "">("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [aiRead, setAiRead] = useState<AiRead | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiBusy, setAiBusy] = useState<"read" | "draft" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setProfileError(null);
    fetch(`/api/creator-finder/${prospect.id}/profile`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setProfileError(body.reason ?? "Couldn't read this profile.");
        else setProfile(body);
      })
      .catch(() => alive && setProfileError("Couldn't reach the server."));
    return () => {
      alive = false;
    };
  }, [prospect.id]);

  const displayName =
    profile?.platform === "INSTAGRAM" ? profile.instagram.name ?? `@${prospect.handle}` : profile?.platform === "YOUTUBE" ? profile.youtube.title : `@${prospect.handle}`;
  const joinable = campaigns && !("failed" in campaigns) ? campaigns.campaigns : [];
  const picked = joinable.find((c) => c.id === campaignId) ?? null;
  const pickedLink = picked ? { title: picked.title, url: new URL(picked.joinPath, window.location.origin).toString() } : null;
  const who = { name: displayName, handle: prospect.handle, platform: prospect.platform };
  const message = fillTemplate(template, who, pickedLink);
  const outgoing = aiDraft ? aiDraft.body : message;
  const email =
    profile?.contactRoutes.find((r) => r.kind === "email")?.value ?? aiRead?.contacts.find((c) => c.kind === "email")?.value ?? null;

  /* Why the AI buttons are unavailable for this card, if they are. */
  const aiBlocked = !ai.on
    ? ai.reason ?? "Scout's AI is off."
    : prospect.platform === "INSTAGRAM" && !ai.instagram
      ? INSTAGRAM_AI_WAITING
      : profileError
        ? "The AI reads the same profile, which couldn't be read just now."
        : !profile
          ? "Waiting for the profile…"
          : null;

  async function callAi(task: "read" | "draft") {
    setAiBusy(task);
    setAiError(null);
    try {
      const res = await fetch(`/api/creator-finder/${prospect.id}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(task === "read" ? { task } : { task, example: fillTemplate(template, who), campaignId: picked?.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(body.reason ?? "The AI didn't answer just now.");
        return;
      }
      if (task === "read") {
        setAiRead(body);
        await onReload();
      } else setAiDraft(body);
    } catch {
      setAiError("Couldn't reach the server.");
    } finally {
      setAiBusy(null);
    }
  }

  const aiAt = aiRead?.at ?? prospect.aiTags?.at ?? null;
  const shownTags: Array<AiTag & { quote: string | null; sourceLabel: string | null }> = aiRead
    ? aiRead.tags
    : (prospect.aiTags?.tags ?? []).map((t) => {
        const src = sourceOf(profile, t.source);
        return { ...t, quote: src ? src.text : null, sourceLabel: src?.label ?? null };
      });

  async function run(patch: Parameters<typeof onUpdate>[0]) {
    setSaving(true);
    setActionError(null);
    try {
      await onUpdate(patch);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const next = NEXT[prospect.status];

  return (
    <Modal
      open
      onClose={onClose}
      icon={prospect.platform === "YOUTUBE" ? Youtube : Instagram}
      title={`@${prospect.handle}`}
      description={
        <>
          {`${prospect.platform === "YOUTUBE" ? "YouTube" : "Instagram"} · ${PROSPECT_STATUS_LABEL[prospect.status]} since ${formatDateAbs(prospect.statusChangedAt)} · `}
          <a href={profileUrl(prospect)} target="_blank" rel="noreferrer" style={{ color: "var(--cc-primary)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open profile <ExternalLink style={{ width: 12, height: 12 }} aria-hidden />
          </a>
        </>
      }
      size="lg"
      footer={
        <div className="cc-modal-footer" data-layout="split">
          <Button
            variant="ghost"
            size="sm"
            className="cc-btn-danger-ghost"
            iconLeft={<Trash2 size={16} aria-hidden="true" />}
            onClick={() => void onRemove()}
          >
            Remove from the board
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div data-testid="cf-drawer">
        <section aria-label="Profile" className="cc-dialog-section">
          {profileError ? (
            <p style={{ fontSize: 14, color: "var(--cc-text)" }} data-testid="cf-profile-error">
              {profileError}
            </p>
          ) : !profile ? (
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Reading the profile live…</p>
          ) : profile.platform === "INSTAGRAM" ? (
            <InstagramProfile data={profile} />
          ) : (
            <YouTubeProfile data={profile} />
          )}
        </section>

        {profile ? (
          <ModalSection title="How to reach them">
            {aiRead?.contacts.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cc-text)" }} data-testid="cf-ai-contacts">
                {aiRead.contacts.map((c) => (
                  <li key={`${c.kind}:${c.value}`}>
                    <b>{c.kind[0].toUpperCase() + c.kind.slice(1)}:</b> {c.value}{" "}
                    <span style={{ color: "var(--cc-text-muted)" }}>
                      — AI-found in the {c.sourceLabel.toLowerCase()}: “{clip(c.quote, 120)}”
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {profile.contactRoutes.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
                Their profile lists no email, link or booking route.{prospect.platform === "INSTAGRAM" ? " An Instagram DM is the only way in." : ""}
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cc-text)" }} data-testid="cf-routes">
                {profile.contactRoutes.map((r) => (
                  <li key={`${r.kind}:${r.value}`}>
                    <b>{r.kind === "email" ? "Email" : r.kind === "link" ? "Link" : r.kind === "whatsapp" ? "WhatsApp" : "DM"}:</b>{" "}
                    {r.kind === "dm" ? "they ask for DMs" : r.value} <span style={{ color: "var(--cc-text-muted)" }}>— from “{r.quote}”</span>
                  </li>
                ))}
              </ul>
            )}
          </ModalSection>
        ) : null}

        <ModalSection title="What they make">
          {shownTags.length ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }} data-testid="cf-tags">
              {shownTags.map((t) => (
                <li key={tagKey(t)} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
                  <TagChip tag={t} />
                  <span style={{ color: "var(--cc-text-muted)", flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
                    {t.quote
                      ? `${t.sourceLabel ? `${t.sourceLabel}: ` : ""}“${clip(t.quote, 140)}”`
                      : !profile
                        ? `From their ${t.source === "bio" ? "bio" : "recent posts"}${profileError ? "; the profile can't be read just now to show it" : ""}`
                        : "from a post that is no longer in their recent posts"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      setAiRead((r) => (r ? { ...r, tags: r.tags.filter((x) => tagKey(x) !== tagKey(t)) } : r));
                      try {
                        await onUpdate({ rejectTag: { kind: t.kind, label: t.label } });
                      } catch (e) {
                        setAiError(e instanceof Error ? e.message : "Couldn't save");
                      }
                    }}
                  >
                    Wrong
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
              {prospect.aiTags ? "The AI found nothing it could quote from their profile." : "Not read yet. The AI tags what they make from their bio and recent posts, quoting each one."}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" size="sm" loading={aiBusy === "read"} disabled={!!aiBlocked || aiBusy !== null} onClick={() => void callAi("read")} data-testid="cf-ai-read">
              <Sparkles style={{ width: 14, height: 14, marginRight: 4 }} />
              {prospect.aiTags ? "Read again with AI" : "Read profile with AI"}
            </Button>
            {aiBlocked && aiBlocked !== "Waiting for the profile…" ? (
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }} data-testid="cf-ai-blocked">
                {aiBlocked}
              </span>
            ) : null}
          </div>
          {aiAt ? (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
              AI-read {formatDateAbs(aiAt)} by {aiRead?.model ?? prospect.aiTags?.model}
              {aiRead?.dropped ? ` · ${plural(aiRead.dropped, "answer", "answers")} it couldn't quote from the profile left out` : ""}. Mark a tag
              wrong and it won&apos;t come back.
            </p>
          ) : null}
          {aiError ? (
            <ModalNotice tone="danger" icon={AlertCircle}>
              {aiError}
            </ModalNotice>
          ) : null}
        </ModalSection>

        <ModalSection title="First message">
          {/* The picker only when there is a campaign to pick; with none, the
              line below says why and how to get one. */}
          {joinable.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor="cf-campaign" style={{ fontSize: 13, color: "var(--cc-text)" }}>
                Invite to campaign
              </label>
              <select
                id="cf-campaign"
                value={picked ? picked.id : ""}
                onChange={(e) => {
                  onCampaignChange(e.target.value);
                  setAiDraft(null);
                }}
                style={{ border: "1px solid var(--cc-border)", borderRadius: 6, padding: "4px 6px", fontSize: 13, color: "var(--cc-text)", background: "var(--cc-card)", maxWidth: "100%" }}
              >
                <option value="">No link</option>
                {joinable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          {campaigns === null ? null : "failed" in campaigns ? (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>{campaigns.failed}</p>
          ) : joinable.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }} data-testid="cf-no-joinable">
              {campaigns.otherOpen
                ? `${plural(campaigns.otherOpen, "open campaign has", "open campaigns have")} no join link.`
                : "No open campaign has a join link."}{" "}
              On a campaign&apos;s page, under Marketplace, set Visibility to Invite only to get one.
            </p>
          ) : picked ? (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
              When they join through the link they&apos;re added to your roster, and this card moves to Joined.
            </p>
          ) : null}
          {editingTemplate ? (
            <>
              <textarea
                aria-label="Message template"
                value={template}
                onChange={(e) => onTemplateChange(e.target.value)}
                rows={4}
                style={{ width: "100%", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 10, fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)" }}
              />
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "4px 0 0" }}>
                {"{name}"}, {"{handle}"}, {"{platform}"}, {"{campaign}"} and {"{link}"} are filled in for each creator. Saved in this browser.
              </p>
            </>
          ) : aiDraft ? (
            <>
              <textarea
                aria-label="AI draft"
                data-testid="cf-ai-draft"
                value={aiDraft.body}
                onChange={(e) => setAiDraft({ ...aiDraft, body: e.target.value })}
                rows={7}
                style={{ width: "100%", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 10, fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)" }}
              />
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "4px 0 0" }}>
                AI draft by {aiDraft.model}, from their profile only. Read it before sending.
                {aiDraft.dropped ? ` ${plural(aiDraft.dropped, "sentence", "sentences")} with a number not on their profile removed.` : ""}
                {aiDraft.subject ? ` Email subject: “${aiDraft.subject}”.` : ""}
              </p>
            </>
          ) : (
            <p style={{ fontSize: 14, color: "var(--cc-text)", background: "var(--cc-bg)", borderRadius: 8, padding: 10, margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-testid="cf-message">
              {message}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(outgoing);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setActionError("Your browser blocked copying. Select the text and copy it instead.");
                }
              }}
            >
              <Copy style={{ width: 14, height: 14, marginRight: 4 }} />
              {copied ? "Copied" : "Copy message"}
            </Button>
            {prospect.platform === "INSTAGRAM" ? (
              <a href={instagramDmUrl(prospect.handle)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <Button variant="secondary" size="sm">
                  <MessageCircle style={{ width: 14, height: 14, marginRight: 4 }} />
                  Open Instagram DM
                </Button>
              </a>
            ) : null}
            {email ? (
              <a
                href={`mailto:${email}?${new URLSearchParams({ ...(aiDraft?.subject ? { subject: aiDraft.subject } : {}), body: outgoing }).toString().replaceAll("+", "%20")}`}
                style={{ textDecoration: "none" }}
              >
                <Button variant="secondary" size="sm">
                  <Mail style={{ width: 14, height: 14, marginRight: 4 }} />
                  Email
                </Button>
              </a>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setEditingTemplate((v) => !v)}>
              {editingTemplate ? "Done editing" : "Edit template"}
            </Button>
            {aiDraft ? (
              <Button variant="ghost" size="sm" onClick={() => setAiDraft(null)}>
                Use my template
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                loading={aiBusy === "draft"}
                disabled={!!aiBlocked || aiBusy !== null}
                onClick={() => void callAi("draft")}
                data-testid="cf-ai-draft-btn"
                title={aiBlocked ?? undefined}
              >
                <Sparkles style={{ width: 14, height: 14, marginRight: 4 }} />
                Draft with AI
              </Button>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
            These open your own Instagram or mail app. Once you&apos;ve sent it, move the card to Contacted.
          </p>
        </ModalSection>

        <ModalSection title="Move this card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {next ? (
              <Button variant="primary" size="sm" loading={saving} onClick={() => run({ status: next })} data-testid="cf-advance">
                Move to {PROSPECT_STATUS_LABEL[next]}
              </Button>
            ) : null}
            {prospect.status !== "FOUND" && prospect.status !== "DISMISSED" ? (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => run({ status: "FOUND" })}>
                Back to Found
              </Button>
            ) : null}
            {prospect.status === "DISMISSED" ? (
              <Button variant="secondary" size="sm" loading={saving} onClick={() => run({ status: "FOUND" })}>
                Restore to Found
              </Button>
            ) : (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <select
                  aria-label="Why dismiss"
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value as DismissReason | "")}
                  style={{ border: "1px solid var(--cc-border)", borderRadius: 6, padding: "4px 6px", fontSize: 13, color: "var(--cc-text)", background: "var(--cc-card)" }}
                >
                  <option value="">Dismiss because…</option>
                  {Object.entries(DISMISS_REASONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="sm" disabled={!dismissReason || saving} onClick={() => dismissReason && run({ status: "DISMISSED", dismissReason })}>
                  Dismiss
                </Button>
              </span>
            )}
          </div>
          {actionError ? (
            <ModalNotice tone="danger" icon={AlertCircle}>
              {actionError}
            </ModalNotice>
          ) : null}
        </ModalSection>

        <ModalSection title="Note">
          <textarea
            id="cf-note"
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if ((prospect.note ?? "") !== note) void run({ note: note.trim() ? note : null });
            }}
            rows={2}
            placeholder="e.g. replied on WhatsApp, wants a rate card"
            style={{ width: "100%", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 10, fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)" }}
          />
        </ModalSection>

        {prospect.events.length ? (
          <ModalSection title="History">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cc-text-muted)" }}>
              {prospect.events.map((e, i) => (
                <li key={i}>
                  {formatDateAbs(e.at)}: {e.fromStatus ? `${PROSPECT_STATUS_LABEL[e.fromStatus as ProspectStatus] ?? e.fromStatus} → ` : "added to "}
                  {PROSPECT_STATUS_LABEL[e.toStatus as ProspectStatus] ?? e.toStatus}
                  {e.toStatus === "JOINED" && !e.userId ? " (found on your roster)" : ""}
                </li>
              ))}
            </ul>
          </ModalSection>
        ) : null}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{value === undefined ? "—" : formatCompact(value)}</div>
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{label}</div>
    </div>
  );
}

function InstagramProfile({ data }: { data: Extract<ProfileResponse, { platform: "INSTAGRAM" }> }) {
  const p = data.instagram;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="cf-profile">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {p.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.profilePictureUrl} alt="" width={56} height={56} style={{ borderRadius: "50%" }} />
        ) : null}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{p.name ?? `@${p.username}`}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <Stat label="followers" value={p.followers} />
            <Stat label="posts" value={p.posts} />
          </div>
        </div>
      </div>
      {p.biography ? <p style={{ fontSize: 13, color: "var(--cc-text)", whiteSpace: "pre-wrap", margin: 0 }}>{p.biography}</p> : null}
      {p.media.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 6 }}>
          {p.media.map((m) => (
            <a key={m.id} href={m.permalink ?? undefined} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "var(--cc-text-muted)", fontSize: 11 }}>
              {m.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumbnailUrl} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }} />
              ) : (
                <div style={{ width: "100%", aspectRatio: "1", borderRadius: 6, background: "var(--cc-bg)" }} />
              )}
              {[m.views !== undefined ? `${formatCompact(m.views)} views` : null, m.likes !== undefined ? `${formatCompact(m.likes)} likes` : null]
                .filter(Boolean)
                .join(" · ")}
            </a>
          ))}
        </div>
      ) : null}
      <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
        Read live from Instagram{data.via.username ? ` through @${data.via.username}` : ""} at {new Date(data.readAt).toLocaleTimeString()}. Not stored.
      </p>
    </div>
  );
}

function YouTubeProfile({ data }: { data: Extract<ProfileResponse, { platform: "YOUTUBE" }> }) {
  const c = data.youtube;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="cf-profile">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {c.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnailUrl} alt="" width={56} height={56} style={{ borderRadius: "50%" }} />
        ) : null}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{c.title}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <Stat label="subscribers" value={c.subscribers} />
            <Stat label="videos" value={c.videos} />
          </div>
        </div>
      </div>
      {c.description ? (
        <p style={{ fontSize: 13, color: "var(--cc-text)", whiteSpace: "pre-wrap", margin: 0, maxHeight: 160, overflow: "auto" }}>{c.description}</p>
      ) : null}
      {c.recent.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cc-text)" }}>
          {c.recent.map((v) => (
            <li key={v.id}>
              <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" style={{ color: "var(--cc-primary)" }}>
                {v.title}
              </a>
              <span style={{ color: "var(--cc-text-muted)" }}>
                {v.views !== undefined ? ` · ${formatCompact(v.views)} views` : ""}
                {v.publishedAt ? ` · ${formatDateAbs(v.publishedAt)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
        Read live from YouTube at {new Date(data.readAt).toLocaleTimeString()}. Not stored.
      </p>
    </div>
  );
}
