"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, EmptyState, Input, Modal, Skeleton } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Play, Trash2, User, Users } from "lucide-react";
import { formatCompact } from "@/lib/format";
import { imgSrc } from "@/lib/postMedia";
import { apiDelete, apiFetch, apiPost } from "@/lib/api/client";
import { CreatorDetailModal } from "./CreatorDetailModal";
import type { ChartGranularity } from "@/lib/trackers/granularity";
import { errorMessage } from "@/lib/api/errorMessage";

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
  metrics: CreatorMetrics;
};

const PERIODS = [
  { key: "7d", label: "7 Days" },
  { key: "14d", label: "14 Days" },
  { key: "30d", label: "30 Days" },
];

const SORTS = [
  { key: "views", label: "Avg. Views" },
  { key: "change", label: "Change" },
  { key: "posts", label: "Posts" },
  { key: "followers", label: "Followers" },
];

const NO_DATA = "No data yet.";

function periodLabel(key: string): string {
  return PERIODS.find((p) => p.key === key)?.label ?? key;
}

function changeReasonText(m: CreatorMetrics, period: string): string {
  switch (m.changeAbsentReason) {
    case "no-posts-in-window":
      return `No posts in the last ${periodLabel(period).toLowerCase()}, so there is nothing to compare.`;
    case "no-posts-before":
      return `Nothing posted in the ${periodLabel(period).toLowerCase()} before this one, so there is no baseline.`;
    case "zero-baseline":
      return "Every post in the earlier period measured zero views, which gives no percentage to grow from.";
    default:
      return "";
  }
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
    return "We have not read this creator yet. The first reading usually lands within a few hours.";
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
  changeNode,
  changeTitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  changeNode: React.ReactNode;
  changeTitle: string;
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
        <div style={{ padding: "10px 16px", minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{label}</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--cc-primary)",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
        </div>
        <div style={{ padding: "10px 16px", flex: "0 0 auto" }} title={changeTitle}>
          <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Change</div>
          {changeNode}
        </div>
      </div>
    </div>
  );
}

function ChangeValue({ percent }: { percent: number }) {
  const up = percent >= 0;
  return (
    <div style={{ fontSize: 14, fontWeight: 700, color: up ? "var(--cc-primary)" : "#DC2626" }}>
      {up ? "+" : ""}
      {percent.toFixed(2)}%
    </div>
  );
}

function NoData({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--cc-text-subtle)" }} title={title}>
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

  const queryClient = useQueryClient();
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["creator-trackers"] });
  }, [queryClient]);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["creator-trackers", period, sort],
    queryFn: () =>
      apiFetch<{ creators: TrackedCreator[] }>(
        `/api/trackers/creators?period=${period}&sort=${sort}`
      ),
  });
  const creators = useMemo(() => data?.creators ?? [], [data]);

  // Only fetched while the picker is open, and only for what was typed.
  const { data: candidates, isFetching: searching } = useQuery({
    queryKey: ["creator-picker", search],
    queryFn: () =>
      apiFetch<{ creators: { id: string; name: string; handle: string; avatarUrl: string | null }[] }>(
        `/api/creators?limit=10${search ? `&search=${encodeURIComponent(search)}` : ""}`
      ),
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
      <div style={{ display: "flex", gap: 8 }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid var(--cc-primary)",
              background: period === p.key ? "var(--cc-primary)" : "var(--cc-card)",
              color: period === p.key ? "white" : "var(--cc-primary)",
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

      {creators.length === 0 ? (
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
            const avatar = imgSrc(c.avatarUrl, 112);
            const m = c.metrics;
            return (
              <Card key={c.id} variant="outlined" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 220px", minWidth: 200 }}>
                    {avatar ? (
                      <img
                        src={avatar}
                        alt=""
                        style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: "50%",
                          background: "var(--cc-bg)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <User size={22} style={{ color: "var(--cc-text-muted)" }} />
                      </div>
                    )}
                    <div
                      style={{ minWidth: 0, cursor: "pointer" }}
                      onClick={() => setOpenCreator(c.id)}
                    >
                      <div
                        title={c.name}
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          color: "var(--cc-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.name}
                      </div>
                      <div style={{ fontSize: 15, color: "var(--cc-text-muted)" }}>
                        @{c.handle}
                      </div>
                    </div>
                  </div>

                  <FigureGroup
                    icon={<User size={22} />}
                    label="Followers"
                    value={c.followersCount === null ? "—" : formatCompact(c.followersCount)}
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
                  />

                  <FigureGroup
                    icon={<Play size={22} />}
                    label={`Avg. Views (${periodLabel(period)})`}
                    value={m.avgViews === null ? "—" : formatCompact(Math.round(m.avgViews))}
                    changeNode={
                      m.changePercent !== null ? (
                        <ChangeValue percent={m.changePercent} />
                      ) : (
                        <NoData title={changeReasonText(m, period)} />
                      )
                    }
                    changeTitle={
                      m.changePercent !== null
                        ? `${m.postsInWindow} post${m.postsInWindow === 1 ? "" : "s"} this period against ${m.postsInPrevious} in the one before`
                        : ""
                    }
                  />

                  <button
                    onClick={() => untrackMutation.mutate(c.id)}
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
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", padding: "12px 4px" }}>
              No creators match that.
            </p>
          ) : (
            (candidates?.creators ?? []).map((cand) => {
              const already = trackedIds.has(cand.id);
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
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                      {cand.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{cand.handle}</div>
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
