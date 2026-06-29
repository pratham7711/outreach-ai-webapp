import "./messageChannelPolyfill";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";

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

import {
  CreatorVerdictCard,
  type CreatorVerdict,
} from "@/components/ai/CreatorVerdictCard";

const baseVerdict: CreatorVerdict = {
  recommendation: "strong",
  overallScore: 88,
  rationale: [
    { label: "Engagement rate", impact: 14, detail: "Top decile for tier" },
    { label: "Fake-follower ratio", impact: -6 },
  ],
  blockers: [],
};

function html(props: Parameters<typeof CreatorVerdictCard>[0]): string {
  return renderToStaticMarkup(createElement(CreatorVerdictCard, props));
}

describe("CreatorVerdictCard", () => {
  it("renders the creator name, recommendation word, and overall score", () => {
    const markup = html({ creatorName: "Mia Rivers", handle: "miarivers", verdict: baseVerdict });
    expect(markup).toContain("Mia Rivers");
    expect(markup).toContain("@miarivers");
    expect(markup).toContain(">Strong<");
    expect(markup).toContain("88");
  });

  it("renders distinct recommendation text for strong vs avoid", () => {
    const strong = html({ creatorName: "Mia Rivers", verdict: baseVerdict });
    const avoid = html({
      creatorName: "Mia Rivers",
      verdict: { ...baseVerdict, recommendation: "avoid" },
    });
    expect(strong).toContain(">Strong<");
    expect(strong).not.toContain(">Avoid<");
    expect(avoid).toContain(">Avoid<");
    expect(avoid).not.toContain(">Strong<");
    expect(strong).not.toEqual(avoid);
  });

  it("renders every rationale label", () => {
    const markup = html({ creatorName: "Mia Rivers", verdict: baseVerdict });
    expect(markup).toContain('data-testid="verdict-rationale"');
    for (const item of baseVerdict.rationale) {
      expect(markup).toContain(item.label);
    }
    expect(markup).toContain("Supports");
    expect(markup).toContain("Detracts");
  });

  it("renders the blockers panel with the blocker text when blockers are present", () => {
    const markup = html({
      creatorName: "Mia Rivers",
      verdict: {
        ...baseVerdict,
        recommendation: "avoid",
        blockers: ["Audience is 70% bots", "Brand-safety flag on recent posts"],
      },
    });
    expect(markup).toContain('data-testid="verdict-blockers"');
    expect(markup).toContain("Audience is 70% bots");
    expect(markup).toContain("Brand-safety flag on recent posts");
  });

  it("does not render the blockers panel when blockers is empty", () => {
    const markup = html({ creatorName: "Mia Rivers", verdict: baseVerdict });
    expect(markup).not.toContain('data-testid="verdict-blockers"');
    expect(markup).not.toContain(">Blockers<");
  });

  it("gives the overall score an accessible aria-label", () => {
    const markup = html({ creatorName: "Mia Rivers", verdict: baseVerdict });
    expect(markup).toContain('aria-label="Overall score 88 of 100"');
  });

  it("guards a non-finite overall score to 0", () => {
    const markup = html({
      creatorName: "Mia Rivers",
      verdict: { ...baseVerdict, overallScore: Number.NaN },
    });
    expect(markup).toContain('aria-label="Overall score 0 of 100"');
  });

  it("guards an infinite overall score and clamps out-of-range scores", () => {
    const infinite = html({
      creatorName: "Mia Rivers",
      verdict: { ...baseVerdict, overallScore: Number.POSITIVE_INFINITY },
    });
    expect(infinite).toContain('aria-label="Overall score 0 of 100"');

    const tooHigh = html({
      creatorName: "Mia Rivers",
      verdict: { ...baseVerdict, overallScore: 150 },
    });
    expect(tooHigh).toContain('aria-label="Overall score 100 of 100"');

    const negative = html({
      creatorName: "Mia Rivers",
      verdict: { ...baseVerdict, overallScore: -10 },
    });
    expect(negative).toContain('aria-label="Overall score 0 of 100"');
  });

  it("guards a non-finite rationale impact so the UI never prints NaN or Infinity", () => {
    const markup = html({
      creatorName: "Mia Rivers",
      verdict: {
        ...baseVerdict,
        rationale: [{ label: "Broken metric", impact: Number.NaN }],
      },
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("Broken metric");
  });

  it("renders the consider tier distinctly", () => {
    const consider = html({
      creatorName: "Mia Rivers",
      verdict: { ...baseVerdict, recommendation: "consider" },
    });
    expect(consider).toContain(">Consider<");
    expect(consider).not.toContain(">Strong<");
    expect(consider).not.toContain(">Avoid<");
    expect(consider).toContain('data-variant="warning"');
  });

  it("renders the handle when provided and omits it otherwise", () => {
    const withHandle = html({
      creatorName: "Mia Rivers",
      handle: "miarivers",
      verdict: baseVerdict,
    });
    expect(withHandle).toContain("@miarivers");

    const withoutHandle = html({ creatorName: "Mia Rivers", verdict: baseVerdict });
    expect(withoutHandle).toContain("Mia Rivers");
    expect(withoutHandle).not.toContain("@miarivers");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/CreatorVerdictCard.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
