"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, Input } from "@pratham7711/ui";
import { Modal, ModalNotice } from "@/components/ds/Modal";
import {
  Button,
  DataTable,
  Dropdown,
  ListToolbar,
  MoreMenu,
  NoResults,
  Pagination,
  Skeleton,
  useConfirm,
  type DataTableColumn,
} from "@/components/ds";
import { Eye, RefreshCw, Search, SearchX, Trash2, UserPlus, Users } from "lucide-react";
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
import { EmptyRosterNotice } from "@/components/CreatorSelect";
import { PeriodControl } from "./PeriodControl";

/**
 * The Creators sub-tab of Trackers: one table row per tracked creator, each
 * figure a value over its change and the reading's age.
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
  /** False when the count is the creator's stored figure, not a tracker reading. */
  followersFromReading?: boolean;
  followersChangePercent: number | null;
  followersDelta: number | null;
  lastReadAt: string | null;
  lastAttemptAt: string | null;
  health: "pending" | "live" | "regressed" | "stale";
  /** Why the last read produced nothing, already worded for a reader. */
  readError: string | null;
  /** Why the last read, which worked, still carried no views. */
  viewsNote?: string | null;
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
  { key: "views", label: "Avg. views" },
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
    if (c.viewsNote) return c.viewsNote;
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

function ChangeValue({ percent, title }: { percent: number; title?: string }) {
  return (
    <span className="cc-tracker-change" data-down={percent < 0 ? "" : undefined} title={title || undefined}>
      {percent >= 0 ? "+" : ""}
      {percent.toFixed(2)}%
    </span>
  );
}

function NoData({ title }: { title: string }) {
  return (
    <span className="cc-tracker-nodata" title={title}>
      {NO_DATA}
    </span>
  );
}

/* The columns, built once per change of what they read: the list's search box
   re-renders this component on every keystroke, and rebuilding the table then
   re-rendered all fifty rows and their hundred age labels before the debounced
   search had even been sent. */
