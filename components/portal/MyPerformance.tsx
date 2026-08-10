"use client";

import React from "react";
import { useEffect, useState } from "react";
import { Card, Skeleton, Button } from "@pratham7711/ui";
import { ExternalLink } from "lucide-react";
import { ConnectPrompt } from "./ConnectPrompt";

type Post = {
  id: string;
  caption: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  postedAt: string;
  shareUrl: string | null;
};

type Insights = {
  connected: boolean;
  needsReconnect?: boolean;
  handle?: string;
  followers?: number;
  sampleSize?: number;
  totalViews?: number;
  medianViews?: number;
  bestPost?: { id: string; caption: string | null; views: number; shareUrl: string | null } | null;
  posts: Post[];
};

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{value}</div>
    </div>
  );
}

export function MyPerformance() {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/portal/insights")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!data) return <Skeleton width="100%" height="160px" borderRadius="12px" />;

  if (!data.connected) {
    return <ConnectPrompt variant="banner" returnTo="/portal/dashboard" />;
  }

  if (data.needsReconnect) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
          Reconnect {data.handle}
        </div>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 14 }}>
          Your TikTok authorisation has lapsed, so we can&rsquo;t refresh your numbers.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.location.href =
              "/api/portal/connections/tiktok/start?returnTo=%2Fportal%2Fdashboard";
          }}
        >
          Reconnect TikTok
        </Button>
      </Card>
    );
  }

  if ((data.sampleSize ?? 0) === 0) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
          {data.handle} is connected
        </div>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          Publish a public post and your performance will show up here automatically.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="outlined" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>
          Your performance
        </div>
        <div style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>
          {data.handle} &middot; based on your last {data.sampleSize} public posts
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <Stat label="Followers" value={compact(data.followers ?? 0)} />
        <Stat label="Views (recent posts)" value={compact(data.totalViews ?? 0)} />
        <Stat label="Median views per post" value={compact(data.medianViews ?? 0)} />
      </div>

      {data.bestPost && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--cc-bg)",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>
            Best performing post &middot; {compact(data.bestPost.views)} views
          </div>
          <div style={{ fontSize: 13, color: "var(--cc-text)", display: "flex", gap: 8 }}>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {data.bestPost.caption ?? "Untitled post"}
            </span>
            {data.bestPost.shareUrl && (
              <a
                href={data.bestPost.shareUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--cc-primary)", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                View <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.posts.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 13,
              color: "var(--cc-text-muted)",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--cc-text)",
              }}
            >
              {p.caption ?? "Untitled post"}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              {compact(p.views)} views &middot; {compact(p.likes)} likes
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
