import {
  buildExplanationPrompt,
  explainScore,
  validateGrounding,
  type AnalystClient,
  type ScoreResultLike,
} from "@/lib/ai/explain/scoreExplanation";
import { MODELS } from "@/lib/ai/models";

function makeResult(overrides: Partial<ScoreResultLike> = {}): ScoreResultLike {
  return {
    score: 82,
    confidence: "high",
    factors: [
      { label: "Engagement rate", impact: 1, detail: "4.20% of followers engaging" },
      { label: "Comment quality", impact: 0.6, detail: "12.00% comment-to-like ratio" },
      { label: "Follow ratio", impact: 0.2, detail: "3.50 followers per following" },
    ],
    ...overrides,
  };
}

function mockClient(text: string): { client: AnalystClient; create: jest.Mock } {
  const create = jest.fn(async () => ({
    content: [{ type: "text", text }],
  }));
  return { client: { messages: { create } }, create };
}

describe("buildExplanationPrompt", () => {
  it("(a) embeds the score and every factor label as evidence", () => {
    const result = makeResult();
    const { user } = buildExplanationPrompt("@creator", result);
    expect(user).toContain("82");
    for (const factor of result.factors) {
      expect(user).toContain(factor.label);
    }
    expect(user).toContain("@creator");
  });

  it("(b) system text forbids inventing data", () => {
    const { system } = buildExplanationPrompt("@creator", makeResult());
    expect(system).toContain("ONLY");
    expect(system).toContain("Do NOT introduce");
  });

  it("(c) is deterministic: same input yields identical strings", () => {
    const a = buildExplanationPrompt("@creator", makeResult());
    const b = buildExplanationPrompt("@creator", makeResult());
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });

  it("(d) handles empty factors without throwing", () => {
    expect(() => buildExplanationPrompt("@creator", makeResult({ factors: [] }))).not.toThrow();
    const { user } = buildExplanationPrompt("@creator", makeResult({ factors: [] }));
    expect(user).toContain("no contributing factors");
  });
});

describe("explainScore", () => {
  it("(e) returns the mock text and groundedFactors equal to the factor labels", async () => {
    const result = makeResult();
    const { client } = mockClient("The score reflects strong engagement.");
    const out = await explainScore({ subject: "@creator", result, client });
    expect(out.text).toBe("The score reflects strong engagement.");
    expect(out.groundedFactors).toEqual([
      "Engagement rate",
      "Comment quality",
      "Follow ratio",
    ]);
  });

  it("(f) calls the client with model MODELS.analyst", async () => {
    const { client, create } = mockClient("ok");
    await explainScore({ subject: "@creator", result: makeResult(), client });
    const args = create.mock.calls[0][0] as { model: string };
    expect(args.model).toBe(MODELS.analyst);
  });

  it("(g) empty factors produce an empty groundedFactors list without throwing", async () => {
    const { client } = mockClient("No factors recorded.");
    const out = await explainScore({
      subject: "@creator",
      result: makeResult({ factors: [] }),
      client,
    });
    expect(out.groundedFactors).toEqual([]);
    expect(out.text).toBe("No factors recorded.");
  });
});

describe("validateGrounding", () => {
  it("(h) ok=true when the text cites only the score", () => {
    const result = makeResult();
    const verdict = validateGrounding(
      "This account earned a score of 82 overall.",
      result,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.unsupportedNumbers).toEqual([]);
  });

  it("(i) flags an invented number like 47% as unsupported", () => {
    const result = makeResult();
    const verdict = validateGrounding(
      "The score is 82 but only 47% of peers reach this.",
      result,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("47%");
  });

  it("(j) numbers appearing in a factor detail are allowed", () => {
    const result = makeResult();
    const verdict = validateGrounding(
      "Engagement sits at 4.20% of followers, supporting the 82 score.",
      result,
    );
    expect(verdict.ok).toBe(true);
  });

  it("(k) empty factors handled without throwing", () => {
    const result = makeResult({ factors: [] });
    expect(() => validateGrounding("Score is 82.", result)).not.toThrow();
    const verdict = validateGrounding("Score is 82.", result);
    expect(verdict.ok).toBe(true);
  });

  it("(l) flags round hallucinations (100/60/20) that never appear literally in the evidence", () => {
    const result = makeResult();
    const verdict = validateGrounding(
      "It reaches 100% authenticity, 60 points above average, and ranks 20 nationally.",
      result,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toEqual(expect.arrayContaining(["100%", "60", "20"]));
  });

  it("(m) flags a multi-digit fabrication like 8200 derived from the score", () => {
    const result = makeResult();
    const verdict = validateGrounding("The creator has 8200 highly engaged fans.", result);
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("8200");
  });
});
