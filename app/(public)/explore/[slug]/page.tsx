import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchMarketplaceDetail } from "@/lib/marketplace/public";
import {
  CAMPAIGN_TYPE_LABEL,
  PLATFORM_META,
  formatCount,
  formatDeadline,
  formatMoney,
} from "../format";

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchMarketplaceDetail(slug);
  if (!data) {
    return { title: "Campaign not found | Outreach AI" };
  }
  const { campaign } = data;
  const title = `${campaign.title} — ${campaign.orgName} | Outreach AI`;
  const description =
    campaign.guidelines?.slice(0, 155) ??
    `Join ${campaign.orgName}'s campaign and get paid per verified view. Post your content and start earning.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: campaign.orgLogoUrl ? [{ url: campaign.orgLogoUrl }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default async function CampaignLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchMarketplaceDetail(slug);
  if (!data) notFound();

  const { campaign, budget, leaderboard } = data;
  const sym = campaign.currencySymbol;
  const deadline = formatDeadline(campaign.submissionDeadline);
  const typeLabel = CAMPAIGN_TYPE_LABEL[campaign.campaignType] ?? campaign.campaignType;

  const pct =
    budget.capMinor && budget.capMinor > 0
      ? Math.min(100, Math.round((budget.earnedMinor / budget.capMinor) * 100))
      : null;

  const joinRegisterHref = `/portal/register?join=${encodeURIComponent(campaign.slug)}`;
  const joinLoginHref = `/portal/login?join=${encodeURIComponent(campaign.slug)}`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)", paddingBottom: 96 }}>
      {/* Hero / org branding */}
      <div
        style={{
          background: "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 45%, #FFFFFF 100%)",
          borderBottom: "1px solid var(--cc-border)",
        }}
      >
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 20px 32px" }}>
          <Link
            href="/explore"
            style={{
              fontSize: 13,
              color: "var(--cc-text-muted)",
              textDecoration: "none",
              display: "inline-block",
              marginBottom: 20,
            }}
          >
            ← Back to marketplace
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                overflow: "hidden",
                flexShrink: 0,
                background: campaign.orgPrimaryColor || "var(--cc-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              {campaign.orgLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={campaign.orgLogoUrl}
                  alt={campaign.orgName}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                campaign.orgName.charAt(0).toUpperCase()
              )}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text-muted)" }}>
                {campaign.orgName}
              </div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{typeLabel}</div>
            </div>
          </div>

          <h1
            style={{
              fontSize: 30,
              fontWeight: 800,
              color: "var(--cc-text)",
              margin: "0 0 12px",
              lineHeight: 1.2,
            }}
          >
            {campaign.title}
          </h1>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {deadline && (
              <span style={chipStyle}>Submit by {deadline}</span>
            )}
            <span style={chipStyle}>{formatCount(campaign.creatorCount)} creators joined</span>
            <span style={chipStyle}>Auto-approves in {campaign.autoApproveHours}h</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "28px 20px 0" }}>
        {/* Budget bar */}
        {(budget.capMajor != null || budget.earnedMajor > 0) && (
          <Section title="Reward pool">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>
                {formatMoney(budget.earnedMajor, sym)}
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-text-muted)" }}>
                  {" "}
                  paid out
                </span>
              </span>
              {budget.capMajor != null && (
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                  of {formatMoney(budget.capMajor, sym)} pool
                </span>
              )}
            </div>
            {pct != null && (
              <div
                style={{
                  height: 10,
                  borderRadius: 6,
                  background: "var(--cc-border)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: "var(--cc-primary)",
                    borderRadius: 6,
                  }}
                />
              </div>
            )}
          </Section>
        )}

        {/* Rate table */}
        {campaign.rates.length > 0 && (
          <Section title="Payout rates">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {campaign.rates.map((r) => {
                const meta = PLATFORM_META[r.platform.toUpperCase()] ?? {
                  label: r.platform,
                  bg: "#F3F4F6",
                  color: "#374151",
                };
                return (
                  <div
                    key={r.platform}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 14px",
                      border: "1px solid var(--cc-border)",
                      borderRadius: 10,
                      background: "var(--cc-bg)",
                    }}
                  >
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        background: meta.bg,
                        color: meta.color,
                      }}
                    >
                      {meta.label}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>
                      {formatMoney(r.ratePerThousand, sym)}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--cc-text-muted)",
                        }}
                      >
                        {" "}
                        / 1k views
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            {campaign.minPayoutMajor != null && (
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "12px 0 0" }}>
                Minimum {formatMoney(campaign.minPayoutMajor, sym)} earned before you can request a
                payout.
              </p>
            )}
          </Section>
        )}

        {/* Brief */}
        {campaign.guidelines && (
          <Section title="Creative brief">
            <p style={briefTextStyle}>{campaign.guidelines}</p>
          </Section>
        )}

        {campaign.requirements && (
          <Section title="Requirements">
            <p style={briefTextStyle}>{campaign.requirements}</p>
          </Section>
        )}

        {campaign.contentAssetsUrl && (
          <Section title="Assets">
            <a
              href={campaign.contentAssetsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--cc-primary)",
                textDecoration: "none",
              }}
            >
              Download campaign assets ↗
            </a>
          </Section>
        )}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <Section title="Top creators">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {leaderboard.map((entry, i) => (
                <div
                  key={`${entry.handle}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 4px",
                    borderBottom:
                      i < leaderboard.length - 1 ? "1px solid var(--cc-border)" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      fontSize: 13,
                      fontWeight: 700,
                      color: i < 3 ? "var(--cc-primary)" : "var(--cc-text-muted)",
                      textAlign: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      overflow: "hidden",
                      flexShrink: 0,
                      background: "var(--cc-primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {entry.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.avatarUrl}
                        alt={entry.handle}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      entry.handle.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--cc-text)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    @{entry.handle}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {formatCount(entry.verifiedViews)} views
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--cc-text)",
                      minWidth: 60,
                      textAlign: "right",
                    }}
                  >
                    {formatMoney(entry.earnedMajor, sym)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Sticky CTA */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "var(--cc-card)",
          borderTop: "1px solid var(--cc-border)",
          boxShadow: "0 -4px 16px rgba(28,32,72,0.06)",
          zIndex: 20,
        }}
      >
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 160px", minWidth: 140 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
              Ready to start earning?
            </div>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              Join {campaign.orgName}&apos;s campaign in seconds.
            </div>
          </div>
          <Link href={joinLoginHref} style={secondaryCtaStyle}>
            Log in
          </Link>
          <Link href={joinRegisterHref} style={primaryCtaStyle}>
            Join campaign
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Local building blocks ─────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 16,
        padding: 24,
        marginBottom: 16,
      }}
    >
      <h2
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "var(--cc-text)",
          margin: "0 0 16px",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--cc-text-muted)",
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 20,
  padding: "5px 12px",
};

const briefTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--cc-text)",
  lineHeight: 1.7,
  margin: 0,
  whiteSpace: "pre-wrap",
};

const primaryCtaStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 10,
  background: "var(--cc-primary)",
  color: "white",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const secondaryCtaStyle: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  background: "var(--cc-card)",
  border: "1.5px solid var(--cc-border)",
  color: "var(--cc-text)",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
