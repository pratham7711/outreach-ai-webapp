"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, EmptyState, Input, Modal, Skeleton } from "@pratham7711/ui";
import { Button, Pagination, useConfirm } from "@/components/ds";
import { Play, Search, Trash2, User, Users } from "lucide-react";
import { formatDateAbs, formatHandle, timeAgo } from "@/lib/format";
import { apiDelete, apiFetch, apiPost } from "@/lib/api/client";
import { CreatorDetailModal, trackedFigures, type TopPost } from "./CreatorDetailModal";
import type { ChartGranularity } from "@/lib/trackers/granularity";
import { errorMessage } from "@/lib/api/errorMessage";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { LATEST_TEN_SINCE } from "@/lib/trackers/recentViews";
import { isUnknownMetric, metricReason } from "@/lib/creators/metricValue";
import MetricFigure from "@/components/creators/MetricFigure";
import { AgeLabel } from "@/components/ds/AgeLabel";

/**
 * The Creators sub-tab of Trackers, matching the reference's card layout: two
 * bordered figure groups per creator, each a value beside its change.
 *
 * The reference prints "No data yet." in every change cell on the captured page,
 * and so does this on any creator we cannot measure — which is the same words for
 * the same reason, not a coincidence. What we can measure is stated in
 * lib/trackers/creatorMetrics.ts.
 */

type CreatorMetrics = {
  avgViews: number | null;
  postsInWindow: number;
  changePercent: number | null;
  changeAbsentReason: "no-posts-in-window" | "no-posts-before" | "zero-baseline" | null;
  postsInPrevious: number;
};

/** The creator's own Avg. Views: their ten newest posts, pinned ones left out. */
type CreatorViews = {
  avgViews: number | null;
  changePercent: number | null;
  delta: number | null;
  measuredAt: string | null;
};

type TrackedCreator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  trackedSince: string | null;
  followersCount: number | null;
  followersChangePercent: number | null;
  followersDelta: number | null;
  lastReadAt: string | null;
  lastAttemptAt: string | null;
  health: "pending" | "live" | "regressed" | "stale";
  /** Why the last read produced nothing, already worded for a reader. */
  readError: string | null;
  series: { value: number; recordedAt: string }[];
  chartGranularity: ChartGranularity;
  snapshotCount: number;
  views: CreatorViews;
  /** Posts this workspace tracks with them -- a different, narrower set. */
  metrics: CreatorMetrics;
  topPosts: TopPost[] | null;
  topPostsAt: string | null;
  topPostsSource: "platform" | "campaigns" | null;
};

/* Spelled to match the Audios tab's identical control. There is no 24h option
   here: a creator's follower count moves too slowly for a one-day reading to be
   anything but noise. */
const PERIODS = [
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
];

const SORTS = [
  { key: "views", label: "Avg. Views" },
  { key: "change", label: "Change" },
  { key: "posts", label: "Posts" },
  { key: "followers", label: "Followers" },
];

const NO_DATA = "No data yet.";

/* The server pages and ranks (plan §12 F3): the order is decided over every
   tracked creator before the page is cut, so the controls here only ask. */
const PAGE_SIZE = 50;

