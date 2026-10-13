import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { loadInviteLanding } from "@/lib/portal/campaignInvite";
import { InviteActions } from "@/components/portal/app/InviteActions";

export const dynamic = "force-dynamic";

/* The link is a personal invitation, so it is kept out of search engines and
   its title names the brand only, not the campaign. */
export const metadata: Metadata = {
  title: `Campaign invitation | ${BRAND.name}`,
  robots: { index: false, follow: false },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 6px" }}>{title}</h2>
      {children}
    </section>
  );
}

const bodyText: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.6,
  color: "var(--cc-text)",
  margin: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

/**
 * /invite/<code> -- the page an agency's invite link opens. Public: the creator
 * may have no account yet. It shows the brief and the dates and offers Accept
 * and "Not for me"; Accept carries the code through sign-up or log-in and lands
 * on the campaign (components/portal/app/InviteActions.tsx).
 *
 * What it shows is whitelisted in loadInviteLanding: nothing about the
 * agency's roster, budget or other creators, and not the invited creator's
 * name, so a forwarded link discloses nobody. An unknown code is a 404.
 */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await loadInviteLanding(code);
  if (!invite) notFound();

  const { campaign } = invite;
  const loginHref = `/portal/login?invitation=${encodeURIComponent(code)}`;

  let footer: React.ReactNode;
  if (invite.status === "ACCEPTED") {
    footer = (
      <p style={{ ...bodyText, whiteSpace: "normal" }}>
        This invitation has been accepted.{" "}
        <Link href={loginHref} style={{ color: "var(--cc-primary)", fontWeight: 600 }}>
          Sign in to open the campaign
        </Link>
        .
      </p>
    );
  } else if (invite.status === "DECLINED" || invite.status === "EXPIRED") {
    footer = (
      <p style={{ ...bodyText, whiteSpace: "normal" }}>
        This invitation is no longer open. If you&apos;d like to take part, ask {campaign.orgName} for a new link.
      </p>
    );
  } else if (!invite.open) {
    footer = (
      <p style={{ ...bodyText, whiteSpace: "normal" }}>This campaign has closed, so the invitation can no longer be accepted.</p>
    );
  } else {
    footer = <InviteActions code={code} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      <header
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          background: "var(--cc-card)",
          borderBottom: "1px solid var(--cc-border)",
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{BRAND.name}</span>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 48px" }}>
        <div
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 16,
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {campaign.orgLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- agency logos are arbitrary external URLs
              <img
                src={campaign.orgLogoUrl}
                alt=""
                width={44}
                height={44}
                style={{ borderRadius: 10, objectFit: "cover", border: "1px solid var(--cc-border)", flexShrink: 0 }}
              />
            )}
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
              <strong style={{ color: "var(--cc-text)" }}>{campaign.orgName}</strong> invited you to a campaign
            </p>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", margin: "14px 0 0", lineHeight: 1.25 }}>
            {campaign.title}
          </h1>

          {campaign.dates.length > 0 && (
            <Section title="Dates">
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {campaign.dates.map((d) => (
                  <li key={`${d.kind}-${d.at}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15, color: "var(--cc-text)" }}>
                    <span>{d.label}</span>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatDate(d.at)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {campaign.brief && (
            <Section title="The brief">
              <p style={bodyText}>{campaign.brief}</p>
            </Section>
          )}
          {campaign.guidelines && (
            <Section title="Guidelines">
              <p style={bodyText}>{campaign.guidelines}</p>
            </Section>
          )}
          {campaign.requirements && (
            <Section title="Requirements">
              <p style={bodyText}>{campaign.requirements}</p>
            </Section>
          )}
          {campaign.contentAssetsUrl && /^https?:\/\//i.test(campaign.contentAssetsUrl) && (
            <Section title="Assets">
              <a href={campaign.contentAssetsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 15, color: "var(--cc-primary)", overflowWrap: "anywhere" }}>
                Open the campaign assets
              </a>
            </Section>
          )}
          {!campaign.brief && !campaign.guidelines && !campaign.requirements && (
            <Section title="The brief">
              <p style={bodyText}>{campaign.orgName} will share the details once you&apos;re on the campaign.</p>
            </Section>
          )}

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--cc-border)" }}>{footer}</div>
        </div>

        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", textAlign: "center", margin: "16px 0 0" }}>
          <Link href="/privacy" style={{ color: "var(--cc-text-muted)" }}>
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" style={{ color: "var(--cc-text-muted)" }}>
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/data-deletion" style={{ color: "var(--cc-text-muted)" }}>
            Data deletion
          </Link>
        </p>
      </main>
    </div>
  );
}
