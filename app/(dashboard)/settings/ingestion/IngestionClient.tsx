"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, Badge, Button, StatCard, EmptyState, Skeleton } from "@pratham7711/ui";
import { formatDateAbs, formatDateTimeAbs } from "@/lib/format";

type PlatformStats = {
  platform: string;
  total: number;
  syncedLast24h: number;
  neverSynced: number;
  deadLettered: number;
  sealed: number;
  lastSyncAt: string | null;
};

type DeadLetterPost = {
  id: string;
  postUrl: string;
  platform: string;
  syncFailCount: number;
  syncDisabledAt: string | null;
  campaignTitle: string | null;
};

type SnapshotSource = {
  syncSource: string;
  count: number;
};

const PLATFORM_LABELS: Record<string, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
};

const cellStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--cc-border)",
  fontSize: 13,
  color: "var(--cc-text)",
} as const;

export default function IngestionClient() {
  const [perPlatform, setPerPlatform] = useState<PlatformStats[]>([]);
  const [deadLetter, setDeadLetter] = useState<DeadLetterPost[]>([]);
  const [recentSnapshots, setRecentSnapshots] = useState<SnapshotSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/ingestion/status")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load ingestion status");
        return r.json();
      })
      .then((data) => {
        setPerPlatform(Array.isArray(data?.perPlatform) ? data.perPlatform : []);
        setDeadLetter(Array.isArray(data?.deadLetter) ? data.deadLetter : []);
        setRecentSnapshots(Array.isArray(data?.recentSnapshots) ? data.recentSnapshots : []);
      })
      .catch(() => setError("Failed to load ingestion status"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rsp-page page-enter">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Ingestion Health</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Sync status per platform, dead-lettered posts, and snapshot sources</p>
      </div>

      {error && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid var(--cc-border)", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--cc-text-muted)" }}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Skeleton width="100%" height="120px" borderRadius="12px" />
          <Skeleton width="100%" height="120px" borderRadius="12px" />
          <Skeleton width="100%" height="120px" borderRadius="12px" />
          <Skeleton width="100%" height="240px" borderRadius="12px" />
        </div>
      ) : (
        !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {perPlatform.map((p) => (
              <div key={p.platform}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Badge variant="neutral" size="sm">{PLATFORM_LABELS[p.platform] ?? p.platform}</Badge>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {p.lastSyncAt ? `Last sync ${formatDateTimeAbs(p.lastSyncAt)}` : "No syncs yet"}
                    {` · ${p.sealed} sealed`}
                  </span>
                </div>
                <div className="rsp-grid-tiles">
                  <StatCard value={String(p.total)} label="Total posts" />
                  <StatCard value={String(p.syncedLast24h)} label="Synced last 24h" />
                  <StatCard value={String(p.neverSynced)} label="Never synced" />
                  <StatCard value={String(p.deadLettered)} label="Dead-lettered" />
                </div>
              </div>
            ))}

            <Card variant="outlined" style={{ padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 16px" }}>Dead-lettered posts</h2>
              {deadLetter.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 size={32} color="var(--cc-text-subtle)" />}
                  title="No failed posts — ingestion healthy"
                  description="Posts that repeatedly fail to sync will appear here."
                />
              ) : (
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                    <thead>
                      <tr>
                        {["Post URL", "Platform", "Fail count", "Disabled"].map((h) => (
                          <th key={h} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", padding: "8px 12px", borderBottom: "1px solid var(--cc-border)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {deadLetter.map((p) => (
                        <tr key={p.id}>
                          <td style={{ ...cellStyle, maxWidth: 360 }}>
                            <a
                              href={p.postUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "var(--cc-primary)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              {p.postUrl}
                            </a>
                            {p.campaignTitle && (
                              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{p.campaignTitle}</span>
                            )}
                          </td>
                          <td style={cellStyle}>
                            <Badge variant="neutral" size="sm">{PLATFORM_LABELS[p.platform] ?? p.platform}</Badge>
                          </td>
                          <td style={cellStyle}>{p.syncFailCount}</td>
                          <td style={cellStyle}>
                            {p.syncDisabledAt ? formatDateAbs(p.syncDisabledAt) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card variant="outlined" style={{ padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 16px" }}>Snapshot sources (last 24h)</h2>
              {recentSnapshots.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>No snapshots recorded in the last 24 hours</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {recentSnapshots.map((s) => (
                    <div key={s.syncSource} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", border: "1px solid var(--cc-border)", borderRadius: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-text)" }}>{s.syncSource}</span>
                      <Badge variant="neutral" size="sm">{s.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )
      )}
    </div>
  );
}
