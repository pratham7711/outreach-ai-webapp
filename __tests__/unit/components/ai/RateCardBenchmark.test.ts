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
  RateCardBenchmark,
  type RateCardBenchmarkProps,
} from "@/components/ai/RateCardBenchmark";

const baseProps: RateCardBenchmarkProps = {
  rate: 1200,
  percentile: 55,
  band: "fair",
  median: 1100,
  suggestedRange: { low: 900, high: 1500 },
  currency: "$",
  factors: [
    { label: "Percentile", impact: 0.2, detail: "Rate sits mid-pack" },
    { label: "Median comparison", impact: -0.1 },
  ],
};

function html(props: RateCardBenchmarkProps): string {
  return renderToStaticMarkup(createElement(RateCardBenchmark, props));
}

describe("RateCardBenchmark", () => {
  it("renders the creator rate with the currency symbol", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Creator rate");
    expect(markup).toContain("$1,200");
  });

  it("renders the fair band word and a success badge variant", () => {
    const markup = html(baseProps);
    expect(markup).toContain(">Fair<");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain('aria-label="Rate benchmark verdict: Fair"');
  });

  it("renders distinct words for below and above bands", () => {
    const below = html({ ...baseProps, band: "below" });
    const above = html({ ...baseProps, band: "above" });
    expect(below).toContain(">Below market<");
    expect(below).toContain('data-variant="warning"');
    expect(below).not.toContain(">Above market<");
    expect(above).toContain(">Above market<");
    expect(above).toContain('data-variant="danger"');
    expect(above).not.toContain(">Below market<");
    expect(below).not.toEqual(above);
  });

  it("renders the percentile as readable ordinal text", () => {
    const markup = html({ ...baseProps, percentile: 12 });
    expect(markup).toContain("12th percentile vs peers");
    const first = html({ ...baseProps, percentile: 21 });
    expect(first).toContain("21st percentile vs peers");
  });

  it("clamps an out-of-range percentile to 100 in both text and bar width", () => {
    const markup = html({ ...baseProps, percentile: 150 });
    expect(markup).toContain("100th percentile vs peers");
    expect(markup).toContain("width:100%");
    expect(markup).toContain('aria-label="100 of 100 percentile"');
    expect(markup).not.toContain("150");
  });

  it("clamps a negative percentile to 0", () => {
    const markup = html({ ...baseProps, percentile: -30 });
    expect(markup).toContain("0th percentile vs peers");
    expect(markup).toContain("width:0%");
  });

  it("guards a non-finite rate and median so the UI never prints NaN or Infinity", () => {
    const markup = html({
      ...baseProps,
      rate: Number.NaN,
      median: Number.POSITIVE_INFINITY,
      percentile: Number.NaN,
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("Creator rate");
    expect(markup).toContain("0th percentile vs peers");
  });

  it("renders the suggested range low to high and the median", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="rate-suggested-range"');
    expect(markup).toContain("$900");
    expect(markup).toContain("$1,500");
    expect(markup).toContain('data-testid="rate-median"');
    expect(markup).toContain("$1,100");
  });

  it("normalizes an inverted suggested range so low is shown before high", () => {
    const markup = html({ ...baseProps, suggestedRange: { low: 2000, high: 800 } });
    const range = markup.split('data-testid="rate-suggested-range"')[1] ?? "";
    expect(range.indexOf("$800")).toBeLessThan(range.indexOf("$2,000"));
  });

  it("guards a missing suggested range without throwing", () => {
    const props = { ...baseProps, suggestedRange: undefined } as unknown as RateCardBenchmarkProps;
    expect(() => html(props)).not.toThrow();
    const markup = html(props);
    expect(markup).toContain('data-testid="rate-suggested-range"');
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("undefined");
  });

  it("renders the factor breakdown with label, signed impact, and detail", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="rate-factors"');
    expect(markup).toContain("Percentile");
    expect(markup).toContain("Pushes up");
    expect(markup).toContain("(+0.2)");
    expect(markup).toContain("Pushes down");
    expect(markup).toContain("(-0.1)");
    expect(markup).toContain("Rate sits mid-pack");
  });

  it("guards a non-finite factor impact so the breakdown never prints NaN", () => {
    const markup = html({
      ...baseProps,
      factors: [{ label: "Broken signal", impact: Number.NaN }],
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("Broken signal");
    expect(markup).toContain("(+0)");
  });

  it("renders an accessible empty state when no factors are provided", () => {
    const markup = html({ ...baseProps, factors: [] });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No benchmark factors available.");
    expect(markup).not.toContain('data-testid="rate-factors"');
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/RateCardBenchmark.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
