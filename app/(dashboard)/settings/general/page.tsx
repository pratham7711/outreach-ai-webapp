import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import GeneralClient from "./GeneralClient";

export default async function GeneralSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  /* Same gate the taxonomy write routes apply. Read stays open to everyone
     because these lists feed the campaign and creator pickers. */
  const role = (session.user as any).role as string;
  const canManage = hasPermission(role, "settings:*");

  return <GeneralClient canManage={canManage} />;
}
