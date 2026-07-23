"use client";
import { useState, useEffect, useCallback } from "react";
import { Badge, Card, StatCard, Button, Modal, Input, Skeleton, EmptyState } from "@pratham7711/ui";
import { Music, Plus, Trash2, TrendingUp } from "lucide-react";
import { formatCompact, formatDateAbs } from "@/lib/format";

interface SoundSnapshot {
  usesCount: number;
  deltaUses24h: number;
  velocityScore: number;
  videosAdded24h: number;
  recordedAt: string;
}

interface TrackedSound {
  id: string;
  tiktokSoundId: string;
  title: string;
  artist: string;
  coverImageUrl: string | null;
  trackedSince: string;
  latestSnapshot: SoundSnapshot | null;
}

function formatCount(n: number): string {
  return formatCompact(n);
}

function getVelocityBadge(score: number): { label: string; variant: "success" | "accent" | "neutral" | "danger" } {
  if (score > 10) return { label: "viral", variant: "success" };
  if (score > 5) return { label: "trending", variant: "accent" };
  if (score > 0) return { label: "stable", variant: "neutral" };
  return { label: "declining", variant: "danger" };
}

export default function TrackersPage() {
  const [sounds, setSounds] = useState<TrackedSound[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({ tiktokSoundId: "", title: "", artist: "" });
  const [submitting, setSubmitting] = useState(false);

  const fetchSounds = useCallback(async () => {
    try {
      const res = await fetch("/api/trackers");
      if (res.ok) {
        const data = await res.json();
        setSounds(data.sounds ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSounds(); }, [fetchSounds]);

  const handleCreate = async () => {
    if (!formData.tiktokSoundId || !formData.title) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/trackers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setModalOpen(false);
        setFormData({ tiktokSoundId: "", title: "", artist: "" });
        await fetchSounds();
      }
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/trackers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSounds((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      // silent
    }
  };

  // Stats
  const totalTrackers = sounds.length;
  const totalUses = sounds.reduce((sum, s) => sum + (s.latestSnapshot?.usesCount ?? 0), 0);
  const trendingCount = sounds.filter((s) => (s.latestSnapshot?.velocityScore ?? 0) > 5).length;
  const newToday = sounds.reduce((sum, s) => sum + (s.latestSnapshot?.videosAdded24h ?? 0), 0);

  return (
    <div className="rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Trackers</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track TikTok sounds and trends</p>
        </div>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          <Plus size={16} style={{ marginRight: 6 }} />
          Track Sound
        </Button>
      </div>

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
          <StatCard value={String(totalTrackers)} label="Active Trackers" />
          <StatCard value={formatCount(totalUses)} label="Total Uses" />
          <StatCard value={String(trendingCount)} label="Trending" />
          <StatCard value={formatCompact(newToday)} label="New Today" />
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
      ) : sounds.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={40} />}
          title="No trackers yet"
          description="Start tracking TikTok sounds to monitor their performance and trends."
          action={<Button variant="primary" onClick={() => setModalOpen(true)}>Track Sound</Button>}
        />
      ) : (
        <Card variant="outlined" noPadding>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Sound Trackers</span>
          </div>
          {sounds.map((s, i) => {
            const snap = s.latestSnapshot;
            const velocity = snap?.velocityScore ?? 0;
            const badge = getVelocityBadge(velocity);
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
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{s.artist || "Unknown artist"}</div>
                </div>
                <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                <div style={{ textAlign: "right", minWidth: 80 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{formatCount(snap?.usesCount ?? 0)}</div>
                  <div style={{ fontSize: 12, color: (snap?.deltaUses24h ?? 0) >= 0 ? "var(--cc-primary)" : "#ef4444" }}>
                    {(snap?.deltaUses24h ?? 0) >= 0 ? "+" : ""}{formatCount(snap?.deltaUses24h ?? 0)} / 24h
                  </div>
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
