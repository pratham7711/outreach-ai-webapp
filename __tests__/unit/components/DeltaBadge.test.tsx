/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import type { CSSProperties, ReactElement } from "react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Card: ({ children }: any) => <div>{children}</div>,
    EmptyState: ({ title }: any) => <div>{title}</div>,
    Skeleton: () => <div />,
  }),
  { virtual: true }
);

jest.mock("@/components/charts/lazyCharts", () => ({
  loadCharts: () => Promise.resolve({ CampaignComparisonLine: () => <div /> }),
}));

import { DeltaBadge } from "@/app/(dashboard)/analytics/CampaignComparison";

/**
 * The badge used to build its tint as `color + "16"` -- appending a hex alpha
 * pair to whatever `color` held. That is a colour only when `color` is a hex
 * literal. The positive branch held a CSS variable, so it produced
 * "var(--cc-success)16", which a browser drops: a campaign beating the org
 * average rendered its text on no background at all, while one below it got a
 * tint. Both branches are tokens now and the tint comes from color-mix.
 *
 * Asserted on the element's own style prop rather than on the rendered node,
 * because jsdom's CSS parser understands neither var() nor color-mix() and
 * silently drops both declarations -- so a DOM read here reports an empty
 * style for the fix and for the bug alike.
 */
describe("DeltaBadge", () => {
  const styleFor = (pct: number): CSSProperties =>
    (DeltaBadge({ pct }) as ReactElement<{ style: CSSProperties }>).props.style;

  it.each([
    ["above the org average", 12],
    ["below the org average", -12],
  ])("tints a delta %s with a colour a browser can parse", (_label, pct) => {
    const { background } = styleFor(pct);
    expect(background).toMatch(/^color-mix\(in srgb, var\(--cc-\w+\) \d+%, transparent\)$/);
  });

  it("uses the success token above the average and the danger token below it", () => {
    expect(styleFor(12).color).toBe("var(--cc-success)");
    expect(styleFor(-12).color).toBe("var(--cc-danger)");
  });

  it("hardcodes no hex colour on either branch", () => {
    for (const pct of [12, -12]) {
      const { color, background } = styleFor(pct);
      expect(`${color} ${background}`).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("shows a dash rather than a 0% delta when there is nothing to compare against", () => {
    render(<DeltaBadge pct={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
