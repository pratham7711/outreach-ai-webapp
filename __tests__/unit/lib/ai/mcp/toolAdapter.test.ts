import { z } from "zod";
import { toMcpTool, toMcpTools } from "@/lib/ai/mcp/toolAdapter";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import type { ToolDefinition } from "@/lib/ai/tools/types";

const readTool: ToolDefinition = {
  name: "search_creators",
  description: "Search the creator graph by query, platform, and follower thresholds.",
  category: "discovery",
  input: z.object({
    query: z.string().min(1),
    limit: z.number().min(1).max(100).default(25),
  }),
  permission: "creators:read",
  requiresApproval: false,
  audit: true,
};

describe("toMcpTool", () => {
  it("produces name/description/inputSchema/annotations for a read tool", () => {
    const descriptor = toMcpTool(readTool);
    expect(descriptor.name).toBe("search_creators");
    expect(descriptor.description).toBe(readTool.description);
    expect(typeof descriptor.inputSchema).toBe("object");
    expect(descriptor.annotations).toEqual({
      permission: "creators:read",
      requiresApproval: false,
      audit: true,
      readOnlyHint: true,
    });
  });

  it("inputSchema is a valid JSON-schema object derived from the zod input", () => {
    const descriptor = toMcpTool(readTool);
    const schema = descriptor.inputSchema as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty("query");
    expect(schema.properties).toHaveProperty("limit");
  });

  it("a read-only tool has readOnlyHint:true + requiresApproval:false", () => {
    const descriptor = toMcpTool(readTool);
    expect(descriptor.annotations.requiresApproval).toBe(false);
    expect(descriptor.annotations.readOnlyHint).toBe(true);
  });

  it("annotations preserve permission + audit metadata", () => {
    const descriptor = toMcpTool(readTool);
    expect(descriptor.annotations.permission).toBe("creators:read");
    expect(descriptor.annotations.audit).toBe(true);
  });

  it("fail-closed: a tool missing requiresApproval defaults to requiring approval", () => {
    const malformed = {
      name: "mystery_tool",
      description: "A tool whose requiresApproval flag is absent.",
      category: "discovery",
      input: z.object({ q: z.string() }),
      permission: "creators:read",
      audit: true,
    } as unknown as ToolDefinition;
    const descriptor = toMcpTool(malformed);
    expect(descriptor.annotations.requiresApproval).toBe(true);
    expect(descriptor.annotations.readOnlyHint).toBe(false);
  });

  it("fail-closed: a non-boolean requiresApproval is treated as requiring approval", () => {
    const malformed = {
      ...readTool,
      requiresApproval: "no" as unknown as boolean,
    } as ToolDefinition;
    const descriptor = toMcpTool(malformed);
    expect(descriptor.annotations.requiresApproval).toBe(true);
    expect(descriptor.annotations.readOnlyHint).toBe(false);
  });

  it("only an explicit false disables approval", () => {
    const descriptor = toMcpTool({ ...readTool, requiresApproval: false });
    expect(descriptor.annotations.requiresApproval).toBe(false);
    expect(descriptor.annotations.readOnlyHint).toBe(true);
  });
});

describe("toMcpTools over the committed registry", () => {
  it("returns one descriptor per registry tool", () => {
    const descriptors = toMcpTools();
    expect(descriptors).toHaveLength(Object.keys(TOOL_REGISTRY).length);
  });

  it("returns descriptors in name-sorted (deterministic) order", () => {
    const names = toMcpTools().map((d) => d.name);
    const expected = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(expected);
  });

  it("send_invite carries requiresApproval:true + readOnlyHint:false", () => {
    const descriptor = toMcpTools().find((d) => d.name === "send_invite");
    expect(descriptor).toBeDefined();
    expect(descriptor!.annotations.requiresApproval).toBe(true);
    expect(descriptor!.annotations.readOnlyHint).toBe(false);
  });

  it("request_payout carries requiresApproval:true (no freely-callable write tool)", () => {
    const descriptor = toMcpTools().find((d) => d.name === "request_payout");
    expect(descriptor).toBeDefined();
    expect(descriptor!.annotations.requiresApproval).toBe(true);
    expect(descriptor!.annotations.readOnlyHint).toBe(false);
  });

  it("every approval-required tool surfaces requiresApproval:true in annotations", () => {
    for (const descriptor of toMcpTools()) {
      const source = TOOL_REGISTRY[descriptor.name];
      if (source.requiresApproval) {
        expect(descriptor.annotations.requiresApproval).toBe(true);
        expect(descriptor.annotations.readOnlyHint).toBe(false);
      }
    }
  });

  it("is deterministic: same registry -> deep-equal output", () => {
    expect(toMcpTools()).toEqual(toMcpTools());
  });
});
