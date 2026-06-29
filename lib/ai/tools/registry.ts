import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/ai/tools/types";

export const search_creators = defineTool({
  name: "search_creators",
  description: "Search the creator graph by query, platform, and follower thresholds.",
  category: "discovery",
  input: z.object({
    query: z.string().min(1),
    platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
    minFollowers: z.number().min(0).optional(),
    limit: z.number().min(1).max(100).default(25),
  }),
  permission: "creators:read",
  requiresApproval: false,
  audit: true,
});

export const authenticity_check = defineTool({
  name: "authenticity_check",
  description: "Assess a creator's audience authenticity and bot-likelihood signals.",
  category: "intelligence",
  input: z.object({
    creatorId: z.string().min(1),
  }),
  permission: "creators:read",
  requiresApproval: false,
  audit: true,
});

export const roi_forecast = defineTool({
  name: "roi_forecast",
  description: "Forecast campaign ROI for a creator against a given budget.",
  category: "intelligence",
  input: z.object({
    creatorId: z.string().min(1),
    campaignBudget: z.number().positive(),
  }),
  permission: "campaigns:read",
  requiresApproval: false,
  audit: true,
});

export const brand_fit = defineTool({
  name: "brand_fit",
  description: "Score how well a creator aligns with a brand's keyword profile.",
  category: "intelligence",
  input: z.object({
    creatorId: z.string().min(1),
    brandKeywords: z.array(z.string()).min(1),
  }),
  permission: "creators:read",
  requiresApproval: false,
  audit: true,
});

export const send_invite = defineTool({
  name: "send_invite",
  description: "Send a campaign invitation to a creator. Requires human approval.",
  category: "action",
  input: z.object({
    creatorId: z.string().min(1),
    campaignId: z.string().min(1),
  }),
  permission: "campaigns:write",
  requiresApproval: true,
  audit: true,
});

export const request_payout = defineTool({
  name: "request_payout",
  description: "Request a payout for an activation. Requires human approval.",
  category: "action",
  input: z.object({
    activationId: z.string().min(1),
    amount: z.number().positive(),
  }),
  permission: "payouts:write",
  requiresApproval: true,
  audit: true,
});

const ALL_TOOLS: ToolDefinition[] = [
  search_creators,
  authenticity_check,
  roi_forecast,
  brand_fit,
  send_invite,
  request_payout,
];

function buildRegistry(tools: ToolDefinition[]): Record<string, ToolDefinition> {
  const registry: Record<string, ToolDefinition> = {};
  for (const tool of tools) {
    if (registry[tool.name]) {
      throw new Error(`Duplicate tool name in registry: ${tool.name}`);
    }
    registry[tool.name] = tool;
  }
  return registry;
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = buildRegistry(ALL_TOOLS);

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}
