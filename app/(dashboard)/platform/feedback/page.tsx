/**
 * The feedback inbox: everything sent with the Feedback button, from agency
 * users, creators and clients on share or list links, each with its screenshot.
 *
 * Platform admins only, by the same guard as /platform/ops: notFound() for
 * anyone else, so nothing is read for them. Agencies never see this page or a
 * link to it.
 */
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { readInbox } from "@/lib/feedback/inbox";
import FeedbackInboxClient from "./FeedbackInboxClient";

export const dynamic = "force-dynamic";

export default async function FeedbackInboxPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isPlatformAdmin(session.user.email ?? null)) notFound();
  return <FeedbackInboxClient initial={JSON.parse(JSON.stringify(await readInbox("open")))} />;
}
