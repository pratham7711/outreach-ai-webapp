import { z } from "zod";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import type { ToolDefinition } from "@/lib/ai/tools/types";

export interface McpToolAnnotations {
  permission: string;
  requiresApproval: boolean;
  audit: boolean;
  readOnlyHint: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: object;
  annotations: McpToolAnnotations;
}

function coerceBool(value: unknown): boolean {
  return value === true;
}

function resolveRequiresApproval(value: unknown): boolean {
  return value !== false;
}

function safeJsonSchema(input: ToolDefinition["input"]): object {
  const schema = z.toJSONSchema(input);
  if (schema === null || typeof schema !== "object") {
    throw new Error("toMcpTool: input schema did not convert to a JSON-schema object");
  }
  return schema as object;
}

export function toMcpTool(tool: ToolDefinition): McpToolDescriptor {
  if (!tool || typeof tool.name !== "string" || tool.name.length === 0) {
    throw new Error("toMcpTool: tool is missing a valid name");
  }
  if (typeof tool.description !== "string") {
    throw new Error("toMcpTool: tool is missing a description");
  }

  const requiresApproval = resolveRequiresApproval(tool.requiresApproval);
  const audit = coerceBool(tool.audit);
  const permission = typeof tool.permission === "string" ? tool.permission : "";

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: safeJsonSchema(tool.input),
    annotations: {
      permission,
      requiresApproval,
      audit,
      readOnlyHint: !requiresApproval,
    },
  };
}

export function toMcpTools(
  registry: Record<string, ToolDefinition> = TOOL_REGISTRY,
): McpToolDescriptor[] {
  return Object.values(registry)
    .map((tool) => toMcpTool(tool))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
