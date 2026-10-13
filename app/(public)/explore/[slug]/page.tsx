import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchMarketplaceDetail } from "@/lib/marketplace/public";
import { BRAND } from "@/lib/brand";
import { SHOW_MONEY } from "@/lib/moneyUi";
import {
  CAMPAIGN_TYPE_LABEL,
  PLATFORM_META,
  formatCount,
  formatDeadline,
  formatMoney,
} from "../format";

export const revalidate = 300;

/**
 * Prerender the public campaign slugs so /explore/[slug] lands in the Full
 * Route Cache instead of hitting Postgres on every visit. Fault-tolerant on
 * purpose: a DB hiccup at build time must not fail the deploy — those slugs
 * just render on demand instead.
 */
export async function generateStaticParams() {
  try {
    const { db } = await import("@/lib/db");
    const rows = await db.campaign.findMany({
      where: {
        marketplaceVisibility: "GLOBAL",
        publicSlug: { not: null },
        deletedAt: null,
      },
      select: { publicSlug: true },
      take: 500,
    });
    return rows
      .map((r) => r.publicSlug)
      .filter((s): s is string => !!s)
      .map((slug) => ({ slug }));
  } catch {
    return [];
  }
}

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchMarketplaceDetail(slug);
  if (!data) {
    return { title: `Campaign not found | ${BRAND.name}` };
  }
  const { campaign } = data;
  const title = `${campaign.title} — ${campaign.orgName} | ${BRAND.name}`;
  const description =
    campaign.guidelines?.slice(0, 155) ??
    (SHOW_MONEY
      ? `Join ${campaign.orgName}'s campaign and get paid per verified view. Post your content and start earning.`
      : `Join ${campaign.orgName}'s campaign, post your content and see how it does.`);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

/* ── Page ────────────────────────────────────────────────────────────────── */

