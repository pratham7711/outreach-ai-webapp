import {
  buildOutreachPrompt,
  draftOutreach,
  validateOutreachGrounding,
  OUTREACH_DRAFT_ONLY_NOTICE,
  type AnalystClient,
  type OutreachDraftInput,
} from "@/lib/ai/outreach/draftOutreach";
import { MODELS } from "@/lib/ai/models";

function makeInput(overrides: Partial<OutreachDraftInput> = {}): OutreachDraftInput {
  return {
    handle: "@beatsmith",
    name: "Beat Smith",
    brief: "Promote the new indie-pop single across short-form video.",
    evidence: [
      { label: "Follower count", value: 8200 },
      { label: "Engagement rate", value: "4.20%" },
      { label: "Niche", value: "indie pop" },
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

describe("buildOutreachPrompt", () => {
  it("(a) embeds the handle, brief and every evidence value", () => {
    const input = makeInput();
    const { user } = buildOutreachPrompt(input);
    expect(user).toContain("@beatsmith");
    expect(user).toContain("Promote the new indie-pop single");
    expect(user).toContain("8200");
    expect(user).toContain("4.20%");
    expect(user).toContain("indie pop");
    for (const item of input.evidence) {
      expect(user).toContain(item.label);
    }
  });

  it("(b) system text forbids inventing data and asserts draft-only contract", () => {
    const { system } = buildOutreachPrompt(makeInput());
    expect(system).toContain("ONLY");
    expect(system).toContain("Do NOT introduce");
    expect(system).toContain("Do NOT invent");
    expect(system).toContain("NEVER");
    expect(system).toContain("NEVER send");
    expect(system).toContain("does NOT send");
  });

  it("(c) is deterministic: same input yields identical strings", () => {
    const a = buildOutreachPrompt(makeInput());
    const b = buildOutreachPrompt(makeInput());
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });

  it("(d) handles empty evidence without throwing", () => {
    expect(() => buildOutreachPrompt(makeInput({ evidence: [] }))).not.toThrow();
    const { user } = buildOutreachPrompt(makeInput({ evidence: [] }));
    expect(user).toContain("no evidence facts were supplied");
  });

  it("(d2) embeds the draft-only notice in the user prompt", () => {
    const { user } = buildOutreachPrompt(makeInput());
    expect(user).toContain(OUTREACH_DRAFT_ONLY_NOTICE);
  });

  it("(d3) strips an attacker-supplied orgId from untrusted input", () => {
    const malicious = { ...makeInput(), orgId: "victim-org" } as unknown as OutreachDraftInput;
    const { user, system } = buildOutreachPrompt(malicious);
    expect(user).not.toContain("victim-org");
    expect(system).not.toContain("victim-org");
  });
});

describe("draftOutreach", () => {
  it("(e) returns subject, body and groundedFacts equal to the evidence labels", async () => {
    const input = makeInput();
    const { client } = mockClient("Let's collaborate, Beat Smith\nLoved your indie pop work.");
    const out = await draftOutreach({ input, client });
    expect(out.subject).toBe("Let's collaborate, Beat Smith");
    expect(out.body).toBe("Loved your indie pop work.");
    expect(out.groundedFacts).toEqual(["Follower count", "Engagement rate", "Niche"]);
  });

  it("(f) calls the client with model MODELS.analyst", async () => {
    const { client, create } = mockClient("Subject\nBody");
    await draftOutreach({ input: makeInput(), client });
    const args = create.mock.calls[0][0] as { model: string };
    expect(args.model).toBe(MODELS.analyst);
  });

  it("(g) empty evidence produces an empty groundedFacts list without throwing", async () => {
    const { client } = mockClient("Hello there\nQuick note about the campaign.");
    const out = await draftOutreach({ input: makeInput({ evidence: [] }), client });
    expect(out.groundedFacts).toEqual([]);
    expect(out.subject).toBe("Hello there");
  });

  it("(g2) a single-line draft yields an empty body and the line as subject", async () => {
    const { client } = mockClient("Just a subject");
    const out = await draftOutreach({ input: makeInput(), client });
    expect(out.subject).toBe("Just a subject");
    expect(out.body).toBe("");
  });
});

describe("validateOutreachGrounding", () => {
  it("(h) ok=true when the draft cites only evidence numbers", () => {
    const input = makeInput();
    const verdict = validateOutreachGrounding(
      "With 8200 followers and a 4.20% engagement rate you are a great fit.",
      input,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.unsupportedNumbers).toEqual([]);
  });

  it("(i) flags an invented percentage like 47% as unsupported", () => {
    const input = makeInput();
    const verdict = validateOutreachGrounding(
      "Your 8200 followers convert at 47% which beats everyone.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("47%");
  });

  it("(j) flags a fabricated multi-digit fan count when evidence says 8200", () => {
    const input = makeInput();
    const verdict = validateOutreachGrounding(
      "You have 10000 loyal fans ready to buy.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("10000");
  });

  it("(k) passes empty-evidence text that contains no numbers", () => {
    const input = makeInput({ evidence: [] });
    const verdict = validateOutreachGrounding(
      "Hi there, we love your content and would love to work together.",
      input,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.unsupportedNumbers).toEqual([]);
  });

  it("(l) flags a number even when written with a thousands separator", () => {
    const input = makeInput();
    const verdict = validateOutreachGrounding("You reach over 1,000,000 people.", input);
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("1,000,000");
  });

  it("(m) ignores an attacker orgId in the input when validating", () => {
    const input = { ...makeInput(), orgId: "victim-org" } as unknown as OutreachDraftInput;
    const verdict = validateOutreachGrounding(
      "With 8200 followers at 4.20% engagement, let's talk.",
      input,
    );
    expect(verdict.ok).toBe(true);
  });

  it("(n) flags a number found only in an evidence label, never whitelisting label prose", () => {
    const input = makeInput({
      evidence: [{ label: "Top 10 reasons to collab", value: "great vibes" }],
    });
    const verdict = validateOutreachGrounding(
      "You convert at a stunning 10% rate.",
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupportedNumbers).toContain("10%");
  });
});
