/**
 * The tracker reader's ops page (plan T7): which reader is live, how Plan A
 * and Plan B are doing, and the legacy · A · B switch.
 *
 * Platform admins only, by the same guard as /platform: notFound() for anyone
 * else, so no health row or switch state is read for them. Agencies never see
 * this page or a link to it.
 */
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { trackerOpsReport } from "@/lib/trackers/opsReport";
import TrackerOpsClient from "./TrackerOpsClient";

export const dynamic = "force-dynamic";

export default async function TrackerOpsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isPlatformAdmin(session.user.email ?? null)) notFound();
  return <TrackerOpsClient initial={JSON.parse(JSON.stringify(await trackerOpsReport()))} />;
}
