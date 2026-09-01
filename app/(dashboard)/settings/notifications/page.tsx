import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NotificationSettingsClient } from "./NotificationSettingsClient";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="rsp-page page-enter">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Notifications
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Which events email you. These are yours alone — teammates choose their own.
        </p>
      </div>
      <NotificationSettingsClient />
    </div>
  );
}
