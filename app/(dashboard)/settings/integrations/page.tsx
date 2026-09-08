import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { IntegrationsClient } from "./IntegrationsClient";
import { PageHeader } from "@/components/ds";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as any).role as string;
  if (!hasPermission(role, "settings:*")) redirect("/settings");

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Integrations"
        subtitle="Connect with Slack to receive updates and notifications directly in your selected channel."
      />
      <IntegrationsClient />
    </div>
  );
}
