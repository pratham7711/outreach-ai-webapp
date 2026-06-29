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

import { AudienceBreakdown, type AudienceBreakdownProps } from "@/components/ai/AudienceBreakdown";

function estimate(overrides: Partial<AudienceBreakdownProps["estimate"]> = {}): AudienceBreakdownProps["estimate"] {
  return {
    geo: [
      { key: "United States", share: 0.4 },
      { key: "United Kingdom", share: 0.25 },
      { key: "Canada", share: 0.15 },
    ],
    age: [
      { key: "18-24", share: 0.5 },
      { key: "25-34", share: 0.3 },
    ],
    interests: [
      { key: "Music", share: 0.6 },
      { key: "Fashion", share: 0.4 },
    ],
    quality: { confidence: "medium", flags: [] },
    ...overrides,
  };
}

function html(props: AudienceBreakdownProps): string {
  return renderToStaticMarkup(createElement(AudienceBreakdown, props));
}

describe("AudienceBreakdown", () => {
  it("renders each dimension's top keys with percentages", () => {
    const markup = html({ estimate: estimate() });
    expect(markup).toContain("United States");
    expect(markup).toContain("18-24");
    expect(markup).toContain("Music");
    expect(markup).toContain("40%");
    expect(markup).toContain("50%");
    expect(markup).toContain("60%");
    expect(markup).toContain('aria-label="United States 40 percent"');
  });

  it("respects topN by limiting the number of rows per section", () => {
    const geo = [
      { key: "AA", share: 0.3 },
      { key: "BB", share: 0.25 },
      { key: "CC", share: 0.2 },
      { key: "DD", share: 0.15 },
      { key: "EE", share: 0.1 },
    ];
    const markup = html({ estimate: estimate({ geo }), topN: 2 });
    expect(markup).toContain("AA");
    expect(markup).toContain("BB");
    expect(markup).not.toContain(">CC<");
    expect(markup).not.toContain(">DD<");
    expect(markup).not.toContain(">EE<");
  });

  it("defaults to five rows when topN is not provided", () => {
    const geo = [
      { key: "AA", share: 0.25 },
      { key: "BB", share: 0.2 },
      { key: "CC", share: 0.2 },
      { key: "DD", share: 0.15 },
      { key: "EE", share: 0.1 },
      { key: "FF", share: 0.1 },
    ];
    const markup = html({ estimate: estimate({ geo }) });
    expect(markup).toContain("EE");
    expect(markup).not.toContain(">FF<");
  });

  it("renders the confidence label", () => {
    const markup = html({ estimate: estimate({ quality: { confidence: "high", flags: [] } }) });
    expect(markup).toContain("High confidence");
  });

  it("renders quality-flag chips", () => {
    const markup = html({
      estimate: estimate({ quality: { confidence: "low", flags: ["LOW_SAMPLE", "GEO_CONCENTRATION"] } }),
    });
    expect(markup).toContain('data-testid="audience-flag-LOW_SAMPLE"');
    expect(markup).toContain('data-testid="audience-flag-GEO_CONCENTRATION"');
    expect(markup).toContain("Low sample size");
    expect(markup).toContain("Geographic concentration");
  });

  it("renders a no-data note for an empty distribution instead of a row", () => {
    const markup = html({ estimate: estimate({ interests: [] }) });
    expect(markup).toContain('data-testid="audience-interests-empty"');
    expect(markup).not.toContain('data-testid="audience-interests-rows"');
    expect(markup).toContain("No data");
  });

  it("guards non-finite or negative shares to a zero-width bar", () => {
    const geo = [
      { key: "BadInf", share: Number.POSITIVE_INFINITY },
      { key: "BadNan", share: Number.NaN },
      { key: "BadNeg", share: -0.5 },
    ];
    let markup = "";
    expect(() => {
      markup = html({ estimate: estimate({ geo }) });
    }).not.toThrow();
    expect(markup).toContain('aria-label="BadInf 0 percent"');
    expect(markup).toContain('aria-label="BadNan 0 percent"');
    expect(markup).toContain('aria-label="BadNeg 0 percent"');
    expect(markup).toContain("width:0%");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(process.cwd(), "components", "ai", "AudienceBreakdown.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
