import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ArrowRight, BellRing, CreditCard, Users } from "lucide-react";

const cards = [
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
    <div className="cc-page-content">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Settings
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Manage access, security, and plan details for your workspace.
        </p>
      </div>

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
              <div
                style={{
                  height: "100%",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 16,
                  background: "var(--cc-card)",
                  padding: 20,
                  boxShadow: "0 1px 0 rgba(15, 23, 42, 0.02)",
                  transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.35)";
                  e.currentTarget.style.boxShadow = "0 12px 30px rgba(15, 23, 42, 0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.borderColor = "var(--cc-border)";
                  e.currentTarget.style.boxShadow = "0 1px 0 rgba(15, 23, 42, 0.02)";
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "rgba(79, 70, 229, 0.08)",
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
