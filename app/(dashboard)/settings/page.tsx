import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Activity, Bell, ChevronRight, Building2, FileText, Key, LineChart, Plug, Tags, Users } from "lucide-react";
import { PageHeader } from "@/components/ds";
import { hasPermission } from "@/lib/rbac";
import { ORG_ADMIN_PERMISSION } from "@/lib/dashboardPolicy";

const cards = [
  {
    title: "General",
    description: "Tags, flags, deliverables and statuses",
    href: "/settings/general",
    icon: Tags,
  },
  {
    title: "Profile",
    description: "Name, region and branding",
    href: "/settings/profile",
    icon: Building2,
  },
  {
    title: "Team",
    description: "Members, invites and roles",
    href: "/settings/team",
    icon: Users,
  },
  {
    title: "API keys",
    description: "Keys for scripts and AI clients",
    href: "/settings/api-keys",
    /* The key glyph the sidebar uses for this page; it was a credit card,
       which read as Billing. */
    icon: Key,
  },
  {
    title: "Tracker settings",
    description: "Read cadence and chart detail",
    href: "/settings/trackers",
    icon: LineChart,
  },
  {
    title: "Notifications",
    description: "What reaches your bell",
    href: "/settings/notifications",
    icon: Bell,
  },
  {
    title: "Integrations",
    description: "Instagram and Slack",
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
    description: "Sync health and failed posts",
    href: "/settings/ingestion",
    icon: Activity,
  },
];

/* Left the sidebar in October 2026; the log itself is unchanged. */
const adminCards = [
  {
    title: "Audit log",
    description: "Who changed what, and when",
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
      <PageHeader title="Settings" />

      <div className="cc-sx-hub">
        {visibleCards.map((card) => {
          const Icon = card.icon;

          return (
            <Link key={card.href} href={card.href} className="cc-sx-hub-row">
              <span className="cc-sx-hub-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="cc-sx-hub-text">
                <span className="cc-sx-hub-title">{card.title}</span>
                <span className="cc-sx-hub-desc">{card.description}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className="cc-sx-hub-chev" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
