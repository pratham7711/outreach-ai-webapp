import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TrackerSettingsClient } from "./TrackerSettingsClient";
import { PageHeader } from "@/components/ds";

export const metadata = { title: "Tracker settings" };

export default async function TrackerSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Tracker settings"
        subtitle="How often tracked sounds are read, and how their charts are drawn."
      />
      <TrackerSettingsClient />
    </div>
  );
}
