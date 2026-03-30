"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Search, DollarSign, Users, FileText, Send } from "lucide-react";

type Campaign = {
  id: string;
  title: string;
  campaignType: string;
  budget: number | null;
  currency: string;
  thumbnailUrl: string | null;
  notes: string | null;
  createdAt: string;
  org: { id: string; name: string; logoUrl: string | null };
  _count: { activations: number; posts: number; proposals: number };
  alreadyProposed: boolean;
};

const TYPE_BADGE: Record<string, "accent" | "success" | "warning" | "neutral"> = {
  BUDGET_BASED: "accent",
  VIEW_BASED: "success",
  OPEN_COMMUNITY: "warning",
  PRIVATE_INVITE: "neutral",
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function PortalDiscoverPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showPropose, setShowPropose] = useState<Campaign | null>(null);
  const [proposedRate, setProposedRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const res = await fetch(`/api/portal/discover?${params}`);
    if (res.status === 401) { router.push("/portal/login"); return; }
    if (res.ok) {
      const data = await res.json();
      setCampaigns(data.campaigns);
    }
    setLoading(false);
  }, [search, router]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handlePropose = async () => {
    if (!showPropose || !proposedRate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: showPropose.id, proposedRate: Number(proposedRate) }),
      });
      if (res.ok) {
        setShowPropose(null);
        setProposedRate("");
        fetchCampaigns();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      <Skeleton width="300px" height="40px" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginTop: 24 }}>
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="200px" borderRadius="12px" />)}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>Discover Campaigns</h1>
        <Button variant="secondary" onClick={() => router.push("/portal/dashboard")}>Dashboard</Button>
      </div>
      <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>Browse open campaigns and submit proposals</p>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search campaigns..."
          iconLeft={<Search size={16} />}
        />
      </div>

      {/* Campaign Grid */}
      {campaigns.length === 0 ? (
        <EmptyState icon="🔍" title="No open campaigns" description="Check back later for new opportunities." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {campaigns.map(c => (
            <Card key={c.id} variant="outlined" style={{ padding: 0, overflow: "hidden" }}>
              {c.thumbnailUrl && (
                <div style={{ width: "100%", height: 120, background: `url(${c.thumbnailUrl}) center/cover`, borderBottom: "1px solid var(--cc-border)" }} />
              )}
              <div style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{c.title}</h3>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c.org.name}</p>
                  </div>
                  <Badge variant={TYPE_BADGE[c.campaignType] ?? "neutral"} style={{ fontSize: 10 }}>
                    {c.campaignType.replace(/_/g, " ")}
                  </Badge>
                </div>

                {c.budget && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8, fontSize: 14, fontWeight: 700, color: "var(--cc-primary)" }}>
                    <DollarSign size={14} /> Budget: {formatCurrency(c.budget, c.currency)}
                  </div>
                )}

                {c.notes && (
                  <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 12, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {c.notes}
                  </p>
                )}

                <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 16 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Users size={12} />{c._count.activations} creators</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><FileText size={12} />{c._count.posts} posts</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Send size={12} />{c._count.proposals} proposals</span>
                </div>

                {c.alreadyProposed ? (
                  <Button variant="secondary" disabled style={{ width: "100%", fontSize: 13 }}>Already Proposed</Button>
                ) : (
                  <Button variant="primary" onClick={() => setShowPropose(c)} style={{ width: "100%", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}><Send size={14} /> Submit Proposal</span>
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Propose Modal */}
      {showPropose && (
        <Modal open={true} onClose={() => { setShowPropose(null); setProposedRate(""); }} title={`Propose for "${showPropose.title}"`} size="sm" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => { setShowPropose(null); setProposedRate(""); }}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handlePropose} disabled={!proposedRate}>Submit Proposal</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {showPropose.budget && (
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                Campaign budget: <strong>{formatCurrency(showPropose.budget, showPropose.currency)}</strong>
              </p>
            )}
            <Input label="Your Rate" type="number" value={proposedRate} onChange={(e) => setProposedRate(e.target.value)} placeholder="e.g. 500" required />
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              Enter the rate you&apos;d like to charge for this campaign.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
