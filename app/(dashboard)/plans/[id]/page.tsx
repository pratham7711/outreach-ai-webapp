import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import PlanForm from "../PlanForm";
import { asFeatureMap } from "@/lib/features";

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const plan = await db.plan.findFirst({ where: { id, orgId } });
  if (!plan) notFound();

  return (
    <PlanForm
      initial={{
        id: plan.id,
        name: plan.name,
        description: plan.description,
        features: asFeatureMap(plan.features) ?? {},
        isCustom: plan.isCustom,
      }}
    />
  );
}
