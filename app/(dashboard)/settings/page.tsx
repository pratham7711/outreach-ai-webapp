import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Activity, ArrowRight, Bell, BellRing, Building2, CreditCard, LineChart, Plug, Tags, Users } from "lucide-react";
import { PageHeader } from "@/components/ds";

const cards = [
  {
    title: "General",
    description: "Creator tags and flags, campaign tags, deliverable types, and your own campaign and activation statuses.",
    href: "/settings/general",
    icon: Tags,
  },
  {
    title: "Profile",
    description: "Update your organization name, branding colors, and bank details.",
    href: "/settings/profile",
    icon: Building2,
  },
  {
    title: "Team",
    description: "Manage members, invitations, and roles for your organization.",
    href: "/settings/team",
    icon: Users,
  },
  {
    title: "API Keys",
    description: "Create and revoke keys for API access and integrations.",
    href: "/settings/api-keys",
    icon: CreditCard,
  },
  {
    title: "Trackers",
    description: "How often tracked sounds are read from TikTok, and how densely their charts are drawn.",
    href: "/settings/trackers",
    icon: LineChart,
  },
  {
    title: "Notifications",
    description: "Which events email you. Personal — every teammate chooses their own.",
    href: "/settings/notifications",
    icon: Bell,
  },
  {
    title: "Integrations",
    description: "Connect Slack to post campaign activity into a channel for the whole team.",
    href: "/settings/integrations",
    icon: Plug,
  },
  {
    title: "Billing",
    description: "Review your current plan, usage limits, and enabled features.",
    href: "/settings/billing",
    icon: BellRing,
  },
  /* The other seven settings pages were all reachable two ways -- a rail row and
     a card here -- but Ingestion had only the rail row, so it was the one page
     that a theme collapsing the rail would orphan outright. That is now what the
     creatorcore theme does (see --cc-nav-subpage-display in globals.css), which
     turns a cosmetic inconsistency into a page nobody can reach. Listed here so
     the hub is the complete index of settings it always appeared to be. */
  {
    title: "Ingestion",
    description: "Health of the post and profile ingestion pipeline, and the dead-letter queue.",
    href: "/settings/ingestion",
    icon: Activity,
  },
];

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Settings"
        subtitle="Manage access, security, and plan details for your workspace."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <Link
              key={card.href}
              href={card.href}
              style={{
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div className="group h-full rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-card)] p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-[rgba(99,102,241,0.35)] hover:shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "var(--cc-primary-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                    color: "var(--cc-primary)",
                  }}
                >
                  <Icon size={20} />
                </div>
                <h2 style={{ fontSize: "var(--cc-t-16)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
                  {card.title}
                </h2>
                <p style={{ fontSize: "var(--cc-t-14)", lineHeight: 1.6, color: "var(--cc-text-muted)", marginBottom: 16 }}>
                  {card.description}
                </p>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "var(--cc-t-13)",
                    fontWeight: "var(--cc-fw-strong)",
                    color: "var(--cc-primary)",
                  }}
                >
                  Open
                  <ArrowRight size={14} />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
