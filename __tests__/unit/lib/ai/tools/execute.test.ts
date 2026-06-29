import {
  executeTool,
  type ExecutionContext,
  type ExecuteDeps,
  type AuditEntry,
} from "@/lib/ai/tools/execute";

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    orgId: "org_1",
    userId: "user_1",
    permissions: [],
    ...overrides,
  };
}

describe("executeTool", () => {
  it("returns unknown_tool for a name not in the registry", async () => {
    const deps: ExecuteDeps = { executors: {} };
    const result = await executeTool("does_not_exist", {}, makeCtx(), deps);
    expect(result).toEqual({ status: "error", code: "unknown_tool" });
  });

  it("returns invalid_input with flattened issues for a bad search_creators payload", async () => {
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { search_creators: spy } };
    const ctx = makeCtx({ permissions: ["creators:read"] });
    const result = await executeTool("search_creators", { platform: "TIKTOK" }, ctx, deps);
    expect(result.status).toBe("invalid_input");
    if (result.status === "invalid_input") {
      expect(result.issues.fieldErrors).toHaveProperty("query");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates input before checking permissions (invalid input wins even without permission)", async () => {
    const deps: ExecuteDeps = { executors: {} };
    const ctx = makeCtx({ permissions: [] });
    const result = await executeTool("search_creators", { limit: 999 }, ctx, deps);
    expect(result.status).toBe("invalid_input");
  });

  it("denies a tool when the caller lacks the required permission and does not leak input", async () => {
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { search_creators: spy } };
    const ctx = makeCtx({ permissions: ["campaigns:read"] });
    const result = await executeTool(
      "search_creators",
      { query: "fitness creators" },
      ctx,
      deps,
    );
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.reason).toContain("creators:read");
    }
    expect(JSON.stringify(result)).not.toContain("fitness creators");
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks send_invite at the approval gate when ctx.approval is absent", async () => {
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { send_invite: spy } };
    const ctx = makeCtx({ permissions: ["campaigns:write"] });
    const result = await executeTool(
      "send_invite",
      { creatorId: "c_1", campaignId: "camp_1" },
      ctx,
      deps,
    );
    expect(result.status).toBe("needs_approval");
    if (result.status === "needs_approval") {
      expect(result.tool).toBe("send_invite");
      expect(result.input).toEqual({ creatorId: "c_1", campaignId: "camp_1" });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks request_payout at the approval gate when ctx.approval is absent", async () => {
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { request_payout: spy } };
    const ctx = makeCtx({ permissions: ["payouts:write"] });
    const result = await executeTool(
      "request_payout",
      { activationId: "act_1", amount: 250 },
      ctx,
      deps,
    );
    expect(result.status).toBe("needs_approval");
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks send_invite when approval is present but invalid (empty approvedBy)", async () => {
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { send_invite: spy } };
    const ctx = makeCtx({
      permissions: ["campaigns:write"],
      approval: { approvedBy: "" },
    });
    const result = await executeTool(
      "send_invite",
      { creatorId: "c_1", campaignId: "camp_1" },
      ctx,
      deps,
    );
    expect(result.status).toBe("needs_approval");
    expect(spy).not.toHaveBeenCalled();
  });

  it("runs the executor for send_invite when a valid approval is present", async () => {
    const spy = jest.fn().mockResolvedValue({ inviteId: "inv_1" });
    const deps: ExecuteDeps = { executors: { send_invite: spy } };
    const input = { creatorId: "c_1", campaignId: "camp_1" };
    const ctx = makeCtx({
      permissions: ["campaigns:write"],
      approval: { approvedBy: "manager_1" },
    });
    const result = await executeTool("send_invite", input, ctx, deps);
    expect(result).toEqual({ status: "ok", data: { inviteId: "inv_1" } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(input, ctx);
  });

  it("executes a read tool with the correct permission and returns its data", async () => {
    const spy = jest.fn().mockResolvedValue([{ id: "c_1" }]);
    const deps: ExecuteDeps = { executors: { search_creators: spy } };
    const ctx = makeCtx({ permissions: ["creators:read"] });
    const result = await executeTool(
      "search_creators",
      { query: "fitness micro creators", platform: "TIKTOK" },
      ctx,
      deps,
    );
    expect(result).toEqual({ status: "ok", data: [{ id: "c_1" }] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("passes the zod-parsed input (with defaults applied) into the executor", async () => {
    const spy = jest.fn().mockResolvedValue([]);
    const deps: ExecuteDeps = { executors: { search_creators: spy } };
    const ctx = makeCtx({ permissions: ["creators:read"] });
    await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ query: "x", limit: 25 }),
      ctx,
    );
  });

  it("returns no_executor when the tool passes all gates but has no executor wired", async () => {
    const deps: ExecuteDeps = { executors: {} };
    const ctx = makeCtx({ permissions: ["creators:read"] });
    const result = await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(result).toEqual({ status: "error", code: "no_executor" });
  });

  it("wraps an executor throw into executor_threw with the message", async () => {
    const spy = jest.fn().mockRejectedValue(new Error("downstream boom"));
    const deps: ExecuteDeps = { executors: { search_creators: spy } };
    const ctx = makeCtx({ permissions: ["creators:read"] });
    const result = await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("executor_threw");
      if (result.code === "executor_threw") {
        expect(result.message).toBe("downstream boom");
      }
    }
  });

  it("invokes the audit sink with the correct orgId, tool, userId, and status on success", async () => {
    const audit = jest.fn<Promise<void>, [AuditEntry]>().mockResolvedValue();
    const deps: ExecuteDeps = {
      executors: { search_creators: jest.fn().mockResolvedValue([]) },
      audit,
    };
    const ctx = makeCtx({ orgId: "org_42", userId: "user_9", permissions: ["creators:read"] });
    await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({
      tool: "search_creators",
      orgId: "org_42",
      userId: "user_9",
      status: "ok",
    });
  });

  it("still records an audit entry when the executor throws", async () => {
    const audit = jest.fn<Promise<void>, [AuditEntry]>().mockResolvedValue();
    const deps: ExecuteDeps = {
      executors: { search_creators: jest.fn().mockRejectedValue(new Error("boom")) },
      audit,
    };
    const ctx = makeCtx({ permissions: ["creators:read"] });
    await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "search_creators", status: "error" }),
    );
  });

  it("does NOT audit a denied call because the gate runs before execution", async () => {
    const audit = jest.fn<Promise<void>, [AuditEntry]>().mockResolvedValue();
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { search_creators: spy }, audit };
    const ctx = makeCtx({ permissions: [] });
    const result = await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(result.status).toBe("denied");
    expect(audit).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT audit a needs_approval call and never reaches the executor", async () => {
    const audit = jest.fn<Promise<void>, [AuditEntry]>().mockResolvedValue();
    const spy = jest.fn();
    const deps: ExecuteDeps = { executors: { send_invite: spy }, audit };
    const ctx = makeCtx({ permissions: ["campaigns:write"] });
    await executeTool("send_invite", { creatorId: "c_1", campaignId: "camp_1" }, ctx, deps);
    expect(audit).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the completed result even when the audit sink rejects (best-effort audit never masks a finished action)", async () => {
    const executor = jest.fn().mockResolvedValue({ ran: true });
    const deps: ExecuteDeps = {
      executors: { search_creators: executor },
      audit: jest.fn<Promise<void>, [AuditEntry]>().mockRejectedValue(new Error("audit infra down")),
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeCtx({ permissions: ["creators:read"] });
    const result = await executeTool("search_creators", { query: "x" }, ctx, deps);
    expect(result).toEqual({ status: "ok", data: { ran: true } });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
