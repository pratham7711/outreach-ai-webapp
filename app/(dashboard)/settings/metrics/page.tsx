import { redirect } from "next/navigation";
import { Card } from "@pratham7711/ui";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { MetricsSettingsClient } from "./MetricsSettingsClient";
import { PageHeader } from "@/components/ds";

export const metadata = { title: "Metric settings" };

export default async function MetricsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  /* Same shape as tracker settings next door: /api/settings/metrics requires
     settings:*, so a non-admin's fetch would 403 and leave a blank page under
     the header. Say why instead. */
  const role = (session.user as { role?: string }).role ?? "";
  const canManage = hasPermission(role, "settings:*");

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Metric settings"
        subtitle="Which computed metrics appear across your workspace."
      />
      {canManage ? (
        <MetricsSettingsClient />
      ) : (
        <Card variant="outlined">
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
            Only admins can change which metrics are shown
          </h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
            This applies to the whole workspace and to every public report link, so it is
            limited to owners and admins. Ask one of them if you need EMV turned back on.
          </p>
        </Card>
      )}
    </div>
  );
}
