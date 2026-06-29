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
  AudienceOverlapMatrix,
  type AudienceOverlapMatrixProps,
} from "@/components/ai/AudienceOverlapMatrix";

const creators: AudienceOverlapMatrixProps["creators"] = [
  { id: "c1", label: "Mia Rivers" },
  { id: "c2", label: "Leo Park" },
  { id: "c3", label: "Ada Stone" },
];

const pairs: AudienceOverlapMatrixProps["pairs"] = [
  { a: "c1", b: "c2", overlap: 0.92 },
  { a: "c1", b: "c3", overlap: 0.31 },
];

function html(props: AudienceOverlapMatrixProps): string {
  return renderToStaticMarkup(createElement(AudienceOverlapMatrix, props));
}

describe("AudienceOverlapMatrix", () => {
  it("renders each pair's overlap as a text percentage", () => {
    const markup = html({ creators, pairs });
    expect(markup).toContain('data-testid="overlap-matrix"');
    expect(markup).toContain("92%");
    expect(markup).toContain("31%");
    const rows = markup.match(/data-testid="overlap-row"/g) ?? [];
    expect(rows).toHaveLength(2);
  });

  it("maps creator ids to labels", () => {
    const markup = html({ creators, pairs });
    expect(markup).toContain("Mia Rivers");
    expect(markup).toContain("Leo Park");
    expect(markup).toContain("Ada Stone");
  });

  it("falls back to the id when no label is known", () => {
    const markup = html({
      creators: [{ id: "c1", label: "Mia Rivers" }],
      pairs: [{ a: "c1", b: "unknown-id", overlap: 0.5 }],
    });
    expect(markup).toContain("Mia Rivers");
    expect(markup).toContain("unknown-id");
  });

  it("guards non-finite and out-of-range overlap without printing NaN or Infinity", () => {
    const markup = html({
      creators,
      pairs: [
        { a: "c1", b: "c2", overlap: Number.NaN },
        { a: "c1", b: "c3", overlap: Number.POSITIVE_INFINITY },
        { a: "c2", b: "c3", overlap: 1.7 },
        { a: "c3", b: "c1", overlap: -0.4 },
      ],
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("0%");
    expect(markup).toContain("100%");
  });

  it("renders the dedup kept and dropped lists with overlapsWith context", () => {
    const markup = html({
      creators,
      pairs,
      dedup: {
        keep: ["c1", "c3"],
        drop: [{ id: "c2", overlapsWith: "c1", overlap: 0.92 }],
      },
    });
    expect(markup).toContain('data-testid="overlap-dedup"');
    expect(markup).toContain('data-testid="overlap-kept"');
    expect(markup).toContain('data-testid="overlap-dropped"');
    expect(markup).toContain("Kept (2)");
    expect(markup).toContain("Removed as near-duplicate (1)");
    expect(markup).toContain(">Kept<");
    expect(markup).toContain(">Removed<");
    expect(markup).toContain("overlaps Mia Rivers at 92%");
  });

  it("distinguishes kept vs dropped with text and badge variants, not color alone", () => {
    const markup = html({
      creators,
      pairs,
      dedup: {
        keep: ["c1"],
        drop: [{ id: "c2", overlapsWith: "c1", overlap: 0.9 }],
      },
    });
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain(">Kept<");
    expect(markup).toContain(">Removed<");
  });

  it("does not render the dedup section when dedup is omitted", () => {
    const markup = html({ creators, pairs });
    expect(markup).not.toContain('data-testid="overlap-dedup"');
  });

  it("renders a role=status empty state when pairs is empty", () => {
    const markup = html({ creators, pairs: [] });
    expect(markup).toContain('data-testid="overlap-empty"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No audience overlap to compare");
    expect(markup).not.toContain('data-testid="overlap-matrix"');
  });

  it("honors a custom emptyLabel", () => {
    const markup = html({ creators, pairs: [], emptyLabel: "Add two creators to compare audiences" });
    expect(markup).toContain('data-testid="overlap-empty"');
    expect(markup).toContain("Add two creators to compare audiences");
    expect(markup).not.toContain("No audience overlap to compare");
  });

  it("encodes overlap intensity with a visible band word", () => {
    const markup = html({
      creators,
      pairs: [
        { a: "c1", b: "c2", overlap: 0.95 },
        { a: "c1", b: "c3", overlap: 0.1 },
      ],
    });
    expect(markup).toContain("Very high");
    expect(markup).toContain("Low");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/AudienceOverlapMatrix.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
