import { redirect } from "next/navigation";
import { Card } from "@pratham7711/ui";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { TrackerSettingsClient } from "./TrackerSettingsClient";
import { PageHeader } from "@/components/ds";

export const metadata = { title: "Tracker settings" };

export default async function TrackerSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  /* /api/settings/trackers requires settings:*, so a non-admin's fetch used to
     403, the client's state stayed null and the page rendered nothing at all
     under the header. Say so instead: a blank screen reads as a broken page,
     not as a permission. */
  const role = (session.user as any).role as string;
  const canManage = hasPermission(role, "settings:*");

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Tracker settings"
        subtitle="How often tracked sounds are read, and how their charts are drawn."
      />
      {canManage ? (
        <TrackerSettingsClient />
      ) : (
        <Card variant="outlined">
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
            Only admins can manage tracker settings
          </h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
            Read cadence and chart granularity apply to the whole workspace and cost
            reading time, so they are limited to owners and admins. Ask one of them if
            you need a tracked sound read more often.
          </p>
        </Card>
      )}
    </div>
  );
}
