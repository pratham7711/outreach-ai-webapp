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

import { ReportDeckPreview, type ReportDeckPreviewProps } from "@/components/ai/ReportDeckPreview";

const baseProps: ReportDeckPreviewProps = {
  deck: {
    cover: {
      title: "Q3 Influencer Campaign Report",
      subtitle: "Prepared for Acme Records",
      sectionCount: 2,
    },
    sections: [
      {
        kind: "overview",
        title: "Campaign Overview",
        narrative: "Reach and engagement across the activation window.",
        metrics: [
          { label: "Total reach", value: 1234567 },
          { label: "Status", value: "Complete" },
        ],
      },
      {
        kind: "creators",
        title: "Top Creators",
        narrative: "Highest-performing creators in this campaign.",
        metrics: [{ label: "Creators", value: 12 }],
      },
    ],
  },
};

function html(props: ReportDeckPreviewProps): string {
  return renderToStaticMarkup(createElement(ReportDeckPreview, props));
}

describe("ReportDeckPreview", () => {
  it("renders the cover title, subtitle, and the preview-not-exported note", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Q3 Influencer Campaign Report");
    expect(markup).toContain("Prepared for Acme Records");
    expect(markup).toContain("Preview — not exported");
  });

  it("renders the full section list with titles and narratives", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Campaign Overview");
    expect(markup).toContain("Reach and engagement across the activation window.");
    expect(markup).toContain("Top Creators");
    expect(markup).toContain('data-testid="report-deck-sections"');
  });

  it("shows the ACTUAL sections length, not the blind cover.sectionCount, pluralized", () => {
    const markup = html({
      deck: {
        cover: { title: "Mismatched deck", sectionCount: 99, subtitle: undefined },
        sections: [
          {
            kind: "overview",
            title: "Only Section",
            narrative: "Single section narrative.",
            metrics: [],
          },
        ],
      },
    });
    expect(markup).toContain("1 section");
    expect(markup).not.toContain("99 sections");
  });

  it("formats a numeric metric value via en-US locale and renders a string value as-is", () => {
    const markup = html(baseProps);
    expect(markup).toContain("1,234,567");
    expect(markup).toContain("Complete");
  });

  it("falls back to 'Untitled deck' when the cover title is empty", () => {
    const markup = html({
      deck: {
        cover: { title: "", sectionCount: 0 },
        sections: baseProps.deck.sections,
      },
    });
    expect(markup).toContain("Untitled deck");
  });

  it("renders a section without a metrics list when it has no metrics, without crashing", () => {
    const markup = html({
      deck: {
        cover: { title: "No metrics deck", sectionCount: 1 },
        sections: [
          {
            kind: "summary",
            title: "Narrative Only",
            narrative: "This section has no metrics at all.",
            metrics: [],
          },
        ],
      },
    });
    expect(markup).toContain("Narrative Only");
    expect(markup).toContain("This section has no metrics at all.");
    expect(markup).not.toContain('data-testid="report-deck-metrics"');
  });

  it("renders the role=status empty state when there are no sections", () => {
    const markup = html({
      deck: { cover: { title: "Empty deck", sectionCount: 0 }, sections: [] },
    });
    expect(markup).toContain('data-testid="report-deck-empty"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("This deck has no sections yet");
    expect(markup).toContain("0 sections");
    expect(markup).not.toContain('data-testid="report-deck-sections"');
  });

  it("fail-closed: a missing or garbage deck resolves to the empty state and never throws", () => {
    const missing = html({
      deck: undefined as unknown as ReportDeckPreviewProps["deck"],
    });
    expect(missing).toContain('role="status"');
    expect(missing).toContain("This deck has no sections yet");
    expect(missing).toContain("Untitled deck");

    const garbage = html({
      deck: {} as unknown as ReportDeckPreviewProps["deck"],
    });
    expect(garbage).toContain('role="status"');
    expect(garbage).toContain("This deck has no sections yet");
  });

  it("guards non-finite numeric metric values so the UI never prints NaN or Infinity", () => {
    const markup = html({
      deck: {
        cover: { title: "Guarded deck", sectionCount: 1 },
        sections: [
          {
            kind: "overview",
            title: "Guarded Section",
            narrative: "Has bad numbers.",
            metrics: [
              { label: "Not a number metric", value: Number.NaN },
              { label: "Unbounded metric", value: Number.POSITIVE_INFINITY },
              { label: "Lower unbounded metric", value: Number.NEGATIVE_INFINITY },
            ],
          },
        ],
      },
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("—");
  });

  it("renders a dash for a metric value that is neither a finite number nor a string", () => {
    const markup = html({
      deck: {
        cover: { title: "Garbage deck", sectionCount: 1 },
        sections: [
          {
            kind: "overview",
            title: "Garbage Section",
            narrative: "Has a non-primitive value.",
            metrics: [
              { label: "Object metric", value: { nested: true } as unknown as number },
            ],
          },
        ],
      },
    });
    expect(markup).toContain("—");
    expect(markup).not.toContain("[object Object]");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/ReportDeckPreview.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
