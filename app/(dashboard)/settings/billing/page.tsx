import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/ds";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { AUDIT_LOG_FEATURE } from "@/lib/featureKeys";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { AudioLines, BadgeDollarSign, CheckCircle2, Gauge, Layers3, Users } from "lucide-react";
import type { ComponentType } from "react";
import AuditLogToggleCard from "./AuditLogToggleCard";

const LABEL_ACRONYMS: Record<string, string> = { csv: "CSV", api: "API", sso: "SSO", ai: "AI" };
function formatLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-. ]+/)
    .filter(Boolean)
    .map((part) => LABEL_ACRONYMS[part.toLowerCase()] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Infinity renders as the literal string "Infinity", which reads as a bug.
 *
 * Campaigns, creators and seats are all unlimited on every tier now, so three
 * of the four rows on this screen take this branch -- it is the common case,
 * not an edge one.
 */
function formatLimit(value: number): string {
  return Number.isFinite(value) ? String(value) : "Unlimited";
}

function limitCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: ComponentType<{ size?: number }>;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--cc-border)",
        borderRadius: 16,
        background: "var(--cc-card)",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: "var(--cc-primary-light)",
            color: "var(--cc-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={18} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--cc-text)" }}>{value}</div>
    </div>
  );
}

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) redirect("/login");

  const enabledFeatures = [...entitlements.features].sort((a, b) => a.localeCompare(b));

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Billing"
        subtitle="Review your current plan, usage limits, and enabled capabilities."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* Tracked sounds is the ONE limit a plan applies. Seats joined
            campaigns and creators in being uncapped on 2026-09-01, so the other
            three rows read Unlimited on every tier.
            They stay listed rather than being dropped: this screen is where
            somebody comes to find out what their plan allows, and a missing row
            raises the question of whether there is a hidden cap. Said plainly,
            "Unlimited" answers it. */}
        {limitCard({ label: "Plan", value: formatLabel(entitlements.planName), icon: BadgeDollarSign })}
        {limitCard({
          label: "Tracked sounds",
          value: formatLimit(entitlements.limits.maxTrackers),
          icon: AudioLines,
        })}
        {limitCard({ label: "Max users", value: formatLimit(entitlements.limits.maxUsers), icon: Users })}
        {limitCard({ label: "Campaigns", value: formatLimit(entitlements.limits.maxCampaigns), icon: Gauge })}
        {limitCard({ label: "Creators", value: formatLimit(entitlements.limits.maxCreators), icon: Layers3 })}
      </div>

      <div style={{ marginBottom: 20 }}>
        <AuditLogToggleCard
          initialEnabled={hasOrgFeature(entitlements, AUDIT_LOG_FEATURE)}
          planName={entitlements.planName}
        />
      </div>

      <div
        style={{
          border: "1px solid var(--cc-border)",
          borderRadius: 16,
          background: "var(--cc-card)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
              Enabled features
            </h2>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
              Features currently active for this organization.
            </p>
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--cc-primary)",
              background: "var(--cc-primary-light)",
              padding: "8px 12px",
              borderRadius: 999,
            }}
          >
            {enabledFeatures.length} enabled
          </span>
        </div>

        {enabledFeatures.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
            No features are currently enabled for this organization.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {enabledFeatures.map((feature) => (
              <div
                key={feature}
                style={{
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--cc-bg)",
                }}
              >
                <CheckCircle2 size={16} style={{ color: "var(--cc-success)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                  {FEATURES[feature as FeatureKey]?.label ?? formatLabel(feature)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
