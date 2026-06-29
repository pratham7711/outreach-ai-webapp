import "./messageChannelPolyfill";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

jest.mock(
  "@pratham7711/ui",
  () => {
    const { createElement: h } = require("react");
    return {
      Card: ({ children, variant, clickable, noPadding, ...rest }: Record<string, unknown>) =>
        h("div", { "data-testid": "card", ...rest }, children as never),
      Badge: ({ children, variant, size, outlined, dot, ...rest }: Record<string, unknown>) =>
        h("span", { "data-testid": "badge", "data-variant": variant, ...rest }, children as never),
    };
  },
  { virtual: true },
);

import { DiscoveryResults, type DiscoveryResultItem } from "@/components/ai/DiscoveryResults";

const results: DiscoveryResultItem[] = [
  {
    id: "creator-1",
    name: "Aria Nightingale",
    score: 92,
    components: { dense: 0.8, sparse: 0.6 },
    matchedFilters: ["pop", "verified"],
    explanation: "Strong genre and audience overlap",
  },
  {
    id: "creator-2",
    score: 41,
    components: { dense: 0.3, sparse: 0.2 },
    matchedFilters: ["indie"],
    explanation: "Partial genre match only",
  },
];

function html(props: Parameters<typeof DiscoveryResults>[0]): string {
  return renderToStaticMarkup(createElement(DiscoveryResults, props));
}

describe("DiscoveryResults", () => {
  it("renders each result's name (or id fallback), score and explanation", () => {
    const markup = html({ results });
    expect(markup).toContain("Aria Nightingale");
    expect(markup).toContain("creator-2");
    expect(markup).toContain("92");
    expect(markup).toContain("41");
    expect(markup).toContain("Strong genre and audience overlap");
    expect(markup).toContain("Partial genre match only");
  });

  it("preserves the given order so rank 1 appears before rank 2", () => {
    const markup = html({ results });
    expect(markup).toContain('aria-label="Rank 1"');
    expect(markup).toContain('aria-label="Rank 2"');
    expect(markup.indexOf("Aria Nightingale")).toBeLessThan(markup.indexOf("creator-2"));
    expect(markup.indexOf('aria-label="Rank 1"')).toBeLessThan(markup.indexOf('aria-label="Rank 2"'));
  });

  it("renders matched-filter chips", () => {
    const markup = html({ results });
    expect(markup).toContain('data-testid="discovery-filters"');
    expect(markup).toContain("pop");
    expect(markup).toContain("verified");
    expect(markup).toContain("indie");
  });

  it("gives each score chip an aria-label of N of 100", () => {
    const markup = html({ results });
    expect(markup).toContain('aria-label="Match score 92 of 100"');
    expect(markup).toContain('aria-label="Match score 41 of 100"');
  });

  it("renders the empty state with the label when there are no results", () => {
    const markup = html({ results: [], emptyLabel: "Nothing turned up" });
    expect(markup).toContain('data-testid="discovery-empty"');
    expect(markup).toContain("Nothing turned up");
    expect(markup).not.toContain('data-testid="discovery-results"');
  });

  it("falls back to the default empty label", () => {
    const markup = html({ results: [] });
    expect(markup).toContain("No matching creators");
  });

  it("produces distinct tier markup for a high-score vs a low-score chip", () => {
    const high = html({ results: [{ id: "h", name: "High", score: 95 }] });
    const low = html({ results: [{ id: "l", name: "Low", score: 22 }] });
    expect(high).toContain(">Strong match<");
    expect(high).toContain('aria-label="Match score 95 of 100"');
    expect(low).toContain(">Weak match<");
    expect(low).toContain('aria-label="Match score 22 of 100"');
    expect(high).not.toContain(">Weak match<");
    expect(low).not.toContain(">Strong match<");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "components", "ai", "DiscoveryResults.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
