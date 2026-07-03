import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import IngestionClient from "./IngestionClient";

export default async function IngestionSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <IngestionClient />;
}
