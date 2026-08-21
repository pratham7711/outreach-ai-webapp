"use client";
import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Card, Button, Modal, Input, Skeleton, EmptyState } from "@pratham7711/ui";
import { MetricTile } from "@/components/ds";
import { Music, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { CreatorTrackers } from "./CreatorTrackers";
import { formatCompact, formatDateAbs } from "@/lib/format";
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
];

export default function TrackersPage() {
  const [sub, setSub] = useState("sound");
  // Held here so the header button can open the picker the Creators tab owns.
  const [creatorPickerOpen, setCreatorPickerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({ tiktokSoundId: "", title: "", artist: "" });
  const [period, setPeriod] = useState("24h");
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

  const sounds = useMemo(() => data?.sounds ?? [], [data]);

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
      totalTrackers: sounds.length,
      totalUses: sounds.reduce((sum, s) => sum + (s.latestSnapshot?.usesCount ?? 0), 0),
      trendingCount: sounds.filter((s) => s.status === "viral" || s.status === "trending").length,
      newToday: sounds.reduce((sum, s) => sum + (s.addedInPeriod ?? 0), 0),
    }),
    [sounds]
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
      ) : sounds.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={40} />}
          title="No trackers yet"
          description="Start tracking TikTok sounds to monitor their performance and trends."
          action={<Button variant="primary" onClick={() => setModalOpen(true)}>Track Sound</Button>}
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
                  <div title={s.title} style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{s.artist || "Unknown artist"}</div>
                </div>
                <Badge variant={STATUS_VARIANTS[s.status]} size="sm">
                  {s.status === "unknown" ? "no data" : s.status}
                </Badge>
                <div style={{ textAlign: "right", minWidth: 96 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>
                    {snap ? formatCount(snap.usesCount) : "—"}
                  </div>
                  {measured && added !== null ? (
                    <div style={{ fontSize: 12, color: added >= 0 ? "var(--cc-primary)" : "#ef4444" }}>
                      {added >= 0 ? "+" : ""}
                      {formatCount(added)} / {periodLabel(period)}
                      {s.growthPercentage !== null
                        ? ` (${s.growthPercentage >= 0 ? "+" : ""}${s.growthPercentage.toFixed(1)}%)`
                        : ""}
                    </div>
                  ) : (
                    <div
                      style={{ fontSize: 12, color: "var(--cc-text-muted)" }}
                      title={
                        s.snapshotCount < 2
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
    </div>
  );
}
