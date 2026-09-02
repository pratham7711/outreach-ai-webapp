"use client";

/**
 * Rendering only -- every number arrives already aggregated from
 * lib/platform/stats.ts. Nothing here fetches, and nothing here decides who may
 * look; the page's isPlatformAdmin() check is the only gate.
 */
import { useMemo, useState } from "react";
import { Badge, Card, Input } from "@pratham7711/ui";
import type { PlatformStats, TenantRow } from "@/lib/platform/stats";

const NUM = new Intl.NumberFormat("en-US");
const fmt = (n: number) => NUM.format(n);

/** Tone for a subscription status. Suspended and past-due must not read as fine. */
function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "TRIALING") return "neutral";
  if (status === "PAST_DUE") return "warning";
  return "danger"; // SUSPENDED, CANCELLED
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--cc-text-muted)", marginTop: 6 }}>{hint}</div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "0 0 12px" }}>{subtitle}</p>
      )}
      {children}
    </section>
  );
}

/** One row per platform, three populations side by side so they cannot be confused. */
function PlatformBreakdown({ stats }: { stats: PlatformStats }) {
  const platforms = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(stats.creators.portalSignups.byPlatform),
      ...Object.keys(stats.creators.agencyRosters.byPlatform),
      ...Object.keys(stats.creators.connectedAccounts.byPlatform),
    ]);
    return [...keys].sort(
      (a, b) =>
        (stats.creators.agencyRosters.byPlatform[b] ?? 0) -
        (stats.creators.agencyRosters.byPlatform[a] ?? 0),
    );
  }, [stats]);

  if (!platforms.length) {
    return <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No creators yet.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--cc-text-muted)", fontSize: 12 }}>
            <th style={{ padding: "8px 12px" }}>Platform</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Portal signups</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Agency rosters</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Connected accounts</th>
          </tr>
        </thead>
        <tbody>
          {platforms.map((p) => (
            <tr key={p} style={{ borderTop: "1px solid var(--cc-border)" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--cc-text)" }}>{p}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--cc-text)" }}>
                {fmt(stats.creators.portalSignups.byPlatform[p] ?? 0)}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--cc-text)" }}>
                {fmt(stats.creators.agencyRosters.byPlatform[p] ?? 0)}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--cc-text)" }}>
                {fmt(stats.creators.connectedAccounts.byPlatform[p] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TenantTable({ tenants }: { tenants: TenantRow[] }) {
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? tenants.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            t.subdomain.toLowerCase().includes(needle) ||
            t.plan.toLowerCase().includes(needle),
        )
      : tenants;
    // Busiest first: the operator's question is almost always "who is driving this".
    return [...filtered].sort((a, b) => b.posts - a.posts || b.campaigns - a.campaigns);
  }, [tenants, q]);

  return (
    <>
      <div style={{ marginBottom: 12, maxWidth: 320 }}>
        <Input
          placeholder="Search org, subdomain or tier…"
          value={q}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
        />
      </div>
      <div
        style={{
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 12,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--cc-text-muted)", fontSize: 12 }}>
              <th style={{ padding: "10px 12px" }}>Organization</th>
              <th style={{ padding: "10px 12px" }}>Tier</th>
              <th style={{ padding: "10px 12px" }}>Status</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Campaigns</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Creators</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Clients</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Posts</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Users</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Synced 30d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid var(--cc-border)" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 600, color: "var(--cc-text)" }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                    {t.subdomain} · {t.orgType}
                  </div>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <Badge variant="neutral" style={{ fontSize: 11 }}>
                    {t.plan}
                  </Badge>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <Badge variant={statusTone(t.subscriptionStatus)} style={{ fontSize: 11 }}>
                    {t.subscriptionStatus}
                  </Badge>
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt(t.campaigns)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt(t.creators)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt(t.clients)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt(t.posts)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt(t.users)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  {fmt(t.measuredInWindow)}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={9}
                  style={{ padding: 24, textAlign: "center", color: "var(--cc-text-muted)" }}
                >
                  No organizations match “{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PlatformDashboardClient({ stats }: { stats: PlatformStats }) {
  const { orgs, creators, campaigns, posts, clients, cost } = stats;

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Platform
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Every organization on the platform. Operator-only — this is the one screen that reads
          across tenants.
        </p>
      </div>

      <Section title="Who we serve">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            label="Organizations"
            value={fmt(orgs.total)}
            hint={Object.entries(orgs.byStatus)
              .map(([k, v]) => `${v} ${k.toLowerCase()}`)
              .join(" · ")}
          />
          <StatCard
            label="Clients (their brands)"
            value={fmt(clients.total)}
            hint="Brands our agencies serve — not our customers"
          />
          <StatCard
            label="Campaigns"
            value={fmt(campaigns.total)}
            hint={`${fmt(campaigns.byStatus.IN_PROGRESS ?? 0)} active`}
          />
          <StatCard
            label="Posts tracked"
            value={fmt(posts.total)}
            hint={`${fmt(posts.deadLettered)} sync-disabled`}
          />
        </div>
      </Section>

      <Section
        title="Creators"
        subtitle="Three different populations. Portal signups are people who registered with us; agency rosters are rows an agency added, most of whom have never heard of us; connected accounts are the ones we can read through an official API."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <StatCard
            label="Portal signups"
            value={fmt(creators.portalSignups.total)}
            hint="Registered a login with us"
          />
          <StatCard
            label="Agency rosters"
            value={fmt(creators.agencyRosters.total)}
            hint="Added by an agency"
          />
          <StatCard
            label="Connected accounts"
            value={fmt(creators.connectedAccounts.total)}
            hint="Linked an API token"
          />
        </div>
        <Card>
          <div style={{ padding: 4 }}>
            <PlatformBreakdown stats={stats} />
          </div>
        </Card>
      </Section>

      <Section
        title="Cost meters"
        subtitle={`Internal usage over the last ${stats.windowDays} days. These are the units that drive the Neon and Vercel bills — dollar figures come later, from the billing APIs.`}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            label="Syncable posts"
            value={fmt(cost.syncablePosts)}
            hint="What the cron may sweep — the recurring driver"
          />
          <StatCard
            label={`Snapshots · ${stats.windowDays}d`}
            value={fmt(cost.snapshotsInWindow)}
            hint={`${fmt(cost.totalSnapshots)} all time`}
          />
          <StatCard
            label={`Refresh runs · ${stats.windowDays}d`}
            value={fmt(cost.refreshRunsInWindow)}
            hint={`${fmt(cost.totalRefreshRuns)} all time`}
          />
          <StatCard
            label="Audit log rows"
            value={fmt(cost.totalAuditLogs)}
            hint="Kept indefinitely by design"
          />
        </div>
      </Section>

      <Section title="Organizations" subtitle="Sorted by posts tracked — busiest first.">
        <TenantTable tenants={stats.tenants} />
      </Section>

      <p style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
        Generated {new Date(stats.generatedAt).toUTCString()}
      </p>
    </div>
  );
}
