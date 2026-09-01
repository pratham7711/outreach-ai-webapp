import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { IntegrationsClient } from "./IntegrationsClient";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as any).role as string;
  if (!hasPermission(role, "settings:*")) redirect("/settings");

  return (
    <div className="rsp-page page-enter">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Integrations
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Connect with Slack to receive updates and notifications directly in your selected channel.
        </p>
      </div>
      <IntegrationsClient />
    </div>
  );
}
