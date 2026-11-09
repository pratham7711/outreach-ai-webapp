"use client";
import { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input, EmptyState } from "@pratham7711/ui";
import { Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import {
  PageHeader,
  MetricTile,
  Button,
  DataTable,
  Dropdown,
  ListToolbar,
  MoreMenu,
  NoResults,
  StatusBadge,
  useConfirm,
  StatusTabs,
  type DataTableColumn,
  type StatusTone,
} from "@/components/ds";
import { AgeLabel } from "@/components/ds/AgeLabel";
import { TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { AlertTriangle, Disc3, Eye, Link2, Music, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { InstagramSourceBanner } from "@/components/integrations/InstagramSourceBanner";
import { CreatorTrackers } from "./CreatorTrackers";
import { SoundDetailModal } from "./SoundDetailModal";
import { TrackersIntro } from "./TrackersIntro";
import { PeriodControl } from "./PeriodControl";
import { formatDateAbs, timeAgo, formatFull } from "@/lib/format";
import { apiDelete, apiFetch, apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";
import { describeTrackerSweep } from "@/lib/refreshSummary";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { changeSpanLabel, isTrackerWindow, spanMatchesWindow } from "@/lib/trackers/metrics";
import type { ChartGranularity } from "@/lib/trackers/granularity";
import { action } from "@/lib/ui/actions";
import { asOfCaption, dataAsOf } from "@/lib/dataAge";
import { noun } from "@/lib/ui/noun";

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
  chartGranularity: ChartGranularity;
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
  return formatFull(n);
}

const STATUS_BADGE: Record<TrackedSound["status"], { tone: StatusTone; label: string }> = {
  viral: { tone: "success", label: "Viral" },
  trending: { tone: "info", label: "Trending" },
  stable: { tone: "neutral", label: "Stable" },
  declining: { tone: "danger", label: "Declining" },
  unknown: { tone: "neutral", label: "No data" },
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
      apiFetch<{ sounds: TrackedSound[]; limits?: { used: number; max: number | null }; readCadenceHours?: number }>(
        `/api/trackers?period=${period}&sort=${sort}`
      ),
  });

  const allSounds = useMemo(() => data?.sounds ?? [], [data]);
  const cadenceHours = data?.readCadenceHours ?? null;
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
     not tell us what a sound was doing last week. The typing happens in a
     dialog of our own rather than window.prompt, which could not say any of
     that legibly and which the browser styles as an error. */
  const [removeAllOpen, setRemoveAllOpen] = useState(false);
  const [removeAllTyped, setRemoveAllTyped] = useState("");
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
    setRemoveAllTyped("");
    setRemoveAllOpen(true);
  };
  const closeRemoveAll = useCallback(() => {
    setRemoveAllOpen(false);
    setRemoveAllTyped("");
  }, []);
  const removeAllArmed = removeAllTyped === "DELETE";
  const submitRemoveAll = () => {
    if (!removeAllArmed || removeAllMutation.isPending) return;
    removeAllMutation.mutate(undefined, { onSuccess: closeRemoveAll });
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
    /* Instagram audio is no longer refused here. Whether a given audio page can
       be tracked is not a property of the link -- Instagram serves a 200 for an
       id that is no audio page, and original audio publishes no use count -- so
       only the server, which fetches the page, can say. It answers
       instagram_audio_not_found / _no_count / _unreadable, and the modal shows
       that sentence. Guessing here would either refuse links that work or
       promise ones that do not. */
    if (parsed.kind === "sound" || parsed.kind === "short-link") return null;
    const reason = parsed.kind === "video" ? "video_url" : parsed.reason;
    return SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised;
  }, [urlInput]);

  const soundLinkReady = urlInput.trim() !== "" && clientError === null;

  const closeAddModal = useCallback(() => {
    setModalOpen(false);
    setUrlInput("");
  }, []);

  const handleCreate = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw || clientError) return;
    createMutation.mutate(raw);
  }, [createMutation, urlInput, clientError]);

  /* Two trackers can carry the same title and artist -- TikTok mints a separate
     sound for each upload of the same song, and a workspace ends up watching
     both. MEASURED 2026-09-15: two rows reading "Roots / Unknown artist",
     identical down to the cover, so the only way to tell which one the delete
     button belonged to was to open each in turn. Where the pair is ambiguous the
     row shows the sound id underneath; where it is not, nothing changes, because
     an id on every row is noise. */
  const ambiguousLabels = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of allSounds) {
      const key = `${s.title}\u0000${s.artist}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([key]) => key));
  }, [allSounds]);

  /* Removing one tracker takes its whole reading history with it, and history is
     the one thing a re-add cannot recover — the same reason "Remove all" is guarded.
     A single row was destroying it on one unconfirmed click. */
  const handleDelete = useCallback(
    async (sound: TrackedSound) => {
      const ok = await confirm({
        verb: "remove",
        subject: sound.title,
        /* The id is named only where the title alone does not identify the
           tracker, because two rows can read "Roots" and this dialog is the
           last thing standing between the wrong one and a deleted history. */
        description: `“${sound.title}”${ambiguousLabels.has(`${sound.title}\u0000${sound.artist}`) ? ` (sound ${sound.tiktokSoundId})` : ""} and its entire reading history will be deleted. Readings are point-in-time — TikTok will not tell us what this sound was doing last week.`,
        confirmLabel: "Remove tracker",
        tone: "danger",
      });
      if (!ok) return;
      deleteMutation.mutate(sound.id);
    },
    [confirm, deleteMutation, ambiguousLabels]
  );

  const stats = useMemo(() => {
    /* A sound with no reading yet has no use count -- it added 0 to the total,
       which then read as a measured figure. Only read sounds are summed, the
       tile says how many of them that is, and when the newest was read. */
    const read = allSounds.filter((s) => s.latestSnapshot !== null);
    /* Only rows whose readings span the period: the tile's label names the
       period, and a row measured over a different stretch already says so
       on its own line. A period no row spans is unknown, not "0 new uses". */
    const spanning = allSounds.filter(
      (s) => s.change && isTrackerWindow(period) && spanMatchesWindow(s.change.spanHours, period) && s.addedInPeriod !== null,
    );
    const readAt = (s: TrackedSound) => s.latestSnapshot?.recordedAt ?? null;
    return {
      totalTrackers: allSounds.length,
      totalUses: read.length === 0 ? null : read.reduce((sum, s) => sum + (s.latestSnapshot?.usesCount ?? 0), 0),
      usesNote: asOfCaption(dataAsOf(read.map(readAt)), { known: read.length, total: allSounds.length, noun: "sound" }),
      trendingCount: allSounds.filter((s) => s.status === "viral" || s.status === "trending").length,
      newToday: spanning.length === 0 ? null : spanning.reduce((sum, s) => sum + (s.addedInPeriod ?? 0), 0),
      newNote:
        spanning.length === 0
          ? `No sound has readings spanning ${periodLabel(period)} yet`
          : asOfCaption(dataAsOf(spanning.map(readAt)), { known: spanning.length, total: allSounds.length, noun: "sound" }),
    };
  }, [allSounds, period]);
  const { totalTrackers, totalUses, usesNote, trendingCount, newToday, newNote } = stats;

  const soundColumns: DataTableColumn<TrackedSound>[] = [
    {
      key: "sound",
      header: "Sound",
      minWidth: 240,
      render: (s) => (
        <div className="cc-sound-cell">
          <span className="cc-sound-cover" aria-hidden="true">
            {s.coverImageUrl ? <img src={s.coverImageUrl} alt="" /> : <Music size={18} />}
          </span>
          <span className="cc-sound-cell-text">
            {/* Opening the detail is a real button, so the row is reachable
                by keyboard rather than click-only. The id goes in the URL
                (?tracker=) so a manager can paste the link to one sound. */}
            <button
              type="button"
              className="cc-sound-open cc-dt-truncate"
              onClick={() => setOpenTracker(s.id)}
              title={s.title}
              aria-label={`Open details for ${s.title}`}
            >
              {s.title}
            </button>
            <span className="cc-dt-sub cc-dt-truncate">
              {s.artist || "Unknown artist"}
              {ambiguousLabels.has(`${s.title}\u0000${s.artist}`) ? (
                <span
                  className="cc-sound-id"
                  title="Another tracker in this workspace has the same title and artist. This is the TikTok sound id, which tells them apart."
                >
                  {" "}
                  · {s.tiktokSoundId}
                </span>
              ) : null}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 196,
      /* Trend and read-health never share a slot. A sound that is genuinely
         losing uses and a sound nobody has read in a week are different facts,
         and one badge cannot say both. */
      render: (s) =>
        s.health === "live" ? (
          <StatusBadge tone={STATUS_BADGE[s.status].tone}>{STATUS_BADGE[s.status].label}</StatusBadge>
        ) : s.health === "pending" ? (
          <StatusBadge tone="neutral">Awaiting first reading</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Not updating</StatusBadge>
        ),
    },
    {
      key: "uses",
      header: "Uses",
      width: 184,
      align: "right",
      render: (s) => {
        const snap = s.latestSnapshot;
        const added = s.addedInPeriod;
        const spanLabel = isTrackerWindow(period) ? changeSpanLabel(s.change, period, periodLabel(period)) : periodLabel(period);
        return (
          <>
            <span
              className="cc-sound-uses"
              /* A dated number is still useful; a dated number dressed as a
                 current one is not. Dim it and say when it is from. */
              data-dated={snap && s.health !== "live" ? "" : undefined}
              title={snap && s.health !== "live" ? `Last read ${formatDateAbs(s.lastReadAt ?? snap.recordedAt)}` : undefined}
            >
              {snap ? formatCount(snap.usesCount) : "—"}
            </span>
            {s.change !== null && added !== null ? (
              /* The span is the one changeOverWindow actually measured, not the
                 one that was asked for. With fewer than two readings inside the
                 window it falls back to the last two of all time. */
              <span
                className="cc-dt-sub cc-sound-change"
                data-down={added < 0 ? "" : undefined}
                title={
                  spanLabel !== periodLabel(period)
                    ? `Only ${spanLabel} of readings are available inside the ${periodLabel(period)} window.`
                    : undefined
                }
              >
                {added >= 0 ? "+" : ""}
                {formatCount(added)} / {spanLabel}
                {s.growthPercentage !== null ? ` (${s.growthPercentage >= 0 ? "+" : ""}${s.growthPercentage.toFixed(1)}%)` : ""}
              </span>
            ) : (
              <span
                className="cc-dt-sub"
                title={
                  s.health !== "live" && s.lastReadAt
                    ? `Readings stopped on ${formatDateAbs(s.lastReadAt)}. The count above is the last known value, not a current one.`
                    : s.health === "pending"
                      ? "First reading usually lands within four hours"
                      : s.snapshotCount < 2
                        ? "Needs a second reading before change can be measured"
                        : "No readings inside this period"
                }
              >
                — / {periodLabel(period)}
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "read",
      header: "Last read",
      width: 148,
      render: (s) =>
        s.health === "live" ? (
          /* The reading's age, with the Stale chip once it is past twice the
             org's read cadence. */
          <AgeLabel
            at={s.latestSnapshot?.recordedAt ?? null}
            field="sound"
            ctx={{ cadenceHours }}
            source="Sound reading"
            never="Never read"
            style={{ fontSize: "var(--cc-t-13)" }}
          />
        ) : s.lastReadAt ? (
          <span
            className="cc-sound-late"
            title={`Readings stopped on ${formatDateAbs(s.lastReadAt)}. The count is the last known value, not a current one.`}
          >
            {timeAgo(s.lastReadAt)}
          </span>
        ) : (
          <span className="cc-sound-never">Not read yet</span>
        ),
    },
    {
      key: "since",
      header: "Tracked since",
      width: 132,
      render: (s) => formatDateAbs(s.trackedSince),
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: 64,
      render: (s) => (
        <MoreMenu
          size="sm"
          label={`More actions for ${s.title}`}
          items={[
            { label: "Open details", icon: <Eye size={15} />, onClick: () => setOpenTracker(s.id) },
            {
              label: "Refresh now",
              icon: <RefreshCw size={15} />,
              onClick: () => refreshOneMutation.mutate(s.id),
              disabled: refreshOneMutation.isPending,
            },
            {
              label: "Remove tracker",
              icon: <Trash2 size={15} />,
              onClick: () => handleDelete(s),
              danger: true,
              startsGroup: true,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="rsp-page">
      <PageHeader
        title="Trackers"
        /* The plan's count, which is sounds AND tracked creators -- so it can
           be higher than the Sound trackers tile below. It is a fact about
           the page, not an action, so it sits under the title rather than
           between the buttons. The tooltip gives the split. */
        subtitle={
          limits?.max != null ? (
            <span
              style={{ color: atLimit ? "var(--cc-warning)" : undefined }}
              title={
                planHasNoTrackers
                  ? "Your plan does not include sound trackers"
                  : `${limits.used} of ${limits.max} trackers used on this plan: ${allSounds.length} ${noun(allSounds.length, "sound")} and ${Math.max(0, limits.used - allSounds.length)} ${noun(Math.max(0, limits.used - allSounds.length), "creator")}`
              }
            >
              {planHasNoTrackers ? "Trackers are not on this plan" : `${limits.used} of ${limits.max} trackers used on this plan`}
            </span>
          ) : (
            "Track TikTok and Instagram sounds, and creators"
          )
        }
        /* The two tabs track different things, so they get different actions in
           the same place rather than one tab's buttons sitting inert. */
        actions={
          sub === "sound" ? (
          <>
            <Button
              variant="secondary"
              onClick={() => refreshMutation.mutate()}
              loading={refreshMutation.isPending}
              iconLeft={<RefreshCw size={16} aria-hidden="true" />}
            >
              {refreshMutation.isPending ? "Refreshing…" : "Refresh"}
            </Button>
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
              iconLeft={<Plus size={16} aria-hidden="true" />}
              {...action("track-sound")}
            >
              Track sound
            </Button>
            {allSounds.length > 0 && (
              <MoreMenu
                label="More tracker actions"
                items={[
                  {
                    label: removeAllMutation.isPending ? "Removing…" : "Remove all sound trackers",
                    icon: <Trash2 size={15} />,
                    onClick: confirmRemoveAll,
                    disabled: removeAllMutation.isPending,
                    danger: true,
                  },
                ]}
              />
            )}
          </>
          ) : (
            <Button
              variant="primary"
              onClick={() => setCreatorPickerOpen(true)}
              iconLeft={<Plus size={16} aria-hidden="true" />}
              {...action("track-creator")}
            >
              Track creator
            </Button>
          )
        }
        tabs={
          <StatusTabs
            ariaLabel="What to track"
            tabs={SUBS.map((t) => ({ key: t.key, label: t.label }))}
            active={sub}
            onChange={(key) => setSub(key as Sub)}
          />
        }
      />

      {/* Creators tab only: creator trackers carry Instagram view counts from
          Business Discovery, which is what this banner reports on. Sound
          trackers read Instagram's audio page directly and never touch that
          token, so on Audios the warning described numbers it does not show.
          Renders nothing while the source is up. */}
      {sub === "creator" && <InstagramSourceBanner style={{ marginBottom: 16 }} />}

      {sub === "creator" ? (
        <CreatorTrackers pickerOpen={creatorPickerOpen} setPickerOpen={setCreatorPickerOpen} />
      ) : (
      <>
      {loading ? (
        <TileGridSkeleton count={4} style={{ marginBottom: 24 }} />
      ) : allSounds.length === 0 ? (
        /* Four zeroes above TrackersIntro, which is the screen that explains
           what a tracker is. Nothing has been measured yet, so there is nothing
           to report; the tiles arrive with the first tracked sound. */
        null
      ) : (
        <div className="cc-tiles-balanced cc-trackers-tiles">
          <MetricTile metric="trackersActive" value={String(totalTrackers)} />
          <MetricTile
            metric="trackerUses"
            value={totalUses === null ? "—" : formatCount(totalUses)}
            footer={totalUses === null ? "No sound has been read yet" : usesNote}
          />
          <MetricTile metric="trackersTrending" value={String(trendingCount)} />
          {/* The label has to carry the period, because the number changes when
              the period below is changed. "New today" was wrong on three of
              the four settings. */}
          <MetricTile
            metric="trackersNewUses"
            label={`New uses / ${periodLabel(period)}`}
            value={newToday === null ? "—" : formatFull(newToday)}
            footer={newNote}
          />
        </div>
      )}

      {loadError ? (
        <EmptyState
          icon={<TrendingUp size={40} />}
          title="Could not load trackers"
          description="Something went wrong fetching your sound trackers."
          action={<Button variant="primary" onClick={() => refetch()}>Retry</Button>}
        />
      ) : !loading && allSounds.length === 0 ? (
        <TrackersIntro onAdd={() => setModalOpen(true)} />
      ) : (
        <>
          <ListToolbar
            search={{
              value: query,
              onChange: setQuery,
              placeholder: "Search sounds",
              ariaLabel: "Search sound trackers by title or artist",
            }}
            end={
              <>
                <PeriodControl periods={PERIODS} value={period} onChange={setPeriod} />
                <Dropdown
                  ariaLabel="Sort sound trackers"
                  size="md"
                  align="right"
                  value={sort}
                  onChange={setSort}
                  options={SORTS.map((o) => ({ value: o.key, label: o.label }))}
                  minWidth={150}
                />
              </>
            }
          />
          <DataTable
            className="cc-actions-table"
            caption="Sound trackers"
            columns={soundColumns}
            rows={sounds}
            rowKey={(s) => s.id}
            loading={loading}
            skeletonRows={4}
            empty={
              <NoResults
                onClear={() => setQuery("")}
                clearLabel="Clear search"
                description={`Nothing tracked matches "${query}".`}
              />
            }
          />
        </>
      )}

      </>
      )}

      {/* Track Sound Modal */}
      <Modal
        open={modalOpen}
        onClose={closeAddModal}
        icon={Music}
        title="Track a sound"
        description="Paste the link to a sound's own page. Its title and artwork fill in after the first reading."
        size="sm"
        dismissible={false}
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={closeAddModal}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={submitting || !urlInput.trim() || clientError !== null}
              iconLeft={<Plus size={16} aria-hidden="true" />}
            >
              {submitting ? "Adding\u2026" : "Track sound"}
            </Button>
          </div>
        }
      >
        <Input
          id="sound-url"
          label="TikTok sound link"
          autoFocus
          placeholder="tiktok.com/music/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !clientError && urlInput.trim()) handleCreate(); }}
          error={clientError ?? undefined}
          iconLeft={<Link2 size={16} />}
          autoComplete="off"
          {...(clientError || soundLinkReady ? {} : { "aria-describedby": "sound-url-help" })}
        />
        {/* How to find the link, until there is one: it goes once a link the
            parser accepts is in the field, and comes back if it stops being one. */}
        {!soundLinkReady && (
          <ModalSection title="Where to find the link">
            <div id="sound-url-help">
              <ModalOptionList>
                <ModalOption
                  as="div"
                  icon={Disc3}
                  title="Open the sound's own page"
                  description="Tap the spinning record on any video, or the sound name at the bottom."
                />
                <ModalOption
                  as="div"
                  icon={Link2}
                  title="Copy that page's link"
                  description="Paste it above. A link to a video will not work."
                />
              </ModalOptionList>
            </div>
          </ModalSection>
        )}
      </Modal>

      {/* Remove all: typed confirmation, see removeAllMutation above. */}
      <Modal
        open={removeAllOpen}
        onClose={() => { if (!removeAllMutation.isPending) closeRemoveAll(); }}
        icon={Trash2}
        tone="danger"
        title={`Remove all ${allSounds.length} sound ${noun(allSounds.length, "tracker")}?`}
        description="Each one is deleted along with its entire reading history."
        size="sm"
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={closeRemoveAll} disabled={removeAllMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="submit"
              form="cc-remove-all-trackers"
              disabled={!removeAllArmed || removeAllMutation.isPending}
              iconLeft={<Trash2 size={16} aria-hidden="true" />}
            >
              {removeAllMutation.isPending ? "Removing\u2026" : "Remove all trackers"}
            </Button>
          </div>
        }
      >
        <form
          id="cc-remove-all-trackers"
          className="cc-dialog-stack"
          onSubmit={(e) => {
            e.preventDefault();
            submitRemoveAll();
          }}
        >
          <ModalNotice tone="warning" icon={AlertTriangle} title="History cannot be recovered">
            TikTok will not tell us what a sound was doing last week.
          </ModalNotice>
          <Input
            id="cc-remove-all-confirm"
            label="Type DELETE to confirm"
            value={removeAllTyped}
            onChange={(e) => setRemoveAllTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={removeAllMutation.isPending}
            autoFocus
          />
        </form>
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
