import {
  assembleDeck,
  deckToPlainText,
  KNOWN_SECTION_ORDER,
  type DeckBlock,
} from "@/lib/ai/reports/reportDeck";

describe("assembleDeck", () => {
  it("orders sections by explicit order[]", () => {
    const blocks: DeckBlock[] = [
      { kind: "roi", title: "ROI" },
      { kind: "overview", title: "Overview" },
      { kind: "risks", title: "Risks" },
    ];
    const deck = assembleDeck({
      title: "Q3 Report",
      blocks,
      order: ["risks", "overview", "roi"],
    });
    expect(deck.sections.map((s) => s.kind)).toEqual(["risks", "overview", "roi"]);
  });

  it("falls back to KNOWN_SECTION_ORDER when order is omitted", () => {
    const blocks: DeckBlock[] = [
      { kind: "risks", title: "Risks" },
      { kind: "audience", title: "Audience" },
      { kind: "overview", title: "Overview" },
      { kind: "authenticity", title: "Authenticity" },
    ];
    const deck = assembleDeck({ title: "Deck", blocks });
    expect(deck.sections.map((s) => s.kind)).toEqual([
      "overview",
      "authenticity",
      "audience",
      "risks",
    ]);
    expect(KNOWN_SECTION_ORDER[0]).toBe("overview");
  });

  it("places unknown kinds after known ones, preserving their original order", () => {
    const blocks: DeckBlock[] = [
      { kind: "extra-b", title: "Extra B" },
      { kind: "roi", title: "ROI" },
      { kind: "extra-a", title: "Extra A" },
      { kind: "overview", title: "Overview" },
      { kind: "extra-c", title: "Extra C" },
    ];
    const deck = assembleDeck({ title: "Deck", blocks });
    expect(deck.sections.map((s) => s.kind)).toEqual([
      "overview",
      "roi",
      "extra-b",
      "extra-a",
      "extra-c",
    ]);
  });

  it("defaults missing narrative to empty string and missing metrics to empty array", () => {
    const blocks: DeckBlock[] = [{ kind: "overview", title: "Overview" }];
    const deck = assembleDeck({ title: "Deck", blocks });
    expect(deck.sections[0].narrative).toBe("");
    expect(deck.sections[0].metrics).toEqual([]);
  });

  it("preserves provided narrative and metrics", () => {
    const blocks: DeckBlock[] = [
      {
        kind: "roi",
        title: "ROI",
        narrative: "Strong return.",
        metrics: [{ label: "ROAS", value: 3.2 }, { label: "Tier", value: "A" }],
      },
    ];
    const deck = assembleDeck({ title: "Deck", blocks });
    expect(deck.sections[0].narrative).toBe("Strong return.");
    expect(deck.sections[0].metrics).toEqual([
      { label: "ROAS", value: 3.2 },
      { label: "Tier", value: "A" },
    ]);
  });

  it("sets cover.sectionCount equal to sections.length and carries subtitle", () => {
    const blocks: DeckBlock[] = [
      { kind: "overview", title: "Overview" },
      { kind: "roi", title: "ROI" },
    ];
    const deck = assembleDeck({ title: "Deck", subtitle: "Client X", blocks });
    expect(deck.cover.sectionCount).toBe(deck.sections.length);
    expect(deck.cover.sectionCount).toBe(2);
    expect(deck.cover.subtitle).toBe("Client X");
  });

  it("does NOT mutate the input blocks array", () => {
    const blocks: DeckBlock[] = [
      { kind: "roi", title: "ROI" },
      { kind: "overview", title: "Overview" },
    ];
    const snapshot = blocks.map((b) => b.kind);
    assembleDeck({ title: "Deck", blocks, order: ["overview", "roi"] });
    expect(blocks.map((b) => b.kind)).toEqual(snapshot);
    expect(blocks.map((b) => b.kind)).toEqual(["roi", "overview"]);
  });

  it("handles empty blocks with empty sections and sectionCount 0 without throwing", () => {
    expect(() => assembleDeck({ title: "Empty", blocks: [] })).not.toThrow();
    const deck = assembleDeck({ title: "Empty", blocks: [] });
    expect(deck.sections).toEqual([]);
    expect(deck.cover.sectionCount).toBe(0);
  });
});

describe("deckToPlainText", () => {
  it("includes the title and each section title plus narrative", () => {
    const deck = assembleDeck({
      title: "Q3 Report",
      subtitle: "For Acme",
      blocks: [
        { kind: "overview", title: "Overview", narrative: "All good." },
        { kind: "roi", title: "ROI", narrative: "Strong." },
      ],
    });
    const text = deckToPlainText(deck);
    expect(text).toContain("Q3 Report");
    expect(text).toContain("For Acme");
    expect(text).toContain("Overview");
    expect(text).toContain("All good.");
    expect(text).toContain("ROI");
    expect(text).toContain("Strong.");
  });

  it("is deterministic and pure (deep-equal on repeat)", () => {
    const input = {
      title: "Deck",
      subtitle: "Sub",
      blocks: [
        { kind: "extra", title: "Extra", narrative: "x" },
        { kind: "overview", title: "Overview", metrics: [{ label: "L", value: 1 }] },
      ],
    };
    const a = assembleDeck(input);
    const b = assembleDeck(input);
    expect(a).toEqual(b);
    expect(deckToPlainText(a)).toBe(deckToPlainText(b));
  });
});