function creatorColumns({
  period,
  cadenceHours,
  anyFollowersChange,
  anyViewsChange,
  untracking,
  refreshing,
  onUntrack,
  onOpen,
  onRefresh,
}: {
  period: string;
  cadenceHours: number | null;
  anyFollowersChange: boolean;
  anyViewsChange: boolean;
  untracking: boolean;
  refreshing: boolean;
  onUntrack: (c: TrackedCreator) => void;
  onOpen: (id: string) => void;
  onRefresh: (id: string) => void;
}): DataTableColumn<TrackedCreator>[] {
  const span = periodLabel(period).toLowerCase();
  return [
    {
      key: "creator",
      header: "Creator",
      minWidth: 220,
      render: (c) => (
        <div className="cc-creator-cell">
          <CreatorAvatar id={c.id} name={c.name} size="sm" />
          <span className="cc-creator-cell-text">
            <button
              type="button"
              className="cc-row-open cc-dt-truncate"
              onClick={() => onOpen(c.id)}
              title={c.name}
              aria-label={`Open details for ${c.name}`}
            >
              {c.name}
            </button>
            <span className="cc-dt-sub cc-dt-truncate">{formatHandle(c.handle)}</span>
          </span>
        </div>
      ),
    },
    {
      key: "followers",
      header: "Followers",
      width: 216,
      align: "right",
      render: (c) => {
        const followers = trackedFigures(c).followers;
        return (
          <>
            <span className="cc-tracker-figure" title={metricReason(followers)}>
              <MetricFigure value={followers} />
            </span>
            <span className="cc-tracker-sub">
              {anyFollowersChange ? (
                c.followersChangePercent !== null ? (
                  <ChangeValue
                    percent={c.followersChangePercent}
                    title={
                      c.followersDelta !== null
                        ? `${c.followersDelta >= 0 ? "+" : ""}${c.followersDelta.toLocaleString()} followers over ${span}`
                        : undefined
                    }
                  />
                ) : (
                  <NoData title={followersReason(c, period)} />
                )
              ) : null}
              {isUnknownMetric(followers) ? null : c.followersFromReading === false ? (
                <AgeLabel at={null} field="tracker" source="Creator record" never="not yet read by the tracker" />
              ) : (
                <AgeLabel at={c.lastReadAt} field="tracker" ctx={{ cadenceHours }} source="Tracker reading" never="time not recorded" />
              )}
            </span>
          </>
        );
      },
    },
    {
      key: "avgViews",
      header: "Avg. views",
      width: 176,
      align: "right",
      render: (c) => {
        const v = c.views;
        const avgViews = trackedFigures(c).avgViews;
        return (
          <>
            <span
              className="cc-tracker-figure"
              title={
                isUnknownMetric(avgViews)
                  ? viewsReason(c)
                  : `Average views of their 10 newest posts, pinned posts left out. Measured ${timeAgo(v.measuredAt)}.`
              }
            >
              <MetricFigure value={avgViews} />
            </span>
            <span className="cc-tracker-sub">
              {anyViewsChange ? (
                v.changePercent !== null ? (
                  <ChangeValue
                    percent={v.changePercent}
                    title={
                      v.delta !== null
                        ? `${v.delta >= 0 ? "+" : ""}${Math.round(v.delta).toLocaleString()} average views over ${span}`
                        : undefined
                    }
                  />
                ) : (
                  <NoData title={viewsReason(c)} />
                )
              ) : null}
              {isUnknownMetric(avgViews) ? null : (
                <AgeLabel at={v.measuredAt} field="tracker" ctx={{ cadenceHours }} source="Tracker reading" never="time not recorded" />
              )}
            </span>
          </>
        );
      },
    },
    {
      key: "posts",
      header: "Posts",
      width: 88,
      align: "right",
      render: (c) => (
        <span title={`${c.metrics.postsInWindow} ${c.metrics.postsInWindow === 1 ? "post" : "posts"} tracked with them over ${span}`}>
          {c.metrics.postsInWindow.toLocaleString()}
        </span>
      ),
    },
    {
      key: "since",
      header: "Tracked since",
      width: 132,
      render: (c) => (c.trackedSince ? formatDateAbs(c.trackedSince) : "—"),
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: 64,
      render: (c) => (
        <MoreMenu
          size="sm"
          label={`More actions for ${c.name}`}
          items={[
            { label: "Open details", icon: <Eye size={15} />, onClick: () => onOpen(c.id) },
            { label: "Refresh now", icon: <RefreshCw size={15} />, onClick: () => onRefresh(c.id), disabled: refreshing },
            {
              label: "Stop tracking",
              icon: <Trash2 size={15} />,
              onClick: () => onUntrack(c),
              disabled: untracking,
              danger: true,
              startsGroup: true,
            },
          ]}
        />
      ),
    },
  ];
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
  /* A change needs two readings inside the window, and view readings only
     count from 2026-10-02, so for a while every row said "No data yet." and
     the Change sort ranked on nothing. Each change, and the sort, appears once
     a creator on this page has one. */
  const anyViewsChange = creators.some((c) => c.views.changePercent !== null);
  const anyFollowersChange = creators.some((c) => c.followersChangePercent !== null);
  const sorts = SORTS.filter((s) => s.key !== "change" || anyViewsChange || sort === "change");
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
  /* Nothing typed and nobody came back: the roster is empty, and a search box
     over it would only ever answer "no match". */
  const rosterEmpty = !search && !!candidates && candidates.creators.length === 0;

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

  const { mutate: refreshOne, isPending: refreshingOne } = useMutation({
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

  const { mutate: untrackMutate, isPending: untracking } = useMutation({
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
      if (ok) untrackMutate(c.id);
    },
    /* mutate, not the mutation: the mutation object is new on every render,
       which would hand every memoised row a new callback. */
    [confirm, untrackMutate]
  );

  /* The page holds fifty, so the picker also trusts the creator's own row --
     a creator tracked on page 9 is still tracked. */
  const trackedIds = useMemo(() => new Set(creators.map((c) => c.id)), [creators]);

  /* The React Compiler memoises this component, so the columns and the table
     hold still while the search box is typed in. */
  const columns = creatorColumns({
    period,
    cadenceHours,
    anyFollowersChange,
    anyViewsChange,
    untracking,
    refreshing: refreshingOne,
    onUntrack: untrack,
    onOpen: setOpenCreator,
    onRefresh: refreshOne,
  });

  const firstRun = !isPending && !isError && creators.length === 0 && !q && !listSearch.trim();

  const table = (
      <DataTable
        className="cc-actions-table"
        caption="Tracked creators"
        columns={columns}
        rows={creators}
        rowKey={(c) => c.id}
        loading={isPending || (isFetching && creators.length > 0)}
        skeletonRows={4}
        empty={
          <NoResults
            onClear={() => setListSearch("")}
            clearLabel="Clear search"
            description={`Nothing you track matches "${q}".`}
          />
        }
        footer={
          data && data.total > 0 ? (
            <Pagination
              page={data.page}
              totalPages={data.pageCount}
              total={data.total}
              pageSize={data.pageSize}
              loading={isFetching}
              onPageChange={setPage}
            />
          ) : undefined
        }
      />
  );

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
      {firstRun ? (
        <EmptyState
          icon={<Users size={40} />}
          title="No creators tracked yet"
          description="Add a creator to watch their posting cadence and how their average views move week over week."
          action={
            <Button variant="primary" onClick={() => setPickerOpen(true)}>
              Track creator
            </Button>
          }
        />
      ) : (
        <>
          <ListToolbar
            search={{
              value: listSearch,
              onChange: setListSearch,
              placeholder: "Search creators",
              ariaLabel: "Search tracked creators by name or handle",
            }}
            end={
              <>
                <PeriodControl
                  periods={PERIODS}
                  value={period}
                  onChange={(key) => {
                    setPeriod(key);
                    setPage(1);
                  }}
                />
                <Dropdown
                  ariaLabel="Sort tracked creators"
                  size="md"
                  align="right"
                  value={sort}
                  onChange={(key) => {
                    setSort(key);
                    setPage(1);
                  }}
                  options={sorts.map((o) => ({ value: o.key, label: o.label }))}
                  minWidth={150}
                />
              </>
            }
          />
          {table}
        </>
      )}

      <CreatorDetailModal
        open={Boolean(openCreator)}
        onClose={() => setOpenCreator(null)}
        creator={creators.find((c) => c.id === openCreator) ?? null}
        onRefresh={refreshOne}
        refreshing={refreshingOne}
      />

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        icon={UserPlus}
        title="Track a creator"
        description={
          rosterEmpty
            ? "A tracked creator's followers and average views are read on a schedule."
            : "Search your roster. A tracked creator's followers and average views are read on a schedule."
        }
        size="sm"
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        {rosterEmpty ? (
          <EmptyRosterNotice />
        ) : (
          <div className="cc-dialog-stack">
            <Input
              placeholder="Search creators by name or handle"
              aria-label="Search creators by name or handle"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              iconLeft={<Search size={16} />}
              autoComplete="off"
              autoFocus
            />
            {searching && !candidates ? (
              <div className="cc-dialog-options" aria-busy="true" aria-label="Searching creators">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="cc-dialog-option" style={{ cursor: "default" }}>
                    <Skeleton width={36} height={36} circle />
                    <span className="cc-dialog-option__text">
                      <Skeleton width={140} height={14} />
                      <Skeleton width={90} height={12} />
                    </span>
                  </div>
                ))}
              </div>
            ) : (candidates?.creators ?? []).length === 0 ? (
              <ModalNotice icon={SearchX}>No creators match that.</ModalNotice>
            ) : (
              /* Ten at most (the request's limit), so the list scrolls inside
                 itself and the search box above it stays in view. */
              <div className="cc-dialog-options" style={{ maxHeight: "22rem", overflowY: "auto" }}>
                {(candidates?.creators ?? []).map((cand) => {
                  const already = trackedIds.has(cand.id) || Boolean(cand.trackedSince);
                  return (
                    <div key={cand.id} className="cc-dialog-option" style={{ cursor: "default" }}>
                      <CreatorAvatar id={cand.id} name={cand.name} size="sm" />
                      <span className="cc-dialog-option__text">
                        <span className="cc-dialog-option__title">{cand.name}</span>
                        <span className="cc-dialog-option__desc">{formatHandle(cand.handle)}</span>
                      </span>
                      <span className="cc-dialog-option__control">
                        <Button
                          variant={already ? "ghost" : "primary"}
                          size="sm"
                          disabled={already || trackMutation.isPending}
                          onClick={() => trackMutation.mutate(cand.id)}
                        >
                          {already ? "Tracked" : "Track"}
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
