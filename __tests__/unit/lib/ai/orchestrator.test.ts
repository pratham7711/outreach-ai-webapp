import {
  runAgent,
  buildToolSchemas,
  type AnthropicLike,
  type MessageLike,
} from "@/lib/ai/orchestrator";
import { MODELS } from "@/lib/ai/models";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import type { ExecuteDeps, ExecutionContext } from "@/lib/ai/tools/execute";

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    orgId: "org_1",
    userId: "user_1",
    permissions: [],
    ...overrides,
  };
}

function textTurn(text: string): MessageLike {
  return { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }] };
}

function toolTurn(name: string, input: unknown, id = "tu_1"): MessageLike {
  return {
    role: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
  };
}

function scriptedClient(turns: MessageLike[]): {
  client: AnthropicLike;
  create: jest.Mock;
} {
  let i = 0;
  const create = jest.fn(async () => {
    const turn = turns[Math.min(i, turns.length - 1)];
    i += 1;
    return turn;
  });
  return { client: { messages: { create } }, create };
}

describe("runAgent", () => {
  it("(a) returns completed with finalText when the model emits text + end_turn", async () => {
    const { client } = scriptedClient([textTurn("Here is my plan, done.")]);
    const deps: ExecuteDeps = { executors: {} };
    const result = await runAgent({
      goal: "Summarize the campaign",
      ctx: makeCtx(),
      deps,
      client,
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Here is my plan, done.");
    expect(result.steps).toBe(1);
  });

  it("(b) runs a read tool_use, feeds the result back, then completes", async () => {
    const executor = jest.fn().mockResolvedValue({ score: 0.92 });
    const deps: ExecuteDeps = { executors: { authenticity_check: executor } };
    const { client } = scriptedClient([
      toolTurn("authenticity_check", { creatorId: "c_1" }),
      textTurn("The creator looks authentic."),
    ]);
    const result = await runAgent({
      goal: "Check creator authenticity",
      ctx: makeCtx({ permissions: ["creators:read"] }),
      deps,
      client,
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("The creator looks authentic.");
    expect(executor).toHaveBeenCalledTimes(1);
    const toolResultMessage = (result.messages as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    expect(toolResultMessage).toBeDefined();
  });

  it("(c) SAFETY: send_invite tool_use with no approval halts at awaiting_approval and never executes", async () => {
    const sendInviteSpy = jest.fn().mockResolvedValue({ inviteId: "inv_should_not_exist" });
    const followUp = jest.fn();
    const deps: ExecuteDeps = {
      executors: { send_invite: sendInviteSpy, search_creators: followUp },
    };
    const { client, create } = scriptedClient([
      toolTurn("send_invite", { creatorId: "c_1", campaignId: "camp_1" }),
      textTurn("This should never be reached."),
    ]);
    const result = await runAgent({
      goal: "Invite the creator",
      ctx: makeCtx({ permissions: ["campaigns:write"] }),
      deps,
      client,
    });
    expect(result.status).toBe("awaiting_approval");
    expect(result.pendingApproval).toEqual({
      tool: "send_invite",
      input: { creatorId: "c_1", campaignId: "camp_1" },
    });
    expect(sendInviteSpy).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("(c2) SAFETY: request_payout is also gated to awaiting_approval and never executes", async () => {
    const payoutSpy = jest.fn().mockResolvedValue({ ok: true });
    const deps: ExecuteDeps = { executors: { request_payout: payoutSpy } };
    const { client } = scriptedClient([
      toolTurn("request_payout", { activationId: "act_1", amount: 500 }),
    ]);
    const result = await runAgent({
      goal: "Pay the creator",
      ctx: makeCtx({ permissions: ["payouts:write"] }),
      deps,
      client,
    });
    expect(result.status).toBe("awaiting_approval");
    expect(result.pendingApproval?.tool).toBe("request_payout");
    expect(payoutSpy).not.toHaveBeenCalled();
  });

  it("(d) caps at maxSteps when the model emits tool_use forever (no infinite loop)", async () => {
    const executor = jest.fn().mockResolvedValue({ ok: true });
    const deps: ExecuteDeps = { executors: { authenticity_check: executor } };
    const forever: MessageLike = {
      role: "assistant",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_loop", name: "authenticity_check", input: { creatorId: "c_1" } }],
    };
    const { client, create } = scriptedClient([forever]);
    const result = await runAgent({
      goal: "Loop forever",
      ctx: makeCtx({ permissions: ["creators:read"] }),
      deps,
      client,
      maxSteps: 3,
    });
    expect(result.status).toBe("max_steps");
    expect(result.steps).toBe(3);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("(e) buildToolSchemas yields a non-empty input_schema with a 'type' for each tool", () => {
    const schemas = buildToolSchemas();
    expect(schemas.length).toBe(Object.keys(TOOL_REGISTRY).length);
    for (const schema of schemas) {
      expect(typeof schema.name).toBe("string");
      expect(typeof schema.description).toBe("string");
      const inputSchema = schema.input_schema as { type?: unknown };
      expect(inputSchema).toBeTruthy();
      expect(inputSchema.type).toBe("object");
    }
  });

  it("(f) a denied tool result is fed back and the loop still completes", async () => {
    const executor = jest.fn();
    const deps: ExecuteDeps = { executors: { search_creators: executor } };
    const { client } = scriptedClient([
      toolTurn("search_creators", { query: "fitness creators" }),
      textTurn("I could not access creators; here is what I can do."),
    ]);
    const result = await runAgent({
      goal: "Find creators",
      ctx: makeCtx({ permissions: [] }),
      deps,
      client,
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toContain("could not access");
    expect(executor).not.toHaveBeenCalled();
    const toolResultMessage = (result.messages as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    const blocks = (toolResultMessage as { content: Array<{ content: string }> }).content;
    expect(JSON.parse(blocks[0].content)).toMatchObject({ status: "denied" });
  });

  it("(g) tools-array construction is deterministic and order-stable", () => {
    const a = buildToolSchemas();
    const b = buildToolSchemas();
    expect(a.map((t) => t.name)).toEqual(b.map((t) => t.name));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a.map((t) => t.name)).toEqual(Object.keys(TOOL_REGISTRY));
  });

  it("(h) the executor receives ctx.orgId taken from the caller ctx, not model output", async () => {
    let seenCtx: ExecutionContext | undefined;
    const executor = jest.fn(async (_input: unknown, ctx: ExecutionContext) => {
      seenCtx = ctx;
      return { ok: true };
    });
    const deps: ExecuteDeps = { executors: { search_creators: executor } };
    const { client } = scriptedClient([
      toolTurn("search_creators", { query: "x", orgId: "ATTACKER_ORG" }),
      textTurn("done"),
    ]);
    const result = await runAgent({
      goal: "search",
      ctx: makeCtx({ orgId: "org_real", permissions: ["creators:read"] }),
      deps,
      client,
    });
    expect(result.status).toBe("completed");
    expect(executor).toHaveBeenCalledTimes(1);
    expect(seenCtx?.orgId).toBe("org_real");
  });

  it("(i) passes MODELS.orchestrator as the model id on every create call", async () => {
    const { client, create } = scriptedClient([textTurn("done")]);
    const deps: ExecuteDeps = { executors: {} };
    await runAgent({ goal: "g", ctx: makeCtx(), deps, client });
    const args = create.mock.calls[0][0] as { model: string; tools: unknown[] };
    expect(args.model).toBe(MODELS.orchestrator);
    expect(Array.isArray(args.tools)).toBe(true);
  });

  it("(j) FAIL-CLOSED: a tool_use co-occurring with stop_reason 'end_turn' is still gated, not dropped", async () => {
    const sendInviteSpy = jest.fn().mockResolvedValue({ inviteId: "should_not_exist" });
    const deps: ExecuteDeps = { executors: { send_invite: sendInviteSpy } };
    const anomalousTurn: MessageLike = {
      role: "assistant",
      stop_reason: "end_turn",
      content: [
        { type: "tool_use", id: "tu_x", name: "send_invite", input: { creatorId: "c_1", campaignId: "camp_1" } },
      ],
    };
    const { client } = scriptedClient([anomalousTurn]);
    const result = await runAgent({
      goal: "Invite",
      ctx: makeCtx({ permissions: ["campaigns:write"] }),
      deps,
      client,
    });
    expect(result.status).toBe("awaiting_approval");
    expect(result.pendingApproval?.tool).toBe("send_invite");
    expect(sendInviteSpy).not.toHaveBeenCalled();
  });
});
