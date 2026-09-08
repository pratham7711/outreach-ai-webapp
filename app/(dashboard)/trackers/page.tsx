"use client";
import { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Card, Modal, Input, Skeleton, EmptyState } from "@pratham7711/ui";
import { PageHeader, LastUpdated, MetricTile, Button, useConfirm } from "@/components/ds";
import { Music, Plus, RefreshCw, Search, Trash2, TrendingUp } from "lucide-react";
import { InstagramSourceBanner } from "@/components/integrations/InstagramSourceBanner";
import { CreatorTrackers } from "./CreatorTrackers";
import { SoundDetailModal } from "./SoundDetailModal";
import { TrackersIntro } from "./TrackersIntro";
import { formatCompact, formatDateAbs, timeAgo } from "@/lib/format";
import { apiDelete, apiFetch, apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";
import { describeTrackerSweep } from "@/lib/refreshSummary";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { changeSpanLabel, isTrackerWindow } from "@/lib/trackers/metrics";

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

/* The same four keys the API validates. The creator tab used to spell these
   "7 Days / 14 Days / 30 Days" while this tab said "24hr / 7d / 14d / 30d", so
   the identical control was labelled two ways on two tabs of one page. */
const PERIODS: { key: string; label: string }[] = [
  { key: "24h", label: "24h" },
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
  const confirm = useConfirm();
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
  const [urlInput, setUrlInput] = useState("");
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
      apiFetch<{ sounds: TrackedSound[]; limits?: { used: number; max: number | null } }>(
        `/api/trackers?period=${period}&sort=${sort}`
      ),
  });

  const allSounds = useMemo(() => data?.sounds ?? [], [data]);
  const sounds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSounds;
    return allSounds.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
    );
  }, [allSounds, query]);

  const limits = data?.limits;
  const atLimit = limits?.max != null && limits.used >= limits.max;
  /* A plan with no trackers at all is a different state from a plan you have
     filled, and it is the state every self-serve signup starts in. Telling
     someone with zero trackers that they have "used every tracker" is both
     wrong and a dead end -- it does not say what to do. */
  const planHasNoTrackers = limits?.max === 0;

  /* Bulk removal. Guarded by a typed confirmation rather than a dialog alone:
     this deletes every tracker and all their history, and history is the one
     thing a re-add cannot recover — readings are point-in-time and TikTok will
     not tell us what a sound was doing last week. */
  const removeAllMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ removed: number; snapshotsRemoved: number }>("/api/trackers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE_ALL" }),
      }),
    onSuccess: (r) => {
      invalidate();
      toast.success(
        `Removed ${r.removed} tracker${r.removed === 1 ? "" : "s"} and ${r.snapshotsRemoved} reading${r.snapshotsRemoved === 1 ? "" : "s"}`
      );
    },
    onError: (e) => toast.error(errorMessage(e, "Could not remove trackers")),
  });

  const confirmRemoveAll = () => {
    const n = allSounds.length;
    const typed = window.prompt(
      `Remove all ${n} tracker${n === 1 ? "" : "s"} and their entire reading history?\n\n` +
        `History cannot be recovered — TikTok will not tell us what a sound was doing last week.\n\n` +
        `Type DELETE to confirm.`
    );
    if (typed === "DELETE") removeAllMutation.mutate();
  };

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["trackers"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (url: string) => apiPost<TrackedSound & { alreadyTracked?: boolean }>("/api/trackers", { url }),
    onSuccess: (created) => {
      setModalOpen(false);
      setUrlInput("");
      invalidate();
      if (created?.alreadyTracked) {
        toast.success(`Already tracking \u201C${created.title}\u201D`);
      } else {
        // Says what happens next, because nothing happens for a while: readings
        // arrive on the reader's schedule, not on submit.
        toast.success("Tracking started — the first reading usually lands within a few hours");
      }
    },
    onError: (error) => toast.error(errorMessage(error, "Could not track that sound")),
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiPost<{ snapshots: number; failed: number; skipped: number }>("/api/trackers/refresh", {}),
    onSuccess: (result) => {
      invalidate();
      // One sentence covering both halves of the result — see describeTrackerSweep.
      const { tone, text } = describeTrackerSweep(result);
      toast[tone](text);
    },
    onError: (error) => toast.error(errorMessage(error, "Could not refresh trackers")),
  });

  /* One sound, read on demand from the detail modal. Separate from the sweep
     above so its pending state belongs to the modal button alone -- sharing a
     mutation would spin the page-level Refresh too. */
  const refreshOneMutation = useMutation({
    mutationFn: (soundId: string) =>
      apiPost<{ snapshots: number; failed: number; skipped: number }>(
        "/api/trackers/refresh",
        { soundId }
      ),
    onSuccess: (result) => {
      invalidate();
      if (result.snapshots > 0) toast.success("Updated");
      else if (result.failed > 0) toast.error("TikTok did not return a count for this sound");
      /* skipped means the cadence gate declined it: the last reading is recent
         enough that another would record the same number. Saying "updated" there
         would be a lie, and saying nothing looks broken. */
      else toast.success("Already up to date");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not refresh this tracker")),
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

  // Same parser the route runs, so the modal cannot accept something the server
  // will reject — and a video link is named before a request is even made.
  const clientError = useMemo(() => {
    const raw = urlInput.trim();
    if (!raw) return null;
    const parsed = parseSoundUrl(raw);
    // Parseable and still refused: nothing reads Instagram audio, so the route
    // 400s rather than parking a tracker that never gets a reading.
    if (parsed.kind === "sound" && parsed.platform === "INSTAGRAM") {
      return SOUND_URL_ERRORS.instagram_unsupported;
    }
    if (parsed.kind === "sound" || parsed.kind === "short-link") return null;
    const reason = parsed.kind === "video" ? "video_url" : parsed.reason;
    return SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised;
  }, [urlInput]);

  const closeAddModal = useCallback(() => {
    setModalOpen(false);
    setUrlInput("");
  }, []);

  const handleCreate = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw || clientError) return;
    createMutation.mutate(raw);
  }, [createMutation, urlInput, clientError]);

  /* Removing one tracker takes its whole reading history with it, and history is
     the one thing a re-add cannot recover — the same reason "Remove all" is guarded.
     A single row was destroying it on one unconfirmed click. */
  const handleDelete = useCallback(
    async (sound: TrackedSound) => {
      const ok = await confirm({
        title: "Remove this tracker?",
        description: `“${sound.title}” and its entire reading history will be deleted. Readings are point-in-time — TikTok will not tell us what this sound was doing last week.`,
        confirmLabel: "Remove tracker",
        tone: "danger",
      });
      if (!ok) return;
      deleteMutation.mutate(sound.id);
    },
    [confirm, deleteMutation]
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
      <PageHeader
        title="Trackers"
        subtitle="Track TikTok and Instagram sounds, and creators"
        /* The two tabs track different things, so they get different actions in
           the same place rather than one tab's buttons sitting inert. */
        actions={
          sub === "sound" ? (
          <>
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
            {allSounds.length > 0 ? (
              <Button
                variant="secondary"
                onClick={confirmRemoveAll}
                disabled={removeAllMutation.isPending}
                title="Remove every tracker and its reading history"
              >
                {removeAllMutation.isPending ? "Removing…" : "Remove all"}
              </Button>
            ) : null}
            {limits?.max != null ? (
              <span
                style={{
                  fontSize: 13,
                  alignSelf: "center",
                  color: atLimit ? "var(--cc-warning)" : "var(--cc-text-muted)",
                }}
                title={
                  planHasNoTrackers
                    ? "Your plan does not include sound trackers"
                    : `${limits.used} of ${limits.max} trackers used on this plan`
                }
              >
                {planHasNoTrackers ? "Not on this plan" : `${limits.used}/${limits.max}`}
              </span>
            ) : null}
            <Button
              variant="primary"
              onClick={() => setModalOpen(true)}
              disabled={atLimit}
              title={
                planHasNoTrackers
                  ? "Your plan does not include sound trackers — upgrade to start tracking"
                  : atLimit
                    ? "You have used every tracker on your plan"
                    : undefined
              }
            >
              <Plus size={16} style={{ marginRight: 6 }} />
              Track Sound
            </Button>
          </>
          ) : (
            <Button variant="primary" onClick={() => setCreatorPickerOpen(true)}>
              <Plus size={16} style={{ marginRight: 6 }} />
              Track Creator
            </Button>
          )
        }
      />

      {/* Above the tabs, not inside one: creator trackers carry Instagram view
          counts, so the warning has to be visible before a reader picks a tab
          and starts believing a number. Renders nothing while the source is up. */}
      <InstagramSourceBanner style={{ marginBottom: 16 }} />

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
          {/* The label has to carry the period, because the number changes when
              the buttons below are clicked. "New today" was wrong on three of
              the four settings. */}
          <MetricTile
            metric="trackersNewUses"
            label={`New uses / ${periodLabel(period)}`}
            value={formatCompact(newToday)}
          />
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
        <TrackersIntro onAdd={() => setModalOpen(true)} />
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
            const spanLabel = isTrackerWindow(period)
              ? changeSpanLabel(s.change, period, periodLabel(period))
              : periodLabel(period);
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
                    /* The span is the one changeOverWindow actually measured, not
                       the one that was asked for. With fewer than two readings
                       inside the window it falls back to the last two of all
                       time, and printing "/ 24h" over a ten-day gain overstated
                       the rate by a factor of ten. */
                    <div
                      style={{ fontSize: 12, color: added >= 0 ? "var(--cc-primary)" : "var(--cc-danger)" }}
                      title={
                        spanLabel !== periodLabel(period)
                          ? `Only ${spanLabel} of readings are available inside the ${periodLabel(period)} window.`
                          : undefined
                      }
                    >
                      {added >= 0 ? "+" : ""}
                      {formatCount(added)} / {spanLabel}
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
                <div style={{ minWidth: 110, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  {/* Only while the reader is keeping up: when it is not, the trend
                      slot above already carries "last read …", and saying it twice
                      in two colours reads as two different facts. */}
                  {s.health === "live" ? (
                    <LastUpdated at={snap?.recordedAt ?? null} neverLabel="Never read" prefix="Read" />
                  ) : null}
                  <span style={{ fontSize: 11, color: "var(--cc-text-subtle)" }}>
                    Tracked since {formatDateAbs(s.trackedSince)}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(s)}
                  /* The icon alone named nothing to a screen reader, and a 28px
                     target is under the 44px minimum for a destructive control. */
                  aria-label={`Remove tracker for ${s.title}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    color: "var(--cc-text-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
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
      <Modal open={modalOpen} onClose={closeAddModal} title="Track a Sound" size="sm" footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={closeAddModal}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate} disabled={submitting || !urlInput.trim() || clientError !== null}>
            {submitting ? "Adding\u2026" : "Track Sound"}
          </Button>
        </div>
      }>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="sound-url" style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
            TikTok sound link
          </label>
          <Input
            id="sound-url"
            autoFocus
            placeholder="tiktok.com/music/..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !clientError && urlInput.trim()) handleCreate(); }}
            aria-invalid={clientError !== null}
            aria-describedby={clientError ? "sound-url-error" : "sound-url-help"}
          />
          {clientError ? (
            <div id="sound-url-error" role="alert" style={{ fontSize: 12, color: "var(--cc-danger)" }}>
              {clientError}
            </div>
          ) : (
            <div id="sound-url-help" style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              Open the sound&apos;s own page — tap the spinning record on any video, or the sound
              name at the bottom — then copy that link. The title and artwork fill in
              automatically after the first reading. Instagram audio is not supported yet.
            </div>
          )}
        </div>
      </Modal>

      {/* Detail for one audio. Driven off the already-fetched row, so opening it
          costs no request and the charts paint immediately. */}
      <SoundDetailModal
        open={Boolean(openTracker)}
        onClose={() => setOpenTracker(null)}
        sound={allSounds.find((s) => s.id === openTracker) ?? null}
        onRefresh={(soundId) => refreshOneMutation.mutate(soundId)}
        refreshing={refreshOneMutation.isPending}
      />
    </div>
  );
}
