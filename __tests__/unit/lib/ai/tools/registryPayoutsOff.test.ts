/* The AI tool registry with payouts switched off (lib/payouts/switch.ts), the
   production state. registry.test.ts and its neighbours cover it switched on. */
jest.mock("@/lib/payouts/switch", () => ({ PAYOUTS_ENABLED: false }));

import { TOOL_REGISTRY, getTool } from "@/lib/ai/tools/registry";
import { buildToolSchemas } from "@/lib/ai/orchestrator";
import { toMcpTools } from "@/lib/ai/mcp/toolAdapter";
import { executeTool } from "@/lib/ai/tools/execute";

describe("AI tool registry with payouts switched off", () => {
  it("does not register request_payout", () => {
    expect(TOOL_REGISTRY.request_payout).toBeUndefined();
    expect(getTool("request_payout")).toBeUndefined();
  });

  it("keeps every other tool", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual(
      ["authenticity_check", "brand_fit", "roi_forecast", "search_creators", "send_invite"].sort(),
    );
  });

  it("never offers it to the model or over MCP", () => {
    expect(buildToolSchemas().map((t) => t.name)).not.toContain("request_payout");
    expect(toMcpTools().map((t) => t.name)).not.toContain("request_payout");
  });

  it("refuses a call to it as an unknown tool, without reaching an executor", async () => {
    const spy = jest.fn();
    const result = await executeTool(
      "request_payout",
      { activationId: "act_1", amount: 500 },
      { orgId: "org-1", userId: "u-1", permissions: ["payouts:write"], approval: { approvedBy: "u-2" } } as never,
      { executors: { request_payout: spy } },
    );
    expect(result).toEqual({ status: "error", code: "unknown_tool" });
    expect(spy).not.toHaveBeenCalled();
  });
});