/* A server component, rendered per request, so "now" is the request's time. */
function deadlineHasPassed(deadline: string | Date | null | undefined): boolean {
  return !!deadline && new Date(deadline).getTime() < Date.now();
}

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

  const daysLeft = (() => {
    if (!campaign.submissionDeadline) return null;
    const ms = new Date(campaign.submissionDeadline).getTime() - Date.now();
    if (Number.isNaN(ms) || ms <= 0) return null;
    return Math.ceil(ms / 86_400_000);
  })();
  /* Closed is the portal's own test -- running, and before the deadline -- so
     this page cannot invite a creator into a campaign the portal then refuses.
     See isMarketplaceCampaignOpen. */
  const open = campaign.open;
  const deadlinePassed = deadlineHasPassed(campaign.submissionDeadline);
  const showDaysLeft = open && daysLeft != null && daysLeft <= 7;
  /* Money is hidden while SHOW_MONEY is off (lib/moneyUi.ts): the pool, the
     rates and what each creator earned. Hidden, never cleared -- the figures
     are still loaded and come back with the switch. */
  const showClaimed = open && SHOW_MONEY && pct != null && pct >= 60;

  const joinRegisterHref = `/portal/register?join=${encodeURIComponent(campaign.slug)}`;
  const joinLoginHref = `/portal/login?join=${encodeURIComponent(campaign.slug)}`;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)", paddingBottom: open ? 96 : 40 }}>
      {/* Hero / org branding */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--cc-accent-bg) 0%, color-mix(in srgb, var(--cc-accent-bg) 50%, var(--cc-card)) 45%, var(--cc-card) 100%)",
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
                color: campaign.orgPrimaryColor ? "white" : "var(--cc-on-primary)",
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
            {showDaysLeft && (
              <span style={urgentChipStyle}>
                {daysLeft === 1 ? "1 day left" : `${daysLeft} days left`}
              </span>
            )}
            {showClaimed && (
              <span style={claimedChipStyle}>{pct}% of pool claimed</span>
            )}
            {!open && <span style={closedChipStyle}>Closed</span>}
            {/* A campaign stopped before its deadline shows no date: "Submit
                by" would invite a post the portal refuses. */}
            {deadline && (open || deadlinePassed) && (
              <span style={chipStyle}>{open ? `Submit by ${deadline}` : `Submissions closed ${deadline}`}</span>
            )}
            <span style={chipStyle}>{formatCount(campaign.creatorCount)} {campaign.creatorCount === 1 ? "creator" : "creators"} joined</span>
            <span style={chipStyle}>Auto-approves in {campaign.autoApproveHours}h</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "28px 20px 0" }}>
        {!open && (
          <div
            role="status"
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 16,
              padding: 24,
              marginBottom: 16,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 4px" }}>
                This campaign is closed
              </h2>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.5 }}>
                {deadlinePassed
                  ? `Submissions closed on ${deadline}, so ${campaign.orgName} isn't taking new creators or posts for it.`
                  : `${campaign.orgName} isn't taking new creators or posts for it.`}{" "}
                The brief is still here for reference.
              </p>
            </div>
            <Link href="/explore" style={primaryCtaStyle}>
              Browse open campaigns
            </Link>
          </div>
        )}
        {/* Budget bar */}
        {SHOW_MONEY && (budget.capMajor != null || budget.earnedMajor > 0) && (
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
        {!SHOW_MONEY && campaign.rates.length > 0 && (
          <Section title="Platforms">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {campaign.rates.map((r) => (
                <span key={r.platform} style={chipStyle}>
                  {PLATFORM_META[r.platform.toUpperCase()]?.label ?? r.platform}
                </span>
              ))}
            </div>
          </Section>
        )}

        {SHOW_MONEY && campaign.rates.length > 0 && (
          <Section title="Payout rates">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {campaign.rates.map((r) => {
                const meta = PLATFORM_META[r.platform.toUpperCase()] ?? {
                  label: r.platform,
                  bg: "var(--cc-neutral-bg)",
                  color: "var(--cc-neutral-fg)",
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
              {leaderboard.map((entry, i) => {
                const displayHandle = entry.handle.replace(/^@+/, "");
                const rowStyle: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 4px",
                  borderBottom:
                    i < leaderboard.length - 1 ? "1px solid var(--cc-border)" : "none",
                  textDecoration: "none",
                  color: "inherit",
                };
                const inner = (
                  <>
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
                        color: "var(--cc-on-primary)",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {entry.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.avatarUrl}
                          alt={displayHandle}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        displayHandle.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span
                      title={`@${displayHandle}`}
                      style={{
                        flex: 1,
                        fontSize: 13,
                        fontWeight: 600,
                        color: entry.profileHandle ? "var(--cc-primary)" : "var(--cc-text)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      @{displayHandle}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      {formatCount(entry.verifiedViews)} views
                    </span>
                    {SHOW_MONEY && (
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
                    )}
                  </>
                );
                return entry.profileHandle ? (
                  <Link
                    key={`${entry.handle}-${i}`}
                    href={`/c/${encodeURIComponent(entry.profileHandle)}`}
                    style={rowStyle}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={`${entry.handle}-${i}`} style={rowStyle}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>

      {/* Sticky CTA -- only while there is something to join. */}
      {open && (
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "var(--cc-card)",
          borderTop: "1px solid var(--cc-border)",
          boxShadow: "0 -4px 16px color-mix(in srgb, var(--cc-overlay-ink) 6%, transparent)",
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
          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
              {SHOW_MONEY ? "Ready to start earning?" : "Want to take part?"}
            </div>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              Join {campaign.orgName}&apos;s campaign in seconds.
            </div>
          </div>
          <Link href={joinLoginHref} style={secondaryCtaStyle}>
            Sign in
          </Link>
          <Link href={joinRegisterHref} style={{ ...primaryCtaStyle, flex: "1 1 auto", textAlign: "center" }}>
            Join campaign
          </Link>
        </div>
      </div>
      )}
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

const urgentChipStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--cc-warning-fg)",
  background: "var(--cc-warning-bg)",
  border: "1px solid color-mix(in srgb, var(--cc-warning-solid) 30%, transparent)",
  borderRadius: 20,
  padding: "5px 12px",
};

const closedChipStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--cc-neutral-fg)",
  background: "var(--cc-neutral-bg)",
  border: "1px solid var(--cc-border)",
  borderRadius: 20,
  padding: "5px 12px",
};

const claimedChipStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--cc-danger-fg)",
  background: "var(--cc-danger-bg)",
  border: "1px solid color-mix(in srgb, var(--cc-danger-solid) 30%, transparent)",
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
  color: "var(--cc-on-primary)",
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