type TrackerPage = {
  creators: TrackedCreator[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** The org's tracker read cadence, for the Stale rule (lib/dataAge). */
  readCadenceHours?: number;
};

function periodLabel(key: string): string {
  return PERIODS.find((p) => p.key === key)?.label ?? key;
}

/** Why an Avg. Views change is absent, in the same spirit as followersReason. */
function viewsReason(c: TrackedCreator): string {
  if (c.views.avgViews === null) {
    if (c.readError) return c.readError;
    return "We have not measured this creator's recent posts yet. Posts are read once a day.";
  }
  if (c.health !== "live") {
    return "The last reading is too old to compare against, so no change is shown.";
  }
  return `A change needs two readings of their newest posts since ${formatDateAbs(LATEST_TEN_SINCE)}, and there is one so far. It fills in within a day.`;
}

/**
 * Why a follower trend is absent.
 *
 * Four different situations previously rendered as the same blank cell: never
 * read, read once, read and failed permanently, and read but gone stale. They
 * need four different things from the reader, so they say four different things.
 */
function followersReason(c: TrackedCreator, period: string): string {
  if (c.readError) return c.readError;
  if (c.health === "pending" || c.snapshotCount === 0) {
    /* New trackers join the back of the reading queue, so the first reading
       comes after everyone already waiting has had theirs -- not "within a
       few hours" whatever the queue's length. */
    return "We have not read this creator yet. New creators join the back of the reading queue, so the first reading comes once those already tracked have been read.";
  }
  if (c.snapshotCount === 1) {
    return "We have one reading so far. A change needs two, so this fills in on the next sweep.";
  }
  if (c.health !== "live") {
    return "The last reading is too old to compare against, so no change is shown.";
  }
  return `No readings inside the last ${periodLabel(period).toLowerCase()}, so there is nothing to compare.`;
}

/** One bordered figure group: icon, a value, and its change. */
function FigureGroup({
  icon,
  label,
  value,
  valueTitle,
  changeNode,
  changeTitle,
  age,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueTitle?: string;
  changeNode: React.ReactNode;
  changeTitle: string;
  /** The reading's age under the value (plan A6). */
  age?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        border: "1px solid var(--cc-border)",
        borderRadius: 12,
        overflow: "hidden",
        flex: "1 1 260px",
        minWidth: 240,
      }}
    >
      <div
        style={{
          width: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--cc-bg)",
          borderRight: "1px solid var(--cc-border)",
          color: "var(--cc-primary)",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
        <div style={{ padding: "10px 16px", minWidth: 0, flex: "1 1 auto" }} title={valueTitle}>
          <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>{label}</div>
          <div
            style={{
              fontSize: "var(--cc-t-18)",
              fontWeight: 700,
              color: "var(--cc-primary)",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
          {age}
        </div>
        <div style={{ padding: "10px 16px", flex: "0 0 auto" }} title={changeTitle}>
          <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>Change</div>
          {changeNode}
        </div>
      </div>
    </div>
  );
}

function ChangeValue({ percent }: { percent: number }) {
  const up = percent >= 0;
  return (
    <div style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: up ? "var(--cc-primary)" : "var(--cc-danger-fg)" }}>
      {up ? "+" : ""}
      {percent.toFixed(2)}%
    </div>
  );
}

function NoData({ title }: { title: string }) {
  return (
    <div style={{ fontSize: "var(--cc-t-11)", fontWeight: 700, color: "var(--cc-text-subtle)" }} title={title}>
      {NO_DATA}
    </div>
  );
}

