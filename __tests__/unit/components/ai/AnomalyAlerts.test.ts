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

import { AnomalyAlerts, type AnomalyAlert } from "@/components/ai/AnomalyAlerts";

const alerts: AnomalyAlert[] = [
  {
    type: "GEOGRAPHIC_ANOMALY",
    severity: "high",
    detail: "Top-country share shifted by 40 points",
    delta: 0.4,
  },
  {
    type: "ENGAGEMENT_DROP",
    severity: "medium",
    detail: "Engagement rate fell 55% relative to the previous snapshot",
    delta: 0.55,
  },
  {
    type: "FOLLOWER_SPIKE",
    severity: "low",
    detail: "Followers grew 60% in one step",
  },
];

function html(props: Parameters<typeof AnomalyAlerts>[0]): string {
  return renderToStaticMarkup(createElement(AnomalyAlerts, props));
}

describe("AnomalyAlerts", () => {
  it("renders each alert's human type label and detail text", () => {
    const markup = html({ alerts });
    expect(markup).toContain("Geographic anomaly");
    expect(markup).toContain("Engagement drop");
    expect(markup).toContain("Follower spike");
    expect(markup).toContain("Top-country share shifted by 40 points");
    expect(markup).toContain("Engagement rate fell 55% relative to the previous snapshot");
    expect(markup).toContain("Followers grew 60% in one step");
  });

  it("falls back to the raw type when no human label is mapped", () => {
    const markup = html({
      alerts: [{ type: "UNKNOWN_SIGNAL", severity: "medium", detail: "Something odd" }],
    });
    expect(markup).toContain("UNKNOWN_SIGNAL");
    expect(markup).toContain("Something odd");
  });

  it("orders a high-severity row before a low-severity row regardless of input order", () => {
    const markup = html({
      alerts: [
        { type: "FOLLOWER_SPIKE", severity: "low", detail: "Low row detail here" },
        { type: "GEOGRAPHIC_ANOMALY", severity: "high", detail: "High row detail here" },
      ],
    });
    expect(markup.indexOf("High row detail here")).toBeLessThan(markup.indexOf("Low row detail here"));
  });

  it("renders the severity as a text word, not color alone", () => {
    const markup = html({ alerts });
    expect(markup).toContain(">High<");
    expect(markup).toContain(">Medium<");
    expect(markup).toContain(">Low<");
  });

  it("renders a positive no-anomalies state with the default label when alerts is empty", () => {
    const markup = html({ alerts: [] });
    expect(markup).toContain('data-testid="anomaly-empty"');
    expect(markup).toContain("No anomalies detected");
  });

  it("renders the provided emptyLabel in the empty state", () => {
    const markup = html({ alerts: [], emptyLabel: "All clear since last vetting" });
    expect(markup).toContain('data-testid="anomaly-empty"');
    expect(markup).toContain("All clear since last vetting");
    expect(markup).not.toContain("No anomalies detected");
  });

  it("renders the delta when present and omits it when absent", () => {
    const markup = html({ alerts });
    expect(markup).toContain("+0.4");
    expect(markup).toContain("+0.55");
    const lowOnly = html({
      alerts: [{ type: "FOLLOWER_SPIKE", severity: "low", detail: "No delta on this one" }],
    });
    expect(lowOnly).toContain("No delta on this one");
    expect(lowOnly).not.toMatch(/\([+0-9]/);
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/AnomalyAlerts.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
