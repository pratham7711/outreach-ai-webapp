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

import { UsageMeterCard, type UsageMeterCardProps } from "@/components/ai/UsageMeterCard";

const baseProps: UsageMeterCardProps = {
  usage: {
    totalTokens: 12000,
    totalCostUsd: 3.5,
    runs: 42,
    byTool: {
      "creator-verdict": { tokens: 8000, costUsd: 2.1, runs: 25 },
      "rate-benchmark": { tokens: 4000, costUsd: 1.4, runs: 17 },
    },
  },
  limits: { maxTokens: 24000, maxCostUsd: 10, maxRuns: 100 },
  entitlement: { allowed: true, exceeded: [], remaining: { tokens: 12000, costUsd: 6.5, runs: 58 } },
  currency: "$",
};

function html(props: UsageMeterCardProps): string {
  return renderToStaticMarkup(createElement(UsageMeterCard, props));
}

describe("UsageMeterCard", () => {
  it("renders the three metric rows with their values", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Tokens");
    expect(markup).toContain("Cost");
    expect(markup).toContain("Runs");
    expect(markup).toContain('data-testid="usage-metric-tokens"');
    expect(markup).toContain('data-testid="usage-metric-cost"');
    expect(markup).toContain('data-testid="usage-metric-runs"');
    expect(markup).toContain("12,000");
    expect(markup).toContain("42");
  });

  it("formats the cost with the currency symbol", () => {
    const markup = html(baseProps);
    expect(markup).toContain("$3.50");
    const euro = html({ ...baseProps, currency: "€" });
    expect(euro).toContain("€3.50");
  });

  it("renders used / limit text and a clamped bar width when a limit is provided", () => {
    const markup = html(baseProps);
    expect(markup).toContain("12,000 / 24,000");
    expect(markup).toContain('data-testid="usage-metric-tokens-bar"');
    expect(markup).toContain("width:50%");
    expect(markup).toContain('aria-label="Tokens 12,000 of 24,000"');
  });

  it("clamps the bar width to 100% when usage exceeds the limit", () => {
    const markup = html({
      ...baseProps,
      usage: { ...baseProps.usage, totalTokens: 50000 },
      entitlement: undefined,
    });
    expect(markup).toContain("50,000 / 24,000");
    expect(markup).toContain("width:100%");
  });

  it("shows a within-limits indicator when entitlement is allowed", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="usage-within-limits"');
    expect(markup).toContain("Within limits");
    expect(markup).toContain('data-variant="success"');
    expect(markup).not.toContain('data-testid="usage-blocked"');
  });

  it("shows a blocked panel listing exceeded dimensions as text when not allowed", () => {
    const markup = html({
      ...baseProps,
      entitlement: {
        allowed: false,
        exceeded: ["tokens", "cost"],
        remaining: { tokens: 0, costUsd: 0, runs: 12 },
      },
    });
    expect(markup).toContain('data-testid="usage-blocked"');
    expect(markup).toContain("Over limit: tokens, cost");
    expect(markup).toContain('data-variant="danger"');
    expect(markup).not.toContain('data-testid="usage-within-limits"');
  });

  it("tags an exceeded dimension row with a visible Over limit text tag", () => {
    const markup = html({
      ...baseProps,
      entitlement: {
        allowed: false,
        exceeded: ["tokens"],
        remaining: { tokens: 0, costUsd: 6.5, runs: 58 },
      },
    });
    expect(markup).toContain('data-testid="usage-metric-tokens-overlimit"');
    expect(markup).toContain("Over limit");
    expect(markup).not.toContain('data-testid="usage-metric-runs-overlimit"');
  });

  it("renders the byTool breakdown rows", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="usage-by-tool"');
    expect(markup).toContain("creator-verdict");
    expect(markup).toContain("rate-benchmark");
    expect(markup).toContain("8,000 tokens");
    expect(markup).toContain("25 runs");
    expect(markup).toContain('data-testid="usage-tool-row"');
  });

  it("renders an accessible empty state when byTool has no keys", () => {
    const markup = html({
      ...baseProps,
      usage: { ...baseProps.usage, byTool: {} },
    });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-testid="usage-empty"');
    expect(markup).toContain("No tool usage recorded.");
    expect(markup).not.toContain('data-testid="usage-by-tool"');
  });

  it("guards divide-by-zero limits so the bar is 0% and the UI does not crash", () => {
    const markup = html({
      ...baseProps,
      limits: { maxTokens: 0, maxCostUsd: 0, maxRuns: 0 },
      entitlement: undefined,
    });
    expect(markup).toContain("width:0%");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("guards non-finite usage and limit values so the UI never prints NaN or Infinity", () => {
    const markup = html({
      usage: {
        totalTokens: Number.NaN,
        totalCostUsd: Number.POSITIVE_INFINITY,
        runs: Number.NaN,
        byTool: {
          broken: {
            tokens: Number.NaN,
            costUsd: Number.POSITIVE_INFINITY,
            runs: Number.NEGATIVE_INFINITY,
          },
        },
      },
      limits: { maxTokens: Number.NaN, maxCostUsd: Number.POSITIVE_INFINITY },
      currency: "$",
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("Tokens");
    expect(markup).toContain("broken");
  });

  it("renders without limits or entitlement and shows no bars", () => {
    const markup = html({
      usage: baseProps.usage,
      currency: "$",
    });
    expect(markup).toContain("Tokens");
    expect(markup).toContain("12,000");
    expect(markup).not.toContain('data-testid="usage-metric-tokens-bar"');
    expect(markup).not.toContain('data-testid="usage-within-limits"');
    expect(markup).not.toContain('data-testid="usage-blocked"');
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/UsageMeterCard.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
