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

import { DataQualityPanel, type DataQualityPanelProps } from "@/components/ai/DataQualityPanel";

const baseProps: DataQualityPanelProps = {
  result: {
    score: 82,
    confidence: "high",
    flags: ["MISSING_REQUIRED", "LOW_COMPLETENESS", "STALE"],
    usable: true,
  },
  source: "instagram-graph",
  recordLabel: "Creator @nova",
};

function html(props: DataQualityPanelProps): string {
  return renderToStaticMarkup(createElement(DataQualityPanel, props));
}

describe("DataQualityPanel", () => {
  it("renders a Usable success badge, confidence, and score on a full render", () => {
    const markup = html(baseProps);
    expect(markup).toContain(">Usable<");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain(">High confidence<");
    expect(markup).toContain("Score 82 / 100");
  });

  it("renders the optional source and recordLabel context when present", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Creator @nova");
    expect(markup).toContain("instagram-graph");
    expect(markup).toContain('data-testid="data-quality-context"');
  });

  it("omits the context block when source and recordLabel are both missing", () => {
    const markup = html({ result: baseProps.result });
    expect(markup).not.toContain('data-testid="data-quality-context"');
  });

  it("renders a Not usable danger badge when usable is false", () => {
    const markup = html({ ...baseProps, result: { ...baseProps.result, usable: false } });
    expect(markup).toContain(">Not usable<");
    expect(markup).toContain('data-variant="danger"');
    expect(markup).not.toContain(">Usable<");
  });

  it("fail-closed: anything other than strict true renders Not usable", () => {
    const truthy = html({
      ...baseProps,
      result: {
        ...baseProps.result,
        usable: 1 as unknown as DataQualityPanelProps["result"]["usable"],
      },
    });
    expect(truthy).toContain(">Not usable<");
    expect(truthy).not.toContain(">Usable<");
  });

  it("fail-closed: an unknown confidence renders Low, not Medium or High", () => {
    const markup = html({
      ...baseProps,
      result: {
        ...baseProps.result,
        confidence: "stellar" as unknown as DataQualityPanelProps["result"]["confidence"],
      },
    });
    expect(markup).toContain(">Low confidence<");
    expect(markup).not.toContain(">Medium confidence<");
    expect(markup).not.toContain(">High confidence<");
  });

  it("maps all five known flag codes to human labels", () => {
    const markup = html({
      ...baseProps,
      result: {
        ...baseProps.result,
        flags: ["EMPTY", "MISSING_REQUIRED", "LOW_COMPLETENESS", "STALE", "SUSPICIOUS_ZEROS"],
      },
    });
    expect(markup).toContain("No data found");
    expect(markup).toContain("Missing required fields");
    expect(markup).toContain("Low field completeness");
    expect(markup).toContain("Data may be stale");
    expect(markup).toContain("All metrics zero (suspicious)");
  });

  it("renders an unknown flag code as its raw code without dropping it", () => {
    const markup = html({
      ...baseProps,
      result: { ...baseProps.result, flags: ["STALE", "MYSTERY_CODE"] },
    });
    expect(markup).toContain("Data may be stale");
    expect(markup).toContain("MYSTERY_CODE");
  });

  it("preserves the given flag order", () => {
    const markup = html({
      ...baseProps,
      result: { ...baseProps.result, flags: ["SUSPICIOUS_ZEROS", "EMPTY"] },
    });
    expect(markup.indexOf("All metrics zero (suspicious)")).toBeLessThan(
      markup.indexOf("No data found"),
    );
  });

  it("renders a role=status empty state when there are no flags", () => {
    const markup = html({ ...baseProps, result: { ...baseProps.result, flags: [] } });
    expect(markup).toContain('data-testid="data-quality-clean"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No data-quality issues");
    expect(markup).not.toContain('data-testid="data-quality-flags"');
  });

  it("renders the role=status empty state when flags is missing entirely", () => {
    const markup = html({
      ...baseProps,
      result: {
        score: 70,
        confidence: "medium",
        usable: true,
      } as unknown as DataQualityPanelProps["result"],
    });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No data-quality issues");
  });

  it("guards a non-finite score so the UI prints an em-dash, never NaN or Infinity", () => {
    const nan = html({ ...baseProps, result: { ...baseProps.result, score: Number.NaN } });
    expect(nan).not.toContain("NaN");
    expect(nan).toContain("Score — / 100");

    const infinity = html({
      ...baseProps,
      result: { ...baseProps.result, score: Number.POSITIVE_INFINITY },
    });
    expect(infinity).not.toContain("Infinity");
    expect(infinity).toContain("Score — / 100");
  });

  it("clamps an out-of-range score into the 0 to 100 window", () => {
    const over = html({ ...baseProps, result: { ...baseProps.result, score: 240 } });
    expect(over).toContain("Score 100 / 100");
    const under = html({ ...baseProps, result: { ...baseProps.result, score: -12 } });
    expect(under).toContain("Score 0 / 100");
  });

  it("fail-closed: a fully missing result does not throw and shows Not usable, Low, em-dash", () => {
    const markup = renderToStaticMarkup(
      createElement(DataQualityPanel, {
        result: undefined as unknown as DataQualityPanelProps["result"],
      }),
    );
    expect(markup).toContain("Not usable");
    expect(markup).toContain("Low confidence");
    expect(markup).toContain("Score — / 100");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/DataQualityPanel.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
