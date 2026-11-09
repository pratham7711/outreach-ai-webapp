/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { breakableFigure } from "@/components/ds/BreakableFigure";
import { MetricTile } from "@/components/ds/MetricTile";

describe("breakableFigure", () => {
  it("puts a break opportunity after every digit-group comma and keeps the text", () => {
    const { container } = render(<span>{breakableFigure("1,826,153,478")}</span>);
    expect(container.textContent).toBe("1,826,153,478");
    expect(container.querySelectorAll("wbr")).toHaveLength(3);
  });

  it("leaves anything that is not a grouped number alone", () => {
    for (const text of ["—", "5.79%", "340", "Pending, maybe"]) {
      expect(breakableFigure(text)).toBe(text);
    }
  });

  it("is what MetricTile renders, so a narrow tile wraps rather than ellipsising", () => {
    const { container } = render(<MetricTile label="Budget" value="$2,400,000" />);
    expect(container.textContent).toContain("$2,400,000");
    expect(container.querySelectorAll("wbr")).toHaveLength(2);
    expect(container.querySelector(".truncate, .text-ellipsis")).toBeNull();
  });
});

describe("MetricTile counts", () => {
  it("shows a large count compact, with the exact figure as its tooltip", () => {
    const { container } = render(<MetricTile label="Total views" value="15,302,857" />);
    const fig = container.querySelector(".cc-metric-value");
    expect(fig?.textContent).toBe("15.3M");
    expect(fig?.getAttribute("title")).toBe("15,302,857");
  });
  it("leaves a count under 10,000 as it is", () => {
    const { container } = render(<MetricTile label="Posts" value="9,999" />);
    expect(container.querySelector(".cc-metric-value")?.textContent).toBe("9,999");
  });
});
