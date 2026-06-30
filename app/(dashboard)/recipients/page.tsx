import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRecipients } from "@/lib/recipients/query";
import RecipientsClient from "./RecipientsClient";

export default async function RecipientsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId as string;

  const { recipients, stats } = await getRecipients(orgId);

  return <RecipientsClient recipients={recipients} stats={stats} />;
}
