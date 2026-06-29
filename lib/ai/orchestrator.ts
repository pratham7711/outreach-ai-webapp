import { z } from "zod";
import { MODELS } from "@/lib/ai/models";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import {
  executeTool,
  type ExecuteDeps,
  type ExecutionContext,
  type ToolResult,
} from "@/lib/ai/tools/execute";

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type ContentBlock = TextBlock | ToolUseBlock | { type: string; [key: string]: unknown };

export interface MessageLike {
  role?: string;
  stop_reason?: string | null;
  content: ContentBlock[];
}

export interface AnthropicLike {
  messages: { create(args: unknown): Promise<MessageLike> };
}

export interface AgentRunResult {
  status: "completed" | "awaiting_approval" | "max_steps";
  finalText: string;
  steps: number;
  messages: unknown[];
  pendingApproval?: { tool: string; input: unknown };
}

const DEFAULT_MAX_STEPS = 8;
const MAX_TOKENS = 4096;
const DEFAULT_SYSTEM =
  "You are the Outreach AI orchestrator. Plan with the provided tools to accomplish the goal. Write and financial actions require human approval.";

export function buildToolSchemas(): AnthropicToolSchema[] {
  return Object.values(TOOL_REGISTRY).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.input),
  }));
}

function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text" && typeof (block as TextBlock).text === "string";
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

function collectText(content: ContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("");
}

function toolResultContent(toolUseId: string, result: ToolResult) {
  const isError = result.status === "error" || result.status === "invalid_input";
  return {
    type: "tool_result" as const,
    tool_use_id: toolUseId,
    is_error: isError,
    content: JSON.stringify(result),
  };
}

export async function runAgent(params: {
  goal: string;
  ctx: ExecutionContext;
  deps: ExecuteDeps;
  client: AnthropicLike;
  maxSteps?: number;
  system?: string;
}): Promise<AgentRunResult> {
  const { goal, ctx, deps, client } = params;
  const maxSteps = params.maxSteps ?? DEFAULT_MAX_STEPS;
  const system = params.system ?? DEFAULT_SYSTEM;
  const tools = buildToolSchemas();

  const messages: unknown[] = [{ role: "user", content: goal }];
  let steps = 0;
  let finalText = "";

  while (steps < maxSteps) {
    steps += 1;

    const response = await client.messages.create({
      model: MODELS.orchestrator,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      tools,
    });

    const content = Array.isArray(response.content) ? response.content : [];
    finalText = collectText(content);
    messages.push({ role: "assistant", content });

    const toolUses = content.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      return { status: "completed", finalText, steps, messages };
    }

    const toolResultBlocks: ReturnType<typeof toolResultContent>[] = [];
    for (const block of toolUses) {
      const result = await executeTool(block.name, block.input, ctx, deps);

      if (result.status === "needs_approval") {
        return {
          status: "awaiting_approval",
          finalText,
          steps,
          messages,
          pendingApproval: { tool: result.tool, input: result.input },
        };
      }

      toolResultBlocks.push(toolResultContent(block.id, result));
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  return { status: "max_steps", finalText, steps, messages };
}
