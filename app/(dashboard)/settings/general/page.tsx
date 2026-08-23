import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import GeneralClient from "./GeneralClient";

export default async function GeneralSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <GeneralClient />;
}
