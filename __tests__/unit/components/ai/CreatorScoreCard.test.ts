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
  CreatorScoreCard,
  type CreatorScoreSection,
} from "@/components/ai/CreatorScoreCard";

const authenticity: CreatorScoreSection = {
  score: 82,
  confidence: "high",
  factors: [
    { label: "Engagement rate", impact: 12, detail: "Within normal range for tier" },
    { label: "Follower growth", impact: -8 },
  ],
};

const roi: CreatorScoreSection = {
  score: 74,
  confidence: "medium",
  factors: [{ label: "Cost per conversion", impact: 9 }],
};

const brandFit: CreatorScoreSection = {
  score: 91,
  factors: [{ label: "Audience overlap", impact: 15 }],
};

function html(props: Parameters<typeof CreatorScoreCard>[0]): string {
  return renderToStaticMarkup(createElement(CreatorScoreCard, props));
}

describe("CreatorScoreCard", () => {
  it("renders the creator name and handle", () => {
    const markup = html({ creatorName: "Mia Rivers", handle: "miarivers", authenticity });
    expect(markup).toContain("Mia Rivers");
    expect(markup).toContain("@miarivers");
  });

  it("omits the handle when not provided", () => {
    const markup = html({ creatorName: "Mia Rivers", authenticity });
    expect(markup).toContain("Mia Rivers");
    expect(markup).not.toContain("@");
  });

  it("renders the authenticity score section", () => {
    const markup = html({ creatorName: "Mia Rivers", authenticity });
    expect(markup).toContain("82");
    expect(markup).toContain('aria-label="Authenticity score 82 of 100"');
  });

  it("renders ROI and brand-fit scores when provided", () => {
    const markup = html({ creatorName: "Mia Rivers", authenticity, roi, brandFit });
    expect(markup).toContain('data-testid="creator-secondary-scores"');
    expect(markup).toContain("74");
    expect(markup).toContain("91");
    expect(markup).toContain('aria-label="ROI score 74 of 100"');
    expect(markup).toContain('aria-label="Brand fit score 91 of 100"');
    expect(markup).toContain(">ROI<");
    expect(markup).toContain(">Brand fit<");
  });

  it("does not render the secondary section when ROI and brand-fit are absent", () => {
    const markup = html({ creatorName: "Mia Rivers", authenticity });
    expect(markup).not.toContain('data-testid="creator-secondary-scores"');
    expect(markup).not.toContain(">ROI<");
    expect(markup).not.toContain(">Brand fit<");
  });

  it("renders ROI alone without a brand-fit shell when only ROI is provided", () => {
    const markup = html({ creatorName: "Mia Rivers", authenticity, roi });
    expect(markup).toContain('aria-label="ROI score 74 of 100"');
    expect(markup).not.toContain('aria-label="Brand fit score');
    expect(markup).not.toContain(">Brand fit<");
  });

  it("passes compact through to the authenticity section", () => {
    const full = html({ creatorName: "Mia Rivers", authenticity });
    const compact = html({ creatorName: "Mia Rivers", authenticity, compact: true });
    expect(full).toContain("Why this score");
    expect(compact).not.toContain("Why this score");
    expect(compact).not.toContain('data-testid="authenticity-factors"');
    expect(compact).toContain("82");
  });

  it("renders confidence labels for the secondary scores", () => {
    const markup = html({ creatorName: "Mia Rivers", authenticity, roi, brandFit });
    expect(markup).toContain("Medium confidence");
    expect(markup).not.toContain("Low confidence");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/CreatorScoreCard.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
