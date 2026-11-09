import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Activity, ArrowRight, Bell, Building2, FileText, Key, LineChart, Plug, Tags, Users } from "lucide-react";
import { PageHeader } from "@/components/ds";
import { hasPermission } from "@/lib/rbac";
import { ORG_ADMIN_PERMISSION } from "@/lib/dashboardPolicy";

const cards = [
  {
    title: "General",
    description: "Creator tags and flags, campaign tags, deliverable types, and your own campaign and activation statuses.",
    href: "/settings/general",
    icon: Tags,
  },
  {
    title: "Profile",
    description: "Your organization's name, regional defaults and branding.",
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
    title: "API keys",
    description: "Create and revoke keys for API access and integrations.",
    href: "/settings/api-keys",
    /* The key glyph the sidebar uses for this page; it was a credit card,
       which read as Billing. */
    icon: Key,
  },
  {
    title: "Tracker settings",
    description: "How often tracked sounds are read from TikTok, and how densely their charts are drawn.",
    href: "/settings/trackers",
    icon: LineChart,
  },
  {
    title: "Notifications",
    description: "Which events reach your notification bell. Personal: every teammate chooses their own.",
    href: "/settings/notifications",
    icon: Bell,
  },
  {
    title: "Integrations",
    description: "Connect Slack to post campaign activity into a channel for the whole team.",
    href: "/settings/integrations",
    icon: Plug,
  },
  /* The other seven settings pages were all reachable two ways -- a rail row and
     a card here -- but Ingestion had only the rail row, so it was the one page
     that a theme collapsing the rail would orphan outright, as the former
     CreatorCore theme did. Listed here so the hub is the complete index of
     settings it always appeared to be. */
  {
    title: "Ingestion",
    description: "Health of the post and profile ingestion pipeline, and the dead-letter queue.",
    href: "/settings/ingestion",
    icon: Activity,
  },
];

/* Left the sidebar in October 2026; the log itself is unchanged. */
const adminCards = [
  {
    title: "Audit log",
    description: "Who changed what in this workspace, and when.",
    href: "/audit-log",
    icon: FileText,
  },
];

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin = hasPermission((session.user as { role?: string }).role ?? "", ORG_ADMIN_PERMISSION);
  const visibleCards = isAdmin ? [...cards, ...adminCards] : cards;

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Settings"
        subtitle="Manage your workspace, team, access and integrations."
      />

      <div className="cc-settings-hub">
        {visibleCards.map((card) => {
          const Icon = card.icon;

          return (
            <Link key={card.href} href={card.href} className="cc-settings-hub-card">
              <span className="cc-settings-hub-card__icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h2 className="cc-settings-hub-card__title">{card.title}</h2>
              <p className="cc-settings-hub-card__body">{card.description}</p>
              <span className="cc-settings-hub-card__link">
                Open
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
