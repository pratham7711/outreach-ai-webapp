import { MODELS, modelFor, MODEL_METADATA, type ModelRole } from "@/lib/ai/models";

describe("MODELS", () => {
  const expectedRoles: ModelRole[] = ["orchestrator", "subagent", "analyst"];

  it("has exactly the expected roles", () => {
    expect(Object.keys(MODELS).sort()).toEqual([...expectedRoles].sort());
  });

  it("pins each id to its exact string", () => {
    expect(MODELS.orchestrator).toBe("claude-opus-4-8");
    expect(MODELS.subagent).toBe("claude-haiku-4-5");
    expect(MODELS.analyst).toBe("claude-sonnet-4-6");
  });

  it("has no date-suffixed ids", () => {
    const dateSuffix = /-\d{8}$/;
    for (const id of Object.values(MODELS)) {
      expect(id).not.toMatch(dateSuffix);
    }
  });
});

describe("modelFor", () => {
  it("returns the right id for each role", () => {
    expect(modelFor("orchestrator")).toBe("claude-opus-4-8");
    expect(modelFor("subagent")).toBe("claude-haiku-4-5");
    expect(modelFor("analyst")).toBe("claude-sonnet-4-6");
  });

  it("matches the MODELS entry for every role", () => {
    (Object.keys(MODELS) as ModelRole[]).forEach((role) => {
      expect(modelFor(role)).toBe(MODELS[role]);
    });
  });

  it("returns ids that are never date-suffixed", () => {
    const dateSuffix = /-\d{8}$/;
    (Object.keys(MODELS) as ModelRole[]).forEach((role) => {
      expect(modelFor(role)).not.toMatch(dateSuffix);
    });
  });
});

describe("MODEL_METADATA", () => {
  it("covers every role with a sensible context window", () => {
    (Object.keys(MODELS) as ModelRole[]).forEach((role) => {
      const meta = MODEL_METADATA[role];
      expect(meta).toBeDefined();
      if (meta.contextWindow !== undefined) {
        expect(meta.contextWindow).toBeGreaterThan(0);
      }
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(MODEL_METADATA)).toBe(true);
  });
});
