"use client";
import { useCallback, useEffect, useState } from "react";
import { Camera, CheckCircle2, CircleAlert, Inbox } from "lucide-react";
import {
  PageHeader,
  MetricTile,
  SectionCard,
  DataTable,
  NoResults,
  LoadError,
  Skeleton,
  PlatformTag,
  type DataTableColumn,
} from "@/components/ds";
import { formatDateAbs, formatDateTimeAbs, platformLabel } from "@/lib/format";
import { InstagramSourceBanner } from "@/components/integrations/InstagramSourceBanner";

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

const DEAD_LETTER_COLUMNS: DataTableColumn<DeadLetterPost>[] = [
  {
    key: "post",
    header: "Post URL",
    minWidth: 280,
    primary: true,
    render: (p) => (
      <span className="cc-ingestion-post">
        <a href={p.postUrl} target="_blank" rel="noreferrer" title={p.postUrl} className="cc-dt-truncate cc-ingestion-post__url">
          {p.postUrl}
        </a>
        {p.campaignTitle ? <span className="cc-dt-truncate cc-ingestion-post__campaign">{p.campaignTitle}</span> : null}
      </span>
    ),
  },
  { key: "platform", header: "Platform", width: 140, render: (p) => <PlatformTag platform={p.platform} /> },
  { key: "fails", header: "Fail count", width: 120, align: "right", render: (p) => p.syncFailCount.toLocaleString("en-US") },
  { key: "disabled", header: "Disabled", width: 140, render: (p) => (p.syncDisabledAt ? formatDateAbs(p.syncDisabledAt) : "—") },
];

const SNAPSHOT_COLUMNS: DataTableColumn<SnapshotSource>[] = [
  { key: "source", header: "Source", minWidth: 200, render: (s) => s.syncSource },
  { key: "count", header: "Snapshots", width: 140, align: "right", render: (s) => s.count.toLocaleString("en-US") },
];

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
      <PageHeader
        title="Ingestion"
        subtitle="Sync health per platform, dead-lettered posts and snapshot sources."
      />

      <div className="cc-ingestion-stack">
        {/* Above the per-platform tiles, and outside the loading branch: the
            Instagram rows below keep reporting healthy syncs while views are
            frozen, because the embed fallback still answers. This is the line
            that says which number stopped. */}
        <InstagramSourceBanner />

        {error ? (
          <LoadError title="Ingestion status could not be loaded" onRetry={load} retrying={loading} />
        ) : loading ? (
          <div className="cc-ingestion-stack" aria-busy="true">
            <div className="cc-tiles-balanced">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={104} radius="var(--cc-r-card)" />
              ))}
            </div>
            <Skeleton height={240} radius="var(--cc-r-card)" />
          </div>
        ) : (
          <>
            {/* The API returns only platforms this org has posts on, so an
                empty list means there is genuinely nothing to ingest yet. */}
            {perPlatform.length === 0 ? (
              <SectionCard icon={Inbox} title="Platforms">
                <NoResults
                  icon={<CheckCircle2 size={32} strokeWidth={1.75} />}
                  title="No posts to ingest yet"
                  description="Add a post to a campaign and its platform will appear here with its sync health."
                />
              </SectionCard>
            ) : (
              perPlatform.map((p) => (
                <section key={p.platform} className="cc-ingestion-platform" aria-label={`${platformLabel(p.platform)} sync health`}>
                  <header className="cc-ingestion-platform__head">
                    <h2 className="cc-ingestion-platform__title">
                      <PlatformTag platform={p.platform} />
                    </h2>
                    <span className="cc-ingestion-platform__meta">
                      {p.lastSyncAt ? `Last sync ${formatDateTimeAbs(p.lastSyncAt)}` : "No syncs yet"}
                      {` · ${p.sealed.toLocaleString("en-US")} sealed`}
                    </span>
                  </header>
                  <div className="cc-tiles-balanced">
                    <MetricTile metric="ingestionTotalPosts" value={p.total.toLocaleString("en-US")} />
                    <MetricTile metric="ingestionSynced24h" value={p.syncedLast24h.toLocaleString("en-US")} />
                    <MetricTile metric="ingestionNeverSynced" value={p.neverSynced.toLocaleString("en-US")} />
                    <MetricTile metric="ingestionDeadLettered" value={p.deadLettered.toLocaleString("en-US")} />
                  </div>
                </section>
              ))
            )}

            <SectionCard icon={CircleAlert} title="Dead-lettered posts" padded={false}>
              <DataTable
                bare
                caption="Dead-lettered posts"
                columns={DEAD_LETTER_COLUMNS}
                rows={deadLetter}
                rowKey={(p) => p.id}
                empty={
                  <NoResults
                    icon={<CheckCircle2 size={32} strokeWidth={1.75} />}
                    title="No failed posts"
                    description="Ingestion is healthy. Posts that repeatedly fail to sync appear here."
                  />
                }
              />
            </SectionCard>

            <SectionCard icon={Camera} title="Snapshot sources (last 24h)" padded={false}>
              <DataTable
                bare
                caption="Snapshot sources in the last 24 hours"
                columns={SNAPSHOT_COLUMNS}
                rows={recentSnapshots}
                rowKey={(s) => s.syncSource}
                empty={
                  <NoResults
                    icon={<Camera size={32} strokeWidth={1.75} />}
                    title="No snapshots in the last 24 hours"
                    description="Snapshots written in the last 24 hours appear here, grouped by source."
                  />
                }
              />
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
