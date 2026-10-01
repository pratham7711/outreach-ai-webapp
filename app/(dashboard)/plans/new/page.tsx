import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { ORG_ADMIN_PERMISSION } from "@/lib/dashboardPolicy";
import { auth } from "@/lib/auth";
import PlanForm from "../PlanForm";

export default async function NewPlanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission((session.user as { role?: string }).role ?? "", ORG_ADMIN_PERMISSION)) notFound();
  return <PlanForm />;
}
