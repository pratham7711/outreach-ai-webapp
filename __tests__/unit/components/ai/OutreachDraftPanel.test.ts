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

import { OutreachDraftPanel } from "@/components/ai/OutreachDraftPanel";

function html(props: Parameters<typeof OutreachDraftPanel>[0]): string {
  return renderToStaticMarkup(createElement(OutreachDraftPanel, props));
}

const baseProps: Parameters<typeof OutreachDraftPanel>[0] = {
  subject: "Collab on your spring drop",
  body: "Hi Mia,\nWe loved your latest reel.",
  groundedFacts: ["Engagement rate 4.2%", "Audience 60% US"],
  channel: "email",
};

describe("OutreachDraftPanel", () => {
  it("renders the subject and body", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Collab on your spring drop");
    expect(markup).toContain("Hi Mia,");
    expect(markup).toContain("We loved your latest reel.");
  });

  it("preserves multi-line body across separate elements", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="draft-body"');
    expect(markup).toContain("Hi Mia,");
    expect(markup).toContain("We loved your latest reel.");
    expect(markup).not.toContain("Hi Mia,\nWe loved");
  });

  it("renders a draft-only banner containing Draft and approval", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="draft-only-banner"');
    expect(markup).toContain("Draft");
    expect(markup).toContain("approval");
  });

  it("renders a send affordance labeled Requires approval that is disabled", () => {
    const markup = html(baseProps);
    expect(markup).toContain('data-testid="send-affordance"');
    expect(markup).toContain("Requires approval");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain("disabled");
  });

  it("carries no send/click handler in the source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/OutreachDraftPanel.tsx"),
      "utf8",
    );
    expect(source).not.toContain("onClick");
    expect(source).not.toContain("onSubmit");
  });

  it("shows a grounded indicator and the facts list when grounding is ok", () => {
    const markup = html({
      ...baseProps,
      grounding: { ok: true, unsupportedNumbers: [] },
    });
    expect(markup).toContain('data-testid="grounding-ok"');
    expect(markup).toContain("Grounded in 2 facts");
    expect(markup).toContain('data-testid="grounded-facts"');
    expect(markup).toContain("Engagement rate 4.2%");
    expect(markup).toContain("Audience 60% US");
    expect(markup).not.toContain('data-testid="grounding-warning"');
  });

  it("shows a grounding-warning panel listing unsupported numbers when grounding is not ok", () => {
    const markup = html({
      ...baseProps,
      grounding: { ok: false, unsupportedNumbers: ["3,000", "12%"] },
    });
    expect(markup).toContain('data-testid="grounding-warning"');
    expect(markup).toContain("unsupported claim(s)");
    expect(markup).toContain("3,000");
    expect(markup).toContain("12%");
    expect(markup).not.toContain('data-testid="grounding-ok"');
  });

  it("renders no grounding status when grounding is omitted", () => {
    const markup = html(baseProps);
    expect(markup).not.toContain('data-testid="grounding-ok"');
    expect(markup).not.toContain('data-testid="grounding-warning"');
  });

  it("handles empty groundedFacts with an accessible empty state", () => {
    const markup = html({ ...baseProps, groundedFacts: [] });
    expect(markup).toContain('data-testid="grounded-facts-empty"');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('data-testid="grounded-facts"');
  });

  it("handles an empty body with an accessible empty state", () => {
    const markup = html({ ...baseProps, body: "" });
    expect(markup).toContain('data-testid="draft-body-empty"');
    expect(markup).toContain("No draft body yet.");
    expect(markup).not.toContain('data-testid="draft-body"');
  });

  it("renders the channel label when provided and omits it otherwise", () => {
    const withChannel = html(baseProps);
    expect(withChannel).toContain("Channel: email");

    const withoutChannel = html({ ...baseProps, channel: undefined });
    expect(withoutChannel).not.toContain("Channel:");
  });

  it("never prints NaN or Infinity in the grounded count", () => {
    const markup = html({
      ...baseProps,
      groundedFacts: ["only one"],
      grounding: { ok: true, unsupportedNumbers: [] },
    });
    expect(markup).toContain("Grounded in 1 facts");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/OutreachDraftPanel.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
