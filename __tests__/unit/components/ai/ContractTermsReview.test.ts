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
  ContractTermsReview,
  type ContractTermsReviewProps,
} from "@/components/ai/ContractTermsReview";

const DAY = 86_400_000;

const baseProps: ContractTermsReviewProps = {
  terms: {
    deliverables: [
      { kind: "Instagram Reel", quantity: 2 },
      { kind: "Story", quantity: 3 },
    ],
    rateUsd: 1500,
    schedule: { startEpochMs: 0, endEpochMs: 30 * DAY },
    usageRights: "30-day paid usage",
    exclusivityDays: 14,
  },
  validation: { valid: true, issues: [] },
  summary: "Two reels and three stories over a month.",
  currency: "$",
};

function html(props: ContractTermsReviewProps): string {
  return renderToStaticMarkup(createElement(ContractTermsReview, props));
}

describe("ContractTermsReview", () => {
  it("renders deliverables and the currency-formatted rate", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="contract-deliverables"');
    expect(markup).toContain("Instagram Reel");
    expect(markup).toContain("Story");
    expect(markup).toContain("× 2");
    expect(markup).toContain("× 3");
    expect(markup).toContain("$1,500.00");
    expect(markup).toContain("30 days");
    expect(markup).toContain("30-day paid usage");
    expect(markup).toContain("14 days");
  });

  it("shows a Valid success badge when validation passes", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="contract-verdict"');
    expect(markup).toContain("Valid");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain('aria-label="Validation verdict: Valid"');
    expect(markup).not.toContain('data-testid="contract-cannot-proceed"');
  });

  it("shows a Not valid danger badge and a Cannot proceed line when invalid", () => {
    const markup = html({
      ...baseProps,
      validation: {
        valid: false,
        issues: [
          {
            code: "INVALID_RATE",
            severity: "error",
            detail: "rateUsd must be a finite number greater than zero.",
          },
        ],
      },
    });
    expect(markup).toContain("Not valid");
    expect(markup).toContain('data-variant="danger"');
    expect(markup).toContain('aria-label="Validation verdict: Not valid"');
    expect(markup).toContain('data-testid="contract-cannot-proceed"');
    expect(markup).toContain("Cannot proceed — resolve errors");
  });

  it("orders issues with errors before warnings", () => {
    const markup = html({
      ...baseProps,
      validation: {
        valid: false,
        issues: [
          { code: "MISSING_USAGE_RIGHTS", severity: "warning", detail: "No usage rights." },
          { code: "INVALID_RATE", severity: "error", detail: "Rate must be positive." },
        ],
      },
    });
    const errorIndex = markup.indexOf("Rate must be greater than zero");
    const warningIndex = markup.indexOf("Usage rights not specified");
    expect(errorIndex).toBeGreaterThan(-1);
    expect(warningIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeLessThan(warningIndex);
  });

  it("renders the severity word as visible text and an aria-label", () => {
    const markup = html({
      ...baseProps,
      validation: {
        valid: false,
        issues: [
          { code: "INVALID_RATE", severity: "error", detail: "Rate must be positive." },
          { code: "MISSING_USAGE_RIGHTS", severity: "warning", detail: "No usage rights." },
        ],
      },
    });
    expect(markup).toContain(">Error<");
    expect(markup).toContain(">Warning<");
    expect(markup).toContain('aria-label="Error severity"');
    expect(markup).toContain('aria-label="Warning severity"');
  });

  it("shows an accessible issues-clean status state when there are no issues", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="issues-clean"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="No validation issues"');
    expect(markup).not.toContain('data-testid="contract-issue-row"');
  });

  it("renders an unsigned banner and no sign/send actionable control", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="contract-unsigned-banner"');
    expect(markup).toContain("Not signed");
    expect(markup).toContain("requires approval");
    expect(markup).not.toContain("<button");
    expect(markup).not.toMatch(/<(button|a|input)[^>]*>(?:[^<]*)(sign|send)/i);
    expect(markup).not.toMatch(/type="submit"/i);
  });

  it("guards non-finite rate and schedule so it never renders NaN or Infinity", () => {
    const markup = html({
      terms: {
        deliverables: [{ kind: "Reel", quantity: Number.NaN }],
        rateUsd: Number.POSITIVE_INFINITY,
        schedule: { startEpochMs: Number.NaN, endEpochMs: Number.NEGATIVE_INFINITY },
        usageRights: undefined,
        exclusivityDays: Number.NaN,
      },
      validation: { valid: false, issues: [] },
      currency: "$",
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("Not specified");
    expect(markup).toContain("0 days");
  });

  it("guards a backwards schedule window to 0 days", () => {
    const markup = html({
      ...baseProps,
      terms: {
        ...baseProps.terms,
        schedule: { startEpochMs: 40 * DAY, endEpochMs: 10 * DAY },
      },
    });
    expect(markup).toContain("0 days");
    expect(markup).not.toMatch(/-\d+\s*days/);
    expect(markup).not.toContain("NaN");
  });

  it("falls back to Not specified usage rights and respects a custom currency", () => {
    const markup = html({
      ...baseProps,
      terms: { ...baseProps.terms, usageRights: "   " },
      currency: "€",
    });
    expect(markup).toContain("Not specified");
    expect(markup).toContain("€1,500.00");
  });

  it("maps every real validator code to a human label and never renders a raw code", () => {
    const realCodes = [
      "NO_DELIVERABLES",
      "INVALID_RATE",
      "INVALID_SCHEDULE",
      "NEGATIVE_EXCLUSIVITY",
      "VERY_LONG_EXCLUSIVITY",
      "MISSING_USAGE_RIGHTS",
    ] as const;
    const markup = html({
      ...baseProps,
      validation: {
        valid: false,
        issues: realCodes.map((code) => ({
          code,
          severity: code === "VERY_LONG_EXCLUSIVITY" || code === "MISSING_USAGE_RIGHTS"
            ? ("warning" as const)
            : ("error" as const),
          detail: `detail for ${code}`,
        })),
      },
    });
    expect(markup).toContain("No deliverable with a positive quantity");
    expect(markup).toContain("Rate must be greater than zero");
    expect(markup).toContain("Invalid schedule window");
    expect(markup).toContain("Exclusivity period is negative");
    expect(markup).toContain("Exclusivity period is unusually long");
    expect(markup).toContain("Usage rights not specified");
    for (const code of realCodes) {
      expect(markup).not.toContain(`>${code}<`);
    }
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/ContractTermsReview.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
