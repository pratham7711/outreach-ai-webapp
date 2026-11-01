import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { CREATOR_FINDER_FEATURE } from "@/lib/featureKeys";
import CreatorFinderBoard from "./CreatorFinderBoard";

/* The sidebar hides the link from orgs without creator_finder; this is the
   control. An org without it gets a 404 rather than a page that explains a
   feature it can't have. */
export default async function CreatorFinderPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as { orgId?: string }).orgId;
  if (!orgId) redirect("/login");
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, CREATOR_FINDER_FEATURE)) notFound();
  return <CreatorFinderBoard />;
}