export function CreatorTrackers({
  pickerOpen,
  setPickerOpen,
}: {
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}) {
  const [period, setPeriod] = useState("7d");
  // Addressed as state rather than a route so closing does not pull the list out
  // from under the reader, matching how the sound tracker opens its detail.
  const [openCreator, setOpenCreator] = useState<string | null>(null);
  const [sort, setSort] = useState("views");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // The list's own search, separate from the picker's: one filters what is
  // tracked, the other finds someone to track.
  const [listSearch, setListSearch] = useState("");
  const [q, setQ] = useState("");
  const confirm = useConfirm();

  // Searched in the database, so typing debounces into the request rather
  // than filtering one page of fifty.
  useEffect(() => {
    const next = listSearch.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      setQ(next);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [listSearch, q]);

  const queryClient = useQueryClient();
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["creator-trackers"] });
    queryClient.invalidateQueries({ queryKey: ["creator-picker"] });
    queryClient.invalidateQueries({ queryKey: ["track-status"] });
  }, [queryClient]);

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["creator-trackers", period, sort, q, page],
    queryFn: () =>
      apiFetch<TrackerPage>(
        `/api/trackers/creators?period=${period}&sort=${sort}&page=${page}&pageSize=${PAGE_SIZE}${q ? `&q=${encodeURIComponent(q)}` : ""}`
      ),
    // The page being left stays on screen until the next one arrives, rather
    // than collapsing to a skeleton on every click of the pager.
    placeholderData: keepPreviousData,
  });
  const creators = useMemo(() => data?.creators ?? [], [data]);
  const cadenceHours = data?.readCadenceHours ?? null;

  // Only fetched while the picker is open, and only for what was typed.
  const { data: candidates, isFetching: searching } = useQuery({
    queryKey: ["creator-picker", search],
    queryFn: () =>
      apiFetch<{
        creators: { id: string; name: string; handle: string; avatarUrl: string | null; trackedSince: string | null }[];
      }>(`/api/creators?limit=10${search ? `&search=${encodeURIComponent(search)}` : ""}`),
    enabled: pickerOpen,
  });

  const trackMutation = useMutation({
    mutationFn: (creatorId: string) =>
      apiPost<{ tracked: boolean; alreadyTracked?: boolean }>("/api/trackers/creators", { creatorId }),
    onSuccess: (result) => {
      invalidate();
      toast.success(result?.alreadyTracked ? "Already tracked" : "Creator tracked");
      setPickerOpen(false);
      setSearch("");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not track that creator")),
  });

  const refreshOneMutation = useMutation({
    mutationFn: (creatorId: string) =>
      apiPost<{ snapshots: number; failed: number; skipped: number }>(
        "/api/trackers/creators/refresh",
        { creatorId }
      ),
    onSuccess: (result) => {
      invalidate();
      if (result.snapshots > 0) toast.success("Updated");
      else if (result.failed > 0) toast.error("We could not read this creator's figures");
      // skipped means the cadence gate declined: the last reading is recent
      // enough that another would record the same number.
      else toast.success("Already up to date");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not refresh this creator")),
  });

  const untrackMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/trackers/creators/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Stopped tracking");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not stop tracking")),
  });

  /* One click used to stop a standing read. The readings stay, but the date
     the watch began does not come back if the creator is tracked again. */
  const untrack = useCallback(
    async (c: TrackedCreator) => {
      const ok = await confirm({
        title: "Stop tracking this creator?",
        description: `${c.name} will no longer be read on a schedule. Readings taken so far are kept; tracking them again starts a new watch from today.`,
        confirmLabel: "Stop tracking",
        tone: "danger",
      });
      if (ok) untrackMutation.mutate(c.id);
    },
    [confirm, untrackMutation]
  );

  /* The page holds fifty, so the picker also trusts the creator's own row --
     a creator tracked on page 9 is still tracked. */
  const trackedIds = useMemo(() => new Set(creators.map((c) => c.id)), [creators]);

  const controls = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>Sort</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              setSort(s.key);
              setPage(1);
            }}
            style={{
              padding: "5px 10px",
              borderRadius: 8,
              fontSize: "var(--cc-t-13)",
              fontWeight: "var(--cc-fw-strong)",
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ minWidth: 200 }}>
          <Input
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search tracked creators"
            aria-label="Search tracked creators"
            iconLeft={<Search size={16} />}
          />
        </div>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              setPeriod(p.key);
              setPage(1);
            }}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              fontSize: "var(--cc-t-13)",
              fontWeight: "var(--cc-fw-strong)",
              cursor: "pointer",
              border: "1px solid var(--cc-primary)",
              background: period === p.key ? "var(--cc-primary)" : "var(--cc-card)",
              color: period === p.key ? "var(--cc-on-primary)" : "var(--cc-primary)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (isPending) {
    return (
      <div>
        {controls}
        {[1, 2, 3].map((i) => (
          <Card key={i} variant="outlined" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Skeleton width={56} height={56} borderRadius="50%" />
              <div style={{ flex: 1 }}>
                <Skeleton width={160} height={16} />
                <div style={{ marginTop: 6 }}>
                  <Skeleton width={100} height={13} />
                </div>
              </div>
              <Skeleton width={240} height={56} borderRadius="12px" />
              <Skeleton width={240} height={56} borderRadius="12px" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<Users size={40} />}
        title="Could not load creator trackers"
        description="Something went wrong fetching your tracked creators."
        action={
          <Button variant="primary" onClick={() => refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {controls}

      {creators.length === 0 && q ? (
        <EmptyState
          icon={<Search size={40} />}
          title="No tracked creators match that search"
          description={`Nothing you track matches "${q}".`}
          action={
            <Button variant="secondary" onClick={() => setListSearch("")}>
              Clear search
            </Button>
          }
        />
      ) : creators.length === 0 ? (
        <EmptyState
          icon={<Users size={40} />}
          title="No creators tracked yet"
          description="Add a creator to watch their posting cadence and how their average views move week over week."
          action={
            <Button variant="primary" onClick={() => setPickerOpen(true)}>
              Track Creator
            </Button>
          }
        />
      ) : (
        <>
          {creators.map((c) => {
            const v = c.views;
            const figures = trackedFigures(c);
            return (
              <Card key={c.id} variant="outlined" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 220px", minWidth: 200 }}>
                    <CreatorAvatar id={c.id} name={c.name} size="lg" />
                    <div
                      style={{ minWidth: 0, cursor: "pointer" }}
                      onClick={() => setOpenCreator(c.id)}
                    >
                      <div
                        title={c.name}
                        style={{
                          fontSize: "var(--cc-t-16)",
                          fontWeight: 700,
                          color: "var(--cc-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.name}
                      </div>
                      <div style={{ fontSize: "var(--cc-t-15)", color: "var(--cc-text-muted)" }}>
                        {formatHandle(c.handle)}
                      </div>
                    </div>
                  </div>

                  <FigureGroup
                    icon={<User size={22} />}
                    label="Followers"
                    value={<MetricFigure value={figures.followers} />}
                    valueTitle={metricReason(figures.followers)}
                    changeNode={
                      c.followersChangePercent !== null ? (
                        <ChangeValue percent={c.followersChangePercent} />
                      ) : (
                        <NoData title={followersReason(c, period)} />
                      )
                    }
                    changeTitle={
                      c.followersDelta !== null
                        ? `${c.followersDelta >= 0 ? "+" : ""}${c.followersDelta.toLocaleString()} followers over ${periodLabel(period).toLowerCase()}`
                        : ""
                    }
                    age={
                      isUnknownMetric(figures.followers) ? undefined : (
                        <AgeLabel at={c.lastReadAt} field="tracker" ctx={{ cadenceHours }} source="Tracker reading" never="time not recorded" />
                      )
                    }
                  />

                  <FigureGroup
                    icon={<Play size={22} />}
                    label="Avg. Views"
                    value={<MetricFigure value={figures.avgViews} />}
                    valueTitle={
                      isUnknownMetric(figures.avgViews)
                        ? viewsReason(c)
                        : `Average views of their 10 newest posts, pinned posts left out. Measured ${timeAgo(v.measuredAt)}.`
                    }
                    changeNode={
                      v.changePercent !== null ? (
                        <ChangeValue percent={v.changePercent} />
                      ) : (
                        <NoData title={viewsReason(c)} />
                      )
                    }
                    changeTitle={
                      v.delta !== null
                        ? `${v.delta >= 0 ? "+" : ""}${Math.round(v.delta).toLocaleString()} average views over ${periodLabel(period).toLowerCase()}`
                        : ""
                    }
                    age={
                      isUnknownMetric(figures.avgViews) ? undefined : (
                        <AgeLabel at={v.measuredAt} field="tracker" ctx={{ cadenceHours }} source="Tracker reading" never="time not recorded" />
                      )
                    }
                  />

                  <button
                    onClick={() => untrack(c)}
                    disabled={untrackMutation.isPending}
                    title="Stop tracking this creator"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 6,
                      borderRadius: 6,
                      color: "var(--cc-text-muted)",
                      display: "flex",
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </Card>
            );
          })}
          {data && data.total > data.pageSize && (
            <Pagination
              style={{ marginTop: 16 }}
              page={data.page}
              totalPages={data.pageCount}
              total={data.total}
              pageSize={data.pageSize}
              loading={isFetching}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <CreatorDetailModal
        open={Boolean(openCreator)}
        onClose={() => setOpenCreator(null)}
        creator={creators.find((c) => c.id === openCreator) ?? null}
        onRefresh={(id) => refreshOneMutation.mutate(id)}
        refreshing={refreshOneMutation.isPending}
      />

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Track a Creator"
        size="sm"
        footer={
          <div className="cc-modal-footer" data-gap="0">
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        <Input
          placeholder="Search creators by name or handle"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ marginTop: 12, maxHeight: 320, overflowY: "auto" }}>
          {searching && !candidates ? (
            <div style={{ padding: 12 }}>
              <Skeleton width={220} height={14} />
            </div>
          ) : (candidates?.creators ?? []).length === 0 ? (
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", padding: "12px 4px" }}>
              No creators match that.
            </p>
          ) : (
            (candidates?.creators ?? []).map((cand) => {
              const already = trackedIds.has(cand.id) || Boolean(cand.trackedSince);
              return (
                <div
                  key={cand.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 4px",
                    borderBottom: "1px solid var(--cc-border)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>
                      {cand.name}
                    </div>
                    <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{formatHandle(cand.handle)}</div>
                  </div>
                  <Button
                    variant={already ? "ghost" : "primary"}
                    size="sm"
                    disabled={already || trackMutation.isPending}
                    onClick={() => trackMutation.mutate(cand.id)}
                  >
                    {already ? "Tracked" : "Track"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Modal>
    </div>
  );
}
