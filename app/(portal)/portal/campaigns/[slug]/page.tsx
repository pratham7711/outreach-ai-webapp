"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Button, Input, EmptyState, Skeleton } from "@pratham7711/ui";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, CheckCircle2, Download } from "lucide-react";

type Rates = Partial<Record<"TIKTOK" | "INSTAGRAM" | "YOUTUBE", number>>;

type CampaignDetail = {
  id: string;
  title: string;
  slug: string;
  status: string;
  currency: string;
  guidelines: string | null;
  requirements: string | null;
  contentAssetsUrl: string | null;
  rates: Rates;
  minPayoutMinor: number | null;
  submissionDeadline: string | null;
  deadlinePassed: boolean;
  orgName: string;
  orgLogoUrl: string | null;
};

type Submission = {
  id: string;
  postUrl: string;
  platform: string;
  status: string;
  viewsCount: number;
  thumbnailUrl: string | null;
  caption: string | null;
  rejectionReason: string | null;
  createdAt: string;
  earnedMinor: number;
};

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

function fmtMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

function CampaignDetailInner() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params.slug;
  const justJoined = searchParams.get("joined") === "1";
  const joinError = searchParams.get("joinError");

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/campaigns/${slug}`);
      if (res.status === 401) {
        router.push(`/portal/login?join=${encodeURIComponent(slug)}`);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setDetail(data.campaign);
        setSubmissions(data.submissions ?? []);
        setJoined(data.joined);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to load campaign");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [slug, router]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postUrl.trim()) {
      toast.error("Enter a post URL");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/campaigns/${slug}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postUrl: postUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Submission received — pending review");
        setPostUrl("");
        fetchDetail();
      } else {
        toast.error(data.error ?? "Failed to submit");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", padding: 32 }}>
        <Skeleton width="240px" height="32px" />
        <Skeleton width="100%" height="200px" borderRadius="12px" />
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", padding: 32 }}>
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState
            icon="⚠️"
            title="Campaign unavailable"
            description={error || "This campaign could not be found."}
            action={
              <Link href="/portal/campaigns">
                <Button variant="primary">Back to My Campaigns</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const rateEntries = Object.entries(detail.rates) as [string, number][];
  const canSubmit = joined && !detail.deadlinePassed;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Link href="/portal/campaigns" style={{ color: "var(--cc-text-muted)", textDecoration: "none", display: "flex", alignItems: "center" }}>
          <ArrowLeft size={16} />
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>{detail.title}</h1>
        <Badge variant="neutral">{detail.orgName}</Badge>
      </div>

      {justJoined && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, background: "#D1FAE5", color: "#059669", fontSize: 13, marginBottom: 16 }}>
          <CheckCircle2 size={16} /> You&apos;ve joined this campaign. Submit your content below.
        </div>
      )}
      {joinError && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEE2E2", color: "#DC2626", fontSize: 13, marginBottom: 16 }}>
          {joinError}
        </div>
      )}

      {/* Brief */}
      <Card variant="solid" style={{ padding: 20, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {rateEntries.length > 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)", marginBottom: 8 }}>
              Payout rates (per 1,000 verified views)
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {rateEntries.map(([platform, minor]) => (
                <span
                  key={platform}
                  style={{ fontSize: 13, fontWeight: 600, padding: "5px 10px", borderRadius: 8, background: "rgba(91,91,214,0.08)", color: "var(--cc-primary)" }}
                >
                  {platform}: {fmtMoney(minor, detail.currency)}
                </span>
              ))}
            </div>
          </div>
        )}

        {detail.submissionDeadline && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)", marginBottom: 4 }}>
              Submission deadline
            </p>
            <p style={{ fontSize: 14, color: detail.deadlinePassed ? "#DC2626" : "var(--cc-text)" }}>
              {new Date(detail.submissionDeadline).toLocaleDateString()} {detail.deadlinePassed ? "(passed)" : ""}
            </p>
          </div>
        )}

        {detail.guidelines && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)", marginBottom: 4 }}>
              Guidelines
            </p>
            <p style={{ fontSize: 14, color: "var(--cc-text)", whiteSpace: "pre-wrap" }}>{detail.guidelines}</p>
          </div>
        )}

        {detail.requirements && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)", marginBottom: 4 }}>
              Requirements
            </p>
            <p style={{ fontSize: 14, color: "var(--cc-text)", whiteSpace: "pre-wrap" }}>{detail.requirements}</p>
          </div>
        )}

        {detail.contentAssetsUrl && (
          <a
            href={detail.contentAssetsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", textDecoration: "none" }}
          >
            <Download size={14} /> Download campaign assets
          </a>
        )}
      </Card>

      {/* Submit */}
      <Card variant="solid" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Submit content</h2>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 12 }}>
          Paste a public TikTok, Instagram, or YouTube post link. Only platforms with a rate above are accepted.
        </p>
        {!joined ? (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--cc-bg)", color: "var(--cc-text-muted)", fontSize: 13 }}>
            You haven&apos;t joined this campaign yet.
          </div>
        ) : detail.deadlinePassed ? (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEF3C7", color: "#D97706", fontSize: 13 }}>
            The submission deadline has passed.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Post URL"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://www.tiktok.com/@you/video/123..."
              />
            </div>
            <Button variant="primary" loading={submitting} disabled={!canSubmit}>
              Submit
            </Button>
          </form>
        )}
      </Card>

      {/* My submissions */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 12 }}>My submissions</h2>
      {submissions.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="📹" title="No submissions yet" description="Submit your first post above to start earning." />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 100px 100px", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
            {["Post", "Platform", "Views", "Status", "Earned"].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {submissions.map((s, i) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 100px 100px", gap: 12, padding: "14px 20px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}>
              <a href={s.postUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.caption || s.postUrl} <ExternalLink size={12} />
              </a>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{s.platform}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{s.viewsCount.toLocaleString()}</span>
              <Badge variant={STATUS_BADGE[s.status] ?? "neutral"}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>{fmtMoney(s.earnedMinor, detail.currency)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export default function PortalCampaignDetailPage() {
  return (
    <Suspense fallback={null}>
      <CampaignDetailInner />
    </Suspense>
  );
}
