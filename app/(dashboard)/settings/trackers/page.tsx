import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TrackerSettingsClient } from "./TrackerSettingsClient";

export const metadata = { title: "Tracker settings" };

export default async function TrackerSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="rsp-page page-enter">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Tracker settings
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          How often tracked sounds are read, and how their charts are drawn.
        </p>
      </div>
      <TrackerSettingsClient />
    </div>
  );
}
