import {
  buildReportPrompt,
  composeReportBlocks,
  validateReportGrounding,
  type AnalystClient,
  type ReportInput,
} from "@/lib/ai/reports/reportBlocks";
import { MODELS } from "@/lib/ai/models";

function makeInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    subject: "@creator",
    blocks: [
      {
        kind: "authenticity",
        title: "Authenticity",
        metrics: [
          { label: "Authenticity score", value: 82 },
          { label: "Fake-follower rate", value: "4.2%" },
        ],
      },
      {
        kind: "roi",
        title: "ROI",
        metrics: [
          { label: "Cost per engagement", value: 0.35 },
          { label: "Total spend", value: 12000 },
        ],
      },
      {
        kind: "audience",
        title: "Audience",
        metrics: [{ label: "Top region", value: "US" }],
      },
    ],
    ...overrides,
  };
}

function mockClient(text: string): { client: AnalystClient; create: jest.Mock } {
  const create = jest.fn(async () => ({ content: [{ type: "text", text }] }));
  return { client: { messages: { create } }, create };
}

describe("buildReportPrompt", () => {
  it("(a) embeds every block title and its metric labels and values", () => {
    const input = makeInput();
    const { user } = buildReportPrompt(input);
    for (const block of input.blocks) {
      expect(user).toContain(block.title);
      for (const metric of block.metrics) {
        expect(user).toContain(metric.label);
        expect(user).toContain(String(metric.value));
      }
    }
    expect(user).toContain("@creator");
  });

  it("(b) system text forbids inventing data", () => {
    const { system } = buildReportPrompt(makeInput());
    expect(system).toContain("ONLY");
    expect(system).toContain("Do NOT introduce");
  });

  it("(c) is deterministic: same input yields identical strings", () => {
    const a = buildReportPrompt(makeInput());
    const b = buildReportPrompt(makeInput());
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });

  it("(d) handles empty blocks without throwing", () => {
    expect(() => buildReportPrompt(makeInput({ blocks: [] }))).not.toThrow();
    const { user } = buildReportPrompt(makeInput({ blocks: [] }));
    expect(user).toContain("no report blocks");
  });

  it("(d2) handles a block with no metrics without throwing", () => {
    const input = makeInput({
      blocks: [{ kind: "empty", title: "Empty", metrics: [] }],
    });
    expect(() => buildReportPrompt(input)).not.toThrow();
    const { user } = buildReportPrompt(input);
    expect(user).toContain("no metrics recorded");
  });
});

describe("composeReportBlocks", () => {
  it("(e) returns one narrative per block plus groundedValues from literal metric values", async () => {
    const input = makeInput();
    const text = ["First block.", "Second block.", "Third block."].join("\n===BLOCK===\n");
    const { client } = mockClient(text);
    const out = await composeReportBlocks({ input, client });

    expect(out.blocks).toHaveLength(3);
    expect(out.blocks[0]).toEqual({
      kind: "authenticity",
      title: "Authenticity",
      narrative: "First block.",
    });
    expect(out.blocks[2].narrative).toBe("Third block.");
    expect(out.groundedValues).toEqual(["82", "4.2%", "0.35", "12000", "US"]);
  });

  it("(f) calls the client with model MODELS.analyst", async () => {
    const { client, create } = mockClient("only one");
    await composeReportBlocks({ input: makeInput(), client });
    const args = create.mock.calls[0][0] as { model: string };
    expect(args.model).toBe(MODELS.analyst);
  });

  it("(g) empty blocks produce no narratives and empty groundedValues", async () => {
    const { client } = mockClient("");
    const out = await composeReportBlocks({ input: makeInput({ blocks: [] }), client });
    expect(out.blocks).toEqual([]);
    expect(out.groundedValues).toEqual([]);
  });
});

describe("validateReportGrounding", () => {
  it("(h) ok=true when narration cites only literal evidence values", () => {
    const input = makeInput();
    const verdict = validateReportGrounding(
      "Authenticity is 82 with a 4.2% fake-follower rate; cost per engagement is 0.35 on 12000 spend.",
      input,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.unsupportedNumbers).toEqual([]);
  });

  it("(i) flags an invented percentage like 47% as unsupported", () => {
    const input = makeInput();
    const verdict = validateReportGrounding(
      "The score is 82, beating 47% of comparable creators.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("47%");
  });

  it("(j) a number that appears ONLY in a block title is NOT whitelisted (anti-hallucination regression)", () => {
    const input: ReportInput = {
      subject: "@creator",
      blocks: [
        {
          kind: "leaderboard",
          title: "Top 10 creators",
          metrics: [{ label: "Average score", value: 82 }],
        },
      ],
    };
    const verdict = validateReportGrounding(
      "This creator sits in the top 10% of the cohort with a score of 82.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("10%");
  });

  it("(j2) a number appearing only in a metric label is NOT whitelisted", () => {
    const input: ReportInput = {
      subject: "@creator",
      blocks: [
        {
          kind: "reach",
          title: "Reach",
          metrics: [{ label: "Followers over 18 years old", value: 5000 }],
        },
      ],
    };
    const verdict = validateReportGrounding(
      "About 18 of the audience are minors.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("18");
  });

  it("(k) flags a multi-digit fabrication derived from the values", () => {
    const input = makeInput();
    const verdict = validateReportGrounding(
      "The campaign reached 8200 highly engaged fans.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("8200");
  });

  it("(l) empty evidence and no numbers passes", () => {
    const input = makeInput({ blocks: [] });
    expect(() => validateReportGrounding("No figures to report.", input)).not.toThrow();
    const verdict = validateReportGrounding("No figures to report.", input);
    expect(verdict.ok).toBe(true);
    expect(verdict.unsupportedNumbers).toEqual([]);
  });

  it("(m) percentage value evidence grounds the matching percentage in narration", () => {
    const input = makeInput();
    const verdict = validateReportGrounding("Fake-follower rate sits at 4.2%.", input);
    expect(verdict.ok).toBe(true);
  });
});
