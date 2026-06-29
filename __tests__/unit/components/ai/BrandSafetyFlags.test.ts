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

import { BrandSafetyFlags, type BrandSafetyFlagsProps } from "@/components/ai/BrandSafetyFlags";

const baseProps: BrandSafetyFlagsProps = {
  safe: true,
  riskLevel: "low",
  score: 88,
  flags: [
    { code: "PROFANITY", severity: "low", detail: "Occasional mild language" },
    { code: "RESTRICTED_CATEGORY", severity: "high", detail: "Promotes gambling" },
    { code: "COMPETITOR_MENTION", severity: "medium", detail: "Mentions a rival brand" },
  ],
};

function html(props: BrandSafetyFlagsProps): string {
  return renderToStaticMarkup(createElement(BrandSafetyFlags, props));
}

describe("BrandSafetyFlags", () => {
  it("renders a Brand-safe success badge and the safety score text when safe", () => {
    const markup = html(baseProps);
    expect(markup).toContain(">Brand-safe<");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain("Safety score 88 / 100");
  });

  it("renders a Not brand-safe danger badge when not safe", () => {
    const markup = html({ ...baseProps, safe: false });
    expect(markup).toContain(">Not brand-safe<");
    expect(markup).toContain('data-variant="danger"');
    expect(markup).not.toContain(">Brand-safe<");
  });

  it("renders the risk level as a readable text word with an aria-label on the verdict", () => {
    const low = html(baseProps);
    expect(low).toContain(">Low risk<");
    expect(low).toContain('aria-label="Brand-safe, Low risk, Safety score 88 / 100"');

    const medium = html({ ...baseProps, riskLevel: "medium" });
    expect(medium).toContain(">Medium risk<");

    const high = html({ ...baseProps, safe: false, riskLevel: "high" });
    expect(high).toContain(">High risk<");
  });

  it("fail-closed: an unknown risk level falls back to High risk, not Medium", () => {
    const markup = html({
      ...baseProps,
      riskLevel: "catastrophic" as unknown as BrandSafetyFlagsProps["riskLevel"],
    });
    expect(markup).toContain(">High risk<");
    expect(markup).not.toContain(">Medium risk<");
  });

  it("orders flags high severity before low severity in the markup", () => {
    const markup = html(baseProps);
    const highIndex = markup.indexOf("Restricted category");
    const mediumIndex = markup.indexOf("Competitor mention");
    const lowIndex = markup.indexOf("Occasional mild language");
    expect(highIndex).toBeGreaterThan(-1);
    expect(highIndex).toBeLessThan(mediumIndex);
    expect(mediumIndex).toBeLessThan(lowIndex);
  });

  it("keeps a stable original-index order when severities tie", () => {
    const markup = html({
      ...baseProps,
      flags: [
        { code: "ADULT_CONTENT", severity: "high", detail: "First high" },
        { code: "VIOLENCE", severity: "high", detail: "Second high" },
      ],
    });
    expect(markup.indexOf("First high")).toBeLessThan(markup.indexOf("Second high"));
  });

  it("renders each severity as a text word with a severity aria-label", () => {
    const markup = html(baseProps);
    expect(markup).toContain(">High<");
    expect(markup).toContain(">Medium<");
    expect(markup).toContain(">Low<");
    expect(markup).toContain('aria-label="High severity"');
    expect(markup).toContain('aria-label="Medium severity"');
    expect(markup).toContain('aria-label="Low severity"');
  });

  it("maps a known code to a human label and falls back to the raw code", () => {
    const markup = html({
      ...baseProps,
      flags: [
        { code: "RESTRICTED_CATEGORY", severity: "high", detail: "Mapped" },
        { code: "UNKNOWN_RAW_CODE", severity: "low", detail: "Unmapped" },
      ],
    });
    expect(markup).toContain("Restricted category");
    expect(markup).toContain("UNKNOWN_RAW_CODE");
  });

  it("renders the default clean role=status empty state when there are no flags", () => {
    const markup = html({ ...baseProps, flags: [] });
    expect(markup).toContain('data-testid="brand-safety-clean"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No brand-safety flags");
    expect(markup).not.toContain('data-testid="brand-safety-flags"');
  });

  it("renders a custom emptyLabel in the clean empty state", () => {
    const markup = html({ ...baseProps, flags: [], emptyLabel: "All clear for this brand" });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("All clear for this brand");
    expect(markup).not.toContain("No brand-safety flags");
  });

  it("guards a non-finite score so the UI never prints NaN or Infinity", () => {
    const nan = html({ ...baseProps, score: Number.NaN });
    expect(nan).not.toContain("NaN");
    expect(nan).toContain("Safety score 0 / 100");

    const infinity = html({ ...baseProps, score: Number.POSITIVE_INFINITY });
    expect(infinity).not.toContain("Infinity");
    expect(infinity).toContain("Safety score 0 / 100");
  });

  it("clamps an out-of-range score into the 0 to 100 window", () => {
    const over = html({ ...baseProps, score: 150 });
    expect(over).toContain("Safety score 100 / 100");
    const under = html({ ...baseProps, score: -20 });
    expect(under).toContain("Safety score 0 / 100");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/BrandSafetyFlags.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
