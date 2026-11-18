/** What each MCP tool does, in a line a person reads on /mcp. Agents read the full descriptions. */
export const MCP_TOOL_LABELS: Record<string, string> = {
  list_campaigns: "Find and list campaigns",
  get_campaign: "Open a campaign",
  get_campaign_performance: "Campaign views, engagement and top posts",
  list_posts: "List posts by campaign, creator or platform",
  get_post: "Look up a post, by id or link",
  get_post_timeseries: "A post's growth over time",
  list_creators: "Your creator roster",
  search_creators: "Search creators",
  get_creator_performance: "A creator's results",
  list_activations: "Who is on which campaign",
  list_payouts: "Payouts",
  get_org_kpis: "Workspace totals",
  get_refresh_status: "When numbers were last refreshed",
  refresh_campaign: "Refresh a campaign's numbers",
};

export function toolLabel(name: string, description: string): string {
  return MCP_TOOL_LABELS[name] ?? description.split(/(?<=\.)\s/)[0];
}
