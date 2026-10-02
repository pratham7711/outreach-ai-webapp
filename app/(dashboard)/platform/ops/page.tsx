/**
 * The ops guards page (plan §13 C and M): cron heartbeats, kill switches,
 * per-source breakers, today's Sandbox use against the cap, and last week's
 * meters against the model.
 *
 * Platform admins only, by the same guard as /platform/trackers: notFound()
 * for anyone else, so nothing is read for them. Agencies never see this page
 * or a link to it.
 */
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { opsGuardsReport } from "@/lib/ops/opsReport";
import OpsGuardsClient from "./OpsGuardsClient";

export const dynamic = "force-dynamic";

export default async function OpsGuardsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isPlatformAdmin(session.user.email ?? null)) notFound();
  return <OpsGuardsClient initial={JSON.parse(JSON.stringify(await opsGuardsReport()))} />;
}
