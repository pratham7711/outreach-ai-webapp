import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NotificationSettingsClient } from "./NotificationSettingsClient";
import { PageHeader } from "@/components/ds";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Notifications"
        subtitle="Which events reach you in the notification bell. These are yours alone — teammates choose their own."
      />
      <NotificationSettingsClient />
    </div>
  );
}
