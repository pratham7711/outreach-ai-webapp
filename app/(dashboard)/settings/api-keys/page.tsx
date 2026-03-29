import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ApiKeysClient from "./ApiKeysClient";

export default async function ApiKeysPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <ApiKeysClient />;
}
