import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { hasPermission } from "@/lib/rbac";
import type { AuthResult } from "@/lib/authenticate";

/**
 * Who is calling, as far as the tools need to know.
 *
 * The tools used to receive the org id and nothing else, so a session that the
 * dashboard holds to "assigned campaigns only" read every campaign in the org
 * through MCP, and a VIEWER could spend a campaign's refresh allowance. The
 * route now passes the caller's whole authentication and the tools apply the
 * same two rules the HTTP routes do:
 *
 *  - campaignWhere: the row scope, merged into every campaign lookup and every
 *    campaign relation filter. {} for OWNER/ADMIN, "all campaigns" members and
 *    API keys, so for them nothing changes.
 *  - canRefresh: refresh_campaign is the one write, and it takes the same
 *    permission as the Refresh Data button (campaigns:edit_own). An org API
 *    key passes, as it passes every permission.
 *
 * Org-wide aggregates (list_payouts, get_org_kpis, creators) are not narrowed
 * by row scope, which matches the dashboard screens that show the same totals.
 */
export type McpCaller = {
  orgId: string;
  campaignWhere: Record<string, unknown>;
  canRefresh: boolean;
};

export function mcpCallerFor(auth: AuthResult): McpCaller {
  return {
    orgId: auth.orgId,
    campaignWhere: campaignScopeWhereFor(auth),
    canRefresh:
      auth.actorType === "api_key" || (auth.role != null && hasPermission(auth.role, "campaigns:edit_own")),
  };
}
