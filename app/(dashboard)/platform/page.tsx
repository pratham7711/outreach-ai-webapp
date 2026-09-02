/**
 * The operator's view of the whole platform.
 *
 * Distinct from /admin, which is an *org-scoped* screen where an agency manages
 * its own clients' feature access. This is the layer above it: every agency, on
 * one page. The two must never merge -- conflating them is how a tenant ends up
 * reading, or editing, another tenant.
 *
 * notFound() rather than redirect() for a non-operator: they get the same
 * not-found screen as any missing page, and getPlatformStats() is never
 * reached, so no cross-tenant row is even read let alone rendered. Verified
 * against a real OWNER of another org: zero tenant strings in the response.
 *
 * Note what this does NOT do. The HTTP status stays 200, because the
 * (dashboard) layout does its own data fetching and has already flushed the
 * streamed shell by the time this guard runs -- so the status is committed
 * before notFound() is called. A genuinely absent route still 404s, which means
 * an operator screen is technically distinguishable from a typo by status code.
 * That is discoverability, not disclosure: /admin and /campaigns are equally
 * discoverable, and the thing worth protecting is the data, which is not served.
 * The API sibling, having no layout above it, does return a real 404.
 */
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { getPlatformStats } from "@/lib/platform/stats";
import PlatformDashboardClient from "./PlatformDashboardClient";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isPlatformAdmin(session.user.email ?? null)) notFound();

  return <PlatformDashboardClient stats={await getPlatformStats()} />;
}
