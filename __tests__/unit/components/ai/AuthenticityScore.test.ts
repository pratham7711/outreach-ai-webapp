import "./messageChannelPolyfill";
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

import { AuthenticityScore, type AuthenticityFactor } from "@/components/ai/AuthenticityScore";

const factors: AuthenticityFactor[] = [
  { label: "Engagement rate", impact: 12, detail: "Within normal range for tier" },
  { label: "Follower growth", impact: -8, detail: "Unusual spike in March" },
  { label: "Comment quality", impact: 5 },
];

function html(props: Parameters<typeof AuthenticityScore>[0]): string {
  return renderToStaticMarkup(createElement(AuthenticityScore, props));
}

describe("AuthenticityScore", () => {
  it("renders the numeric score", () => {
    const markup = html({ score: 82, factors });
    expect(markup).toContain("82");
    expect(markup).toContain('aria-label="Authenticity score 82 of 100"');
  });

  it("renders every factor label", () => {
    const markup = html({ score: 70, factors });
    for (const f of factors) {
      expect(markup).toContain(f.label);
    }
  });

  it("renders optional factor detail when provided", () => {
    const markup = html({ score: 70, factors });
    expect(markup).toContain("Within normal range for tier");
    expect(markup).toContain("Unusual spike in March");
  });

  it("produces distinct tier text for a high score vs a low score", () => {
    const high = html({ score: 90, factors });
    const low = html({ score: 30, factors });
    expect(high).toContain(">Authentic<");
    expect(high).toContain('aria-label="Authenticity score 90 of 100"');
    expect(low).toContain(">Suspicious<");
    expect(low).toContain('aria-label="Authenticity score 30 of 100"');
    expect(high).not.toEqual(low);
    expect(high).not.toContain(">Suspicious<");
    expect(low).not.toContain(">Authentic<");
  });

  it("indicates impact direction without relying on color alone", () => {
    const markup = html({ score: 70, factors });
    expect(markup).toContain("Raises score");
    expect(markup).toContain("Lowers score");
  });

  it("renders the confidence when provided", () => {
    const markup = html({ score: 70, confidence: "high", factors });
    expect(markup).toContain("High confidence");
  });

  it("omits confidence when not provided", () => {
    const markup = html({ score: 70, factors });
    expect(markup).not.toContain("confidence");
  });

  it("renders an empty factors array without throwing and without the breakdown list", () => {
    let markup = "";
    expect(() => {
      markup = html({ score: 70, factors: [] });
    }).not.toThrow();
    expect(markup).toContain("70");
    expect(markup).not.toContain('data-testid="authenticity-factors"');
    expect(markup).not.toContain("Why this score");
  });

  it("omits the breakdown when compact is true", () => {
    const markup = html({ score: 70, factors, compact: true });
    expect(markup).toContain("70");
    expect(markup).not.toContain('data-testid="authenticity-factors"');
    expect(markup).not.toContain("Why this score");
    expect(markup).not.toContain("Engagement rate");
  });
});
