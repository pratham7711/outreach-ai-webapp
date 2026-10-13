import Link from "next/link";
import type { MarketplaceCardDTO } from "@/lib/marketplace/public";
import {
  CAMPAIGN_TYPE_LABEL,
  PLATFORM_META,
  formatCount,
  formatDeadline,
  formatMoney,
} from "./format";
import { SHOW_MONEY } from "@/lib/moneyUi";

/** Public marketplace campaign card (server component, links to landing page). */
export default function CampaignCard({ campaign }: { campaign: MarketplaceCardDTO }) {
  const deadline = formatDeadline(campaign.submissionDeadline);
  const typeLabel = CAMPAIGN_TYPE_LABEL[campaign.campaignType] ?? campaign.campaignType;
  const topRates = campaign.rates.slice(0, 3);
  /* A closed campaign (stopped, or past its deadline) is still listed after the
     open ones, but says so instead of counting down or claiming a pool. */
  const open = campaign.open;
  const showDaysLeft = open && campaign.daysLeft != null && campaign.daysLeft <= 7;
  /* "% claimed" is a share of the reward pool, so it hides with the rest of
     the money while SHOW_MONEY is off (lib/moneyUi.ts). */
  const showClaimed =
    open && SHOW_MONEY && campaign.budgetClaimedPct != null && campaign.budgetClaimedPct >= 60;
  const deadlinePassed =
    !!campaign.submissionDeadline && new Date(campaign.submissionDeadline).getTime() < Date.now();

  return (
    <Link
      href={`/explore/${campaign.slug}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <div
        style={{
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 16,
          padding: 20,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          transition: "box-shadow 0.15s ease, transform 0.15s ease",
          boxSizing: "border-box",
        }}
      >
        {/* Org row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              overflow: "hidden",
              flexShrink: 0,
              background: "var(--cc-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cc-on-primary)",
              fontSize: 15,
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
          <div style={{ minWidth: 0 }}>
            <div
              title={campaign.orgName}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cc-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {campaign.orgName}
            </div>
            <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{typeLabel}</div>
          </div>
        </div>

        {/* Title */}
        <h3
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: "var(--cc-text)",
            margin: 0,
            lineHeight: 1.35,
          }}
        >
          {campaign.title}
        </h3>

        {/* Urgency chips */}
        {(!open || showDaysLeft || showClaimed) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {!open && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--cc-neutral-fg)",
                  background: "var(--cc-neutral-bg)",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                Closed
              </span>
            )}
            {showDaysLeft && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--cc-warning-fg)",
                  background: "var(--cc-warning-bg)",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                {campaign.daysLeft === 1 ? "1 day left" : `${campaign.daysLeft} days left`}
              </span>
            )}
            {showClaimed && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--cc-danger-fg)",
                  background: "var(--cc-danger-bg)",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                {campaign.budgetClaimedPct}% claimed
              </span>
            )}
          </div>
        )}

        {/* Rates */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {topRates.length > 0 ? (
            topRates.map((r) => {
              const meta = PLATFORM_META[r.platform.toUpperCase()] ?? {
                label: r.platform,
                bg: "var(--cc-neutral-bg)",
                color: "var(--cc-neutral-fg)",
              };
              return (
                <div
                  key={r.platform}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background: meta.bg,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                  {SHOW_MONEY && (
                    <>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                        {formatMoney(r.ratePerThousand, campaign.currencySymbol)}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>/ 1k views</span>
                    </>
                  )}
                </div>
              );
            })
          ) : (
            SHOW_MONEY && (
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                Rewards on approval
              </span>
            )
          )}
        </div>

        {/* Meta footer */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          {SHOW_MONEY && campaign.budgetCapMajor != null && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--cc-text)",
                background: "var(--cc-success-bg)",
                borderRadius: 6,
                padding: "3px 8px",
              }}
            >
              {formatMoney(campaign.budgetCapMajor, campaign.currencySymbol)} pool
            </span>
          )}
          {deadline && (
            <span
              style={{
                fontSize: 12,
                color: "var(--cc-text-muted)",
                background: "var(--cc-neutral-bg)",
                borderRadius: 6,
                padding: "3px 8px",
              }}
            >
              {deadlinePassed ? "Ended" : "Ends"} {deadline}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--cc-text-muted)", marginLeft: "auto" }}>
            {formatCount(campaign.creatorCount)} creators
          </span>
        </div>
      </div>
    </Link>
  );
}
