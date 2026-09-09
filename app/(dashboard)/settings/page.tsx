import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ArrowRight, Bell, BellRing, Building2, CreditCard, LineChart, Plug, Sigma, Tags, Users } from "lucide-react";
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
    title: "Metrics",
    description: "Which computed metrics appear across the workspace. EMV can be turned off entirely.",
    href: "/settings/metrics",
    icon: Sigma,
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
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
                  {card.title}
                </h2>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--cc-text-muted)", marginBottom: 16 }}>
                  {card.description}
                </p>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 600,
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
