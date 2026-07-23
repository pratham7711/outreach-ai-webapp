"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Button, EmptyState, Skeleton } from "@pratham7711/ui";
import { FileText, DollarSign, Clock, Clapperboard } from "lucide-react";

type JoinedCampaign = {
  campaignId: string;
  title: string;
  slug: string | null;
  orgName: string;
  currency: string;
  rates: Partial<Record<"TIKTOK" | "INSTAGRAM" | "YOUTUBE", number>>;
  submissionCount: number;
  approvedMinor: number;
  pendingMinor: number;
  minPayoutMinor: number | null;
};

function fmtMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

function fmtRate(minor: number, currency: string) {
  // Per-1k views rate in major units.
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export default function PortalMyCampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<JoinedCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/campaigns");
      if (res.status === 401) {
        router.push("/portal/login");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns ?? []);
      } else {
        setError("Failed to load your campaigns");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  if (loading) {
    return (
      <div className="rsp-page" style={{ maxWidth: 960 }}>
        <Skeleton width="220px" height="32px" />
        <div className="rsp-grid-3" style={{ marginTop: 24 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height="200px" borderRadius="12px" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>My Campaigns</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Campaigns you&apos;ve joined — submit content and track earnings.</p>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEE2E2", color: "#DC2626", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {campaigns.length === 0 && !error ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState
            icon={<Clapperboard size={32} color="var(--cc-text-subtle)" />}
            title="No campaigns yet"
            description="Browse the marketplace to find campaigns to join and start earning."
            action={
              <Link href="/explore">
                <Button variant="primary">Explore Campaigns</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="rsp-grid-3">
          {campaigns.map((c) => {
            const rateEntries = Object.entries(c.rates) as [string, number][];
            return (
              <Card key={c.campaignId} variant="solid" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{c.title}</h3>
                    <Badge variant="success">Joined</Badge>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>{c.orgName}</p>
                </div>

                {rateEntries.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {rateEntries.map(([platform, minor]) => (
                      <span
                        key={platform}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: "rgba(91,91,214,0.08)",
                          color: "var(--cc-primary)",
                        }}
                      >
                        {platform}: {fmtRate(minor, c.currency)}/1k
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FileText size={14} style={{ color: "var(--cc-text-muted)" }} />
                    <span style={{ fontSize: 13, color: "var(--cc-text)" }}>
                      {c.submissionCount} submission{c.submissionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <DollarSign size={14} style={{ color: "var(--cc-text-muted)" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>
                      {fmtMoney(c.approvedMinor, c.currency)} earned
                    </span>
                  </div>
                </div>

                {c.pendingMinor > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Clock size={13} style={{ color: "var(--cc-text-muted)" }} />
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      {fmtMoney(c.pendingMinor, c.currency)} pending review
                    </span>
                  </div>
                )}

                <div style={{ marginTop: "auto", paddingTop: 8 }}>
                  {c.slug ? (
                    <Link href={`/portal/campaigns/${c.slug}`}>
                      <Button variant="secondary" style={{ width: "100%" }}>
                        View &amp; Submit
                      </Button>
                    </Link>
                  ) : (
                    <Button variant="secondary" disabled style={{ width: "100%" }}>
                      Unavailable
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
