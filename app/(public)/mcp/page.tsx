import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { API_ACCESS_FEATURE } from "@/lib/featureKeys";
import { getMcpToolDefinitions } from "@/lib/mcp/tools";
import { toolLabel } from "@/lib/mcp/toolLabels";
import { mcpResourceUrl } from "@/lib/oauth/mcpOAuth";
import { requestOrigin } from "@/lib/oauth/requestOrigin";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { McpConnect } from "./McpConnect";

export const dynamic = "force-dynamic";

const TITLE = `${BRAND.name} MCP — your campaigns in Claude`;
const DESCRIPTION = `Connect ${BRAND.name} to Claude and ask about campaigns, posts and creators in plain words. Sign in once; no keys to copy.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
};

export default async function McpPage() {
  const origin = await requestOrigin();
  const mcpUrl = mcpResourceUrl(origin);
  const session = await auth();
  const orgId = (session?.user as { orgId?: string } | undefined)?.orgId ?? null;
  const apiAccess = orgId ? hasOrgFeature(await getOrgEntitlements(orgId), API_ACCESS_FEATURE) : null;
  const tools = getMcpToolDefinitions().map((t) => ({ name: t.name, label: toolLabel(t.name, t.description) }));

  return (
    <div className="lp-page">
      <a href="#content" className="lp-skip">
        Skip to content
      </a>
      <SiteHeader current="mcp" />
      <main id="content">
        <McpConnect
          brandName={BRAND.name}
          mcpUrl={mcpUrl}
          signedIn={Boolean(session?.user)}
          apiAccess={apiAccess}
          tools={tools}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
