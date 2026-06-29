import { z } from "zod";

export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  category: string;
  input: I;
  permission: string;
  requiresApproval: boolean;
  audit: boolean;
}

export function defineTool<I extends z.ZodTypeAny>(
  def: ToolDefinition<I>,
): ToolDefinition<I> {
  return def;
}
