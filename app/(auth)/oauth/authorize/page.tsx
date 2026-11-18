import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, Link2, RefreshCw } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { hasPermission, type UserRole } from "@/lib/rbac";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { API_ACCESS_FEATURE } from "@/lib/featureKeys";
import { signInPathFor } from "@/lib/callbackPath";
import { AuthNotice, AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ds";
import { checkAuthorizeRequest, paramsFrom } from "@/lib/oauth/authorizeRequest";
import { clientDisplayName, redirectHostLabel } from "@/lib/oauth/mcpOAuth";
import { requestOrigin } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;


export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const params = paramsFrom(sp);
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")
  ).toString();

  const session = await auth();
  if (!session?.user) redirect(signInPathFor("/login", `/oauth/authorize?${query}`));

  const origin = await requestOrigin();
  const check = await checkAuthorizeRequest(params, origin, origin);
  if (check.kind === "fatal") {
    return (
      <AuthShell title="Can't connect this app" subtitle={check.message} icon={<Link2 size={28} aria-hidden />} />
    );
  }
  if (check.kind === "redirect") redirect(check.url);

  const user = session.user as { email?: string | null; orgId?: string; role?: UserRole; campaignScope?: string };
  const orgId = user.orgId as string;
  const [org, entitlements] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    getOrgEntitlements(orgId),
  ]);
  const allowed = hasOrgFeature(entitlements, API_ACCESS_FEATURE);
  const canRefresh = user.role ? hasPermission(user.role, "campaigns:edit_own") : false;
  const appName = clientDisplayName(check.client);
  const scopeNote = user.campaignScope === "ASSIGNED" ? "the campaigns assigned to you" : "every campaign in the workspace";

  return (
    <AuthShell
      title={`Connect ${appName} to ${BRAND.name}`}
      subtitle={
        <>
          {appName} will use <strong>{org?.name ?? "your workspace"}</strong> as {user.email ?? "you"}.
        </>
      }
      icon={<Link2 size={28} aria-hidden />}
    >
      {!allowed ? (
        <AuthNotice tone="warning">
          This workspace&rsquo;s plan doesn&rsquo;t include API access, which apps use to connect. An owner can turn it
          on from the plan settings.
        </AuthNotice>
      ) : (
        <ul className="cc-oauth__grants" data-testid="oauth-grants">
          <li>
            <Check size={16} aria-hidden />
            <span>Read campaigns, posts, creators and their performance in {scopeNote}</span>
          </li>
          {canRefresh && (
            <li>
              <RefreshCw size={16} aria-hidden />
              <span>Refresh a campaign&rsquo;s numbers, at most once every 30 minutes</span>
            </li>
          )}
        </ul>
      )}
      <form method="post" action="/api/oauth/authorize" className="cc-oauth__actions">
        {Object.entries(params).map(([k, v]) =>
          typeof v === "string" ? <input key={k} type="hidden" name={k} value={v} /> : null
        )}
        {allowed && (
          <Button type="submit" name="decision" value="allow" variant="primary" data-testid="oauth-allow">
            Allow
          </Button>
        )}
        <Button type="submit" name="decision" value="deny" variant="secondary" data-testid="oauth-deny">
          {allowed ? "Cancel" : `Back to ${appName}`}
        </Button>
      </form>
      <p className="cc-oauth__fine">
        Sends you back to <code>{redirectHostLabel(check.redirectUri)}</code>. Disconnect any time from{" "}
        <a href="/mcp#connected">Connected apps</a>.
      </p>
    </AuthShell>
  );
}
