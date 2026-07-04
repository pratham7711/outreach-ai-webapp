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
  const [campaignType, setCampaignType] = useState("ALL");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchCampaigns = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (campaignType !== "ALL") params.set("campaignType", campaignType);
    if (minBudget) params.set("minBudget", minBudget);
    if (maxBudget) params.set("maxBudget", maxBudget);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", "20");
    const res = await fetch(`/api/portal/discover?${params}`);
    if (res.status === 401) { router.push("/portal/login"); return; }
    if (res.ok) {
      const data = await res.json();
      setCampaigns(data.campaigns);
      setTotal(data.pagination.total ?? 0);
      setTotalPages(data.pagination.totalPages ?? 1);
    }
    setLoading(false);
  }, [search, campaignType, minBudget, maxBudget, sort, page, router]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  useEffect(() => { setPage(1); }, [search, campaignType, minBudget, maxBudget, sort]);

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
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      <Skeleton width="300px" height="40px" />
      <div className="rsp-grid-2" style={{ marginTop: 24 }}>
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="200px" borderRadius="12px" />)}
      </div>
    </div>
  );

  return (
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>Discover Campaigns</h1>
        <Button variant="secondary" onClick={() => router.push("/portal/dashboard")}>Dashboard</Button>
      </div>
      <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
        Browse open campaigns{total > 0 ? ` · ${total} opportunities` : ""}
      </p>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search campaigns..."
          iconLeft={<Search size={16} />}
        />
      </div>

      {/* Type pills + sort row */}
      {(() => {
        const TYPE_LABELS: Record<string, string> = {
          ALL: "All", BUDGET_BASED: "Budget", VIEW_BASED: "View-Based",
          OPEN_COMMUNITY: "Community", PRIVATE_INVITE: "Private",
        };
        const TYPES = ["ALL", "BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"];
        return (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setCampaignType(t)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 20,
                    border: `1px solid ${campaignType === t ? "var(--cc-primary)" : "var(--cc-border)"}`,
                    background: campaignType === t ? "var(--cc-primary)" : "var(--cc-card)",
                    color: campaignType === t ? "white" : "var(--cc-text-muted)",
                    fontSize: 13,
                    fontWeight: campaignType === t ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Sort:</span>
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--cc-border)", fontSize: 13, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none" }}
              >
                <option value="newest">Newest First</option>
                <option value="budget_desc">Highest Budget</option>
                <option value="budget_asc">Lowest Budget</option>
                <option value="proposals_desc">Most Proposals</option>
              </select>
            </div>
          </div>
        );
      })()}

      {/* Budget range row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Budget:</span>
        <Input type="number" placeholder="Min $" value={minBudget} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinBudget(e.target.value)} style={{ width: 110 }} />
        <span style={{ color: "var(--cc-text-muted)", fontSize: 13 }}>—</span>
        <Input type="number" placeholder="Max $" value={maxBudget} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxBudget(e.target.value)} style={{ width: 110 }} />
        {(minBudget || maxBudget) && (
          <button onClick={() => { setMinBudget(""); setMaxBudget(""); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--cc-text-muted)", textDecoration: "underline" }}>Clear</button>
        )}
      </div>

      {/* Campaign Grid */}
      {campaigns.length === 0 ? (
        <EmptyState icon="🔍" title="No open campaigns" description="Check back later for new opportunities." />
      ) : (
        <div className="rsp-grid-3">
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 24 }}>
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
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
