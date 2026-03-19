import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import PlanForm from "../PlanForm";

export default async function NewPlanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <PlanForm />;
}
