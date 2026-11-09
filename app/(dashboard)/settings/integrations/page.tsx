import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { IntegrationsClient } from "./IntegrationsClient";
import { InstagramAccountCard } from "./InstagramAccountCard";
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
        subtitle="Accounts and channels this workspace connects to. Only owners and admins see this page."
      />
      <div className="cc-settings-groups">
        <InstagramAccountCard />
        <IntegrationsClient />
      </div>
    </div>
  );
}
