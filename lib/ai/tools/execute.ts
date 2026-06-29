import { z } from "zod";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";

export interface ExecutionContext {
  orgId: string;
  userId: string;
  permissions: string[];
  approval?: { approvedBy: string };
}

export interface AuditEntry {
  tool: string;
  orgId: string;
  userId: string;
  status: ToolResult["status"];
}

export interface ExecuteDeps {
  executors: Record<
    string,
    (input: unknown, ctx: ExecutionContext) => Promise<unknown>
  >;
  audit?: (entry: AuditEntry) => Promise<void>;
}

export type ToolResult =
  | { status: "ok"; data: unknown }
  | { status: "error"; code: "unknown_tool" }
  | { status: "error"; code: "no_executor" }
  | { status: "error"; code: "executor_threw"; message: string }
  | { status: "invalid_input"; issues: ReturnType<z.ZodError["flatten"]> }
  | { status: "denied"; reason: string }
  | { status: "needs_approval"; tool: string; input: unknown };

function isValidApproval(
  approval: ExecutionContext["approval"],
): approval is { approvedBy: string } {
  return (
    typeof approval === "object" &&
    approval !== null &&
    typeof approval.approvedBy === "string" &&
    approval.approvedBy.length > 0
  );
}

export async function executeTool(
  toolName: string,
  rawInput: unknown,
  ctx: ExecutionContext,
  deps: ExecuteDeps,
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) {
    return { status: "error", code: "unknown_tool" };
  }

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "invalid_input", issues: parsed.error.flatten() };
  }
  const parsedInput = parsed.data;

  if (!ctx.permissions.includes(tool.permission)) {
    return {
      status: "denied",
      reason: `Missing required permission: ${tool.permission}`,
    };
  }

  if (tool.requiresApproval && !isValidApproval(ctx.approval)) {
    return { status: "needs_approval", tool: toolName, input: parsedInput };
  }

  const fn = deps.executors[toolName];
  if (!fn) {
    return { status: "error", code: "no_executor" };
  }

  let result: ToolResult;
  try {
    const data = await fn(parsedInput, ctx);
    result = { status: "ok", data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { status: "error", code: "executor_threw", message };
  }

  if (tool.audit && deps.audit) {
    try {
      await deps.audit({
        tool: toolName,
        orgId: ctx.orgId,
        userId: ctx.userId,
        status: result.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Audit sink failed for tool ${toolName}: ${message}`);
    }
  }

  return result;
}
