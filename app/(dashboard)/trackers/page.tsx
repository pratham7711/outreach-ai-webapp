"use client";
import { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Card, Modal, Input, Skeleton, EmptyState } from "@pratham7711/ui";
import { MetricTile, Button } from "@/components/ds";
import { Music, Plus, RefreshCw, Search, Trash2, TrendingUp } from "lucide-react";
import { CreatorTrackers } from "./CreatorTrackers";
import { SoundDetailModal } from "./SoundDetailModal";
import { formatCompact, formatDateAbs, timeAgo } from "@/lib/format";
import { apiDelete, apiFetch, apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";

interface SoundSnapshot {
  usesCount: number;
  deltaUses24h: number;
  velocityScore: number;
  videosAdded24h: number;
  recordedAt: string;
}

interface WindowChange {
  from: number;
  to: number;
  added: number;
  percent: number | null;
  velocityPerHour: number | null;
  spanHours: number;
}

interface TrackedSound {
  id: string;
  tiktokSoundId: string;
  title: string;
  artist: string;
  coverImageUrl: string | null;
  trackedSince: string;
  latestSnapshot: SoundSnapshot | null;
  change: WindowChange | null;
  status: "viral" | "trending" | "stable" | "declining" | "unknown";
  growthPercentage: number | null;
  addedInPeriod: number | null;
  snapshotCount: number;
  /** Whether the number above can still be believed — see lib/trackers/metrics. */
  health: "pending" | "live" | "regressed" | "stale";
  lastReadAt: string | null;
  series: { value: number; recordedAt: string }[];
  chartGranularity: "hourly" | "4hourly" | "daily" | "weekly";
}

const PERIODS: { key: string; label: string }[] = [
  { key: "24h", label: "24hr" },
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
];

const SORTS: { key: string; label: string }[] = [
  { key: "velocity", label: "Velocity" },
  { key: "uses", label: "Uses" },
  { key: "added", label: "Added" },
];

function formatCount(n: number): string {
  return formatCompact(n);
}

const STATUS_VARIANTS: Record<
  TrackedSound["status"],
  "success" | "accent" | "neutral" | "danger"
> = {
  viral: "success",
  trending: "accent",
  stable: "neutral",
  declining: "danger",
  unknown: "neutral",
};

function periodLabel(key: string): string {
  return PERIODS.find((p) => p.key === key)?.label ?? key;
}

/* The reference splits this page into Audios and Creators (?sub=sound|creator).
   They share nothing but the header, so the creator half lives in its own file
   and its queries do not run until that tab is on screen. */
const SUBS = [
  { key: "sound", label: "Audios" },
  { key: "creator", label: "Creators" },
] as const;

type Sub = (typeof SUBS)[number]["key"];

function subFromParam(raw: string | null): Sub {
  return SUBS.some((s) => s.key === raw) ? (raw as Sub) : "sound";
}

export default function TrackersPage() {
  /* In the URL, as the comment above always claimed: ?sub=creator opened the
     Audios tab, so a link to a creator watchlist -- and a reload of one --
     landed on the wrong half of the page. replace, not push, so switching tabs
     does not stack up history entries to back out of. */
  const router = useRouter();
  const searchParams = useSearchParams();
  const sub = subFromParam(searchParams.get("sub"));
  const setSub = (next: Sub) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sub", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  // Held here so the header button can open the picker the Creators tab owns.
  const [creatorPickerOpen, setCreatorPickerOpen] = useState(false);
  // Which audio's detail is open, mirrored into ?tracker= so the panel is
  // linkable and survives a reload — the reference addresses it the same way.
  const openTracker = searchParams.get("tracker");
  const setOpenTracker = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("tracker", id);
    else params.delete("tracker");
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({ tiktokSoundId: "", title: "", artist: "" });
  const [period, setPeriod] = useState("24h");
  // The reference lets this list be searched. Client-side over the already
  // fetched page: the sort and period are what the query is keyed on, and adding
  // a term to it would refetch the world on every keystroke.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("velocity");

  const queryClient = useQueryClient();
  const queryKey = ["trackers", period, sort] as const;

  const {
    data,
    isPending: loading,
    isError: loadError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<{ sounds: TrackedSound[] }>(`/api/trackers?period=${period}&sort=${sort}`),
  });

  const allSounds = useMemo(() => data?.sounds ?? [], [data]);
  const sounds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSounds;
    return allSounds.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
    );
  }, [allSounds, query]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["trackers"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (payload: typeof formData) => apiPost("/api/trackers", payload),
    onSuccess: () => {
      setModalOpen(false);
      setFormData({ tiktokSoundId: "", title: "", artist: "" });
      invalidate();
      toast.success("Sound tracked");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not track that sound")),
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiPost<{ snapshots: number; failed: number; skipped: number }>("/api/trackers/refresh", {}),
    onSuccess: (result) => {
      invalidate();
      if (result.snapshots > 0) {
        toast.success(`Updated ${result.snapshots} sound${result.snapshots === 1 ? "" : "s"}`);
      } else if (result.failed > 0) {
        toast.error("TikTok did not return counts for any tracked sound");
      } else {
        toast.success("Nothing to refresh");
      }
    },
    onError: (error) => toast.error(errorMessage(error, "Could not refresh trackers")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/trackers/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Tracker removed");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not remove that tracker")),
  });

  const submitting = createMutation.isPending;

  const handleCreate = useCallback(() => {
    if (!formData.tiktokSoundId || !formData.title) return;
    createMutation.mutate(formData);
  }, [createMutation, formData]);

  const handleDelete = useCallback(
    (id: string) => deleteMutation.mutate(id),
    [deleteMutation]
  );

  const stats = useMemo(
    () => ({
      totalTrackers: allSounds.length,
      totalUses: allSounds.reduce((sum, s) => sum + (s.latestSnapshot?.usesCount ?? 0), 0),
      trendingCount: allSounds.filter((s) => s.status === "viral" || s.status === "trending").length,
      newToday: allSounds.reduce((sum, s) => sum + (s.addedInPeriod ?? 0), 0),
    }),
    [allSounds]
  );
  const { totalTrackers, totalUses, trendingCount, newToday } = stats;

  return (
    <div className="rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Trackers</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track TikTok sounds and creators</p>
        </div>
        {/* The two tabs track different things, so they get different actions in
            the same place rather than one tab's buttons sitting inert. */}
        {sub === "sound" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="secondary"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw
                size={16}
                style={{
                  marginRight: 6,
                  animation: refreshMutation.isPending ? "cc-spin 1s linear infinite" : undefined,
                }}
              />
              {refreshMutation.isPending ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              <Plus size={16} style={{ marginRight: 6 }} />
              Track Sound
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={() => setCreatorPickerOpen(true)}>
            <Plus size={16} style={{ marginRight: 6 }} />
            Track Creator
          </Button>
        )}
      </div>

      {/* Sub-tabs: Audios | Creators */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {SUBS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            style={{
              padding: "10px 32px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid var(--cc-primary)",
              background: sub === t.key ? "var(--cc-primary)" : "var(--cc-card)",
              color: sub === t.key ? "white" : "var(--cc-primary)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "creator" ? (
        <CreatorTrackers pickerOpen={creatorPickerOpen} setPickerOpen={setCreatorPickerOpen} />
      ) : (
      <>
      {/* Stat Cards */}
      {loading ? (
        <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
              <Skeleton width={80} height={14} />
              <div style={{ marginTop: 8 }}><Skeleton width={48} height={28} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
          <MetricTile metric="trackersActive" value={String(totalTrackers)} />
          <MetricTile metric="trackerUses" value={formatCount(totalUses)} />
          <MetricTile metric="trackersTrending" value={String(trendingCount)} />
          <MetricTile metric="trackersNewToday" value={formatCompact(newToday)} />
        </div>
      )}

      {/* Sound List */}
      {loading ? (
        <Card variant="outlined" noPadding>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <Skeleton width={140} height={16} />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: i < 3 ? "1px solid var(--cc-border)" : "none" }}>
              <Skeleton width={40} height={40} borderRadius="50%" />
              <div style={{ flex: 1 }}>
                <Skeleton width={200} height={14} />
                <div style={{ marginTop: 4 }}><Skeleton width={100} height={12} /></div>
              </div>
              <Skeleton width={60} height={24} borderRadius="6px" />
              <Skeleton width={60} height={14} />
            </div>
          ))}
        </Card>
      ) : loadError ? (
        <EmptyState
          icon={<TrendingUp size={40} />}
          title="Could not load trackers"
          description="Something went wrong fetching your sound trackers."
          action={<Button variant="primary" onClick={() => refetch()}>Retry</Button>}
        />
      ) : allSounds.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={40} />}
          title="No trackers yet"
          description="Start tracking TikTok sounds to monitor their performance and trends."
          action={<Button variant="primary" onClick={() => setModalOpen(true)}>Track Sound</Button>}
        />
      ) : sounds.length === 0 ? (
        <EmptyState
          icon={<Search size={40} />}
          title="No trackers match that search"
          description={`Nothing tracked matches "${query}".`}
          action={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>}
        />
      ) : (
        <Card variant="outlined" noPadding>
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--cc-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Sound Trackers</span>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ minWidth: 200 }}>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Trackers"
                  aria-label="Search Trackers"
                  iconLeft={<Search size={16} />}
                />
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "1px solid",
                      borderColor: period === p.key ? "var(--cc-primary)" : "var(--cc-border)",
                      background: period === p.key ? "var(--cc-primary)" : "var(--cc-card)",
                      color: period === p.key ? "white" : "var(--cc-text-muted)",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Sort</span>
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSort(s.key)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "1px solid",
                      borderColor: sort === s.key ? "var(--cc-primary)" : "var(--cc-border)",
                      background: "var(--cc-card)",
                      color: sort === s.key ? "var(--cc-primary)" : "var(--cc-text-muted)",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {sounds.map((s, i) => {
            const snap = s.latestSnapshot;
            const added = s.addedInPeriod;
            const measured = s.change !== null;
            return (
              <div
                key={s.id}
                className="cc-table-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  flexWrap: "wrap",
                  borderBottom: i < sounds.length - 1 ? "1px solid var(--cc-border)" : "none",
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cc-primary-light)" }}>
                  {s.coverImageUrl ? (
                    <img src={s.coverImageUrl} alt={s.title} style={{ width: 40, height: 40, borderRadius: 12, objectFit: "cover" }} />
                  ) : (
                    <Music size={18} style={{ color: "var(--cc-primary)" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Opening the detail is a real button, so the row is reachable
                      by keyboard rather than click-only. The id goes in the URL
                      (?tracker=) so a manager can paste the link to one sound. */}
                  <button
                    type="button"
                    onClick={() => setOpenTracker(s.id)}
                    title={s.title}
                    aria-label={`Open details for ${s.title}`}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontWeight: 600, fontSize: 14, color: "var(--cc-text)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {s.title}
                  </button>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{s.artist || "Unknown artist"}</div>
                </div>
                {/* Trend and read-health never share a slot. A sound that is
                    genuinely losing uses and a sound nobody has read in a week
                    are different facts, and one badge cannot say both. */}
                {s.health === "live" ? (
                  <Badge variant={STATUS_VARIANTS[s.status]} size="sm">
                    {s.status === "unknown" ? "no data" : s.status}
                  </Badge>
                ) : (
                  <Badge variant={s.health === "pending" ? "neutral" : "warning"} size="sm">
                    {s.health === "pending" ? "awaiting first reading" : "not updating"}
                  </Badge>
                )}
                <div style={{ textAlign: "right", minWidth: 96 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: "var(--cc-text)",
                      // A dated number is still useful; a dated number dressed
                      // as a current one is not. Dim it and say when it is from.
                      opacity: s.health === "live" || !snap ? 1 : 0.6,
                    }}
                    title={
                      snap && s.health !== "live"
                        ? `Last read ${formatDateAbs(s.lastReadAt ?? snap.recordedAt)}`
                        : undefined
                    }
                  >
                    {snap ? formatCount(snap.usesCount) : "—"}
                  </div>
                  {measured && added !== null ? (
                    <div style={{ fontSize: 12, color: added >= 0 ? "var(--cc-primary)" : "var(--cc-danger)" }}>
                      {added >= 0 ? "+" : ""}
                      {formatCount(added)} / {periodLabel(period)}
                      {s.growthPercentage !== null
                        ? ` (${s.growthPercentage >= 0 ? "+" : ""}${s.growthPercentage.toFixed(1)}%)`
                        : ""}
                    </div>
                  ) : s.health !== "live" && s.lastReadAt ? (
                    // The case this whole change exists for: rather than "+0 /
                    // 24hr" computed from two readings a minute apart nine days
                    // ago, say plainly that nobody has looked since.
                    <div
                      style={{ fontSize: 12, color: "var(--cc-warning)" }}
                      title={`Readings stopped on ${formatDateAbs(s.lastReadAt)}. The count above is the last known value, not a current one.`}
                    >
                      last read {timeAgo(s.lastReadAt)}
                    </div>
                  ) : (
                    <div
                      style={{ fontSize: 12, color: "var(--cc-text-muted)" }}
                      title={
                        s.health === "pending"
                          ? "First reading usually lands within four hours"
                          : s.snapshotCount < 2
                            ? "Needs a second reading before change can be measured"
                            : "No readings inside this period"
                      }
                    >
                      — / {periodLabel(period)}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)", minWidth: 80, textAlign: "right" }}>
                  {formatDateAbs(s.trackedSince)}
                </div>
                <button
                  onClick={() => handleDelete(s.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 6,
                    borderRadius: 6,
                    color: "var(--cc-text-muted)",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Remove tracker"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </Card>
      )}

      </>
      )}

      {/* Track Sound Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Track a Sound" size="sm" footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate} disabled={submitting || !formData.tiktokSoundId || !formData.title}>
            {submitting ? "Adding..." : "Track Sound"}
          </Button>
        </div>
      }>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6, display: "block" }}>TikTok Sound ID *</label>
            <Input
              placeholder="e.g. 7123456789"
              value={formData.tiktokSoundId}
              onChange={(e) => setFormData((f) => ({ ...f, tiktokSoundId: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6, display: "block" }}>Title *</label>
            <Input
              placeholder="Sound title"
              value={formData.title}
              onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6, display: "block" }}>Artist</label>
            <Input
              placeholder="Artist name"
              value={formData.artist}
              onChange={(e) => setFormData((f) => ({ ...f, artist: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* Detail for one audio. Driven off the already-fetched row, so opening it
          costs no request and the charts paint immediately. */}
      <SoundDetailModal
        open={Boolean(openTracker)}
        onClose={() => setOpenTracker(null)}
        sound={allSounds.find((s) => s.id === openTracker) ?? null}
      />
    </div>
  );
}
