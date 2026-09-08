/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

// Recharts measures a real layout box, which jsdom does not have. The point of these
// tests is the frame ChartFrame draws around it, so the container is stubbed.
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children, minWidth, minHeight }: any) => (
    <div
      data-testid="responsive-container"
      data-min-width={String(minWidth)}
      data-min-height={String(minHeight)}
    >
      {children}
    </div>
  ),
}));

// Deep paths, not the ds barrel: the barrel pulls @pratham7711/ui and every other
// primitive in with it, none of which these tests are about.
import { ChartFrame, CHART_FRAME_MIN_HEIGHT } from "@/components/ds/ChartFrame";
import { PageHeader } from "@/components/ds/PageHeader";
import { LastUpdated } from "@/components/ds/LastUpdated";

const frame = () => document.querySelector("[data-chart-frame]") as HTMLElement;

describe("ChartFrame", () => {
  it("floors its height so Recharts never measures zero", () => {
    render(<ChartFrame><div data-testid="chart" /></ChartFrame>);
    expect(frame().style.minHeight).toBe(`${CHART_FRAME_MIN_HEIGHT}px`);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("fills the parent when no height is given", () => {
    render(<ChartFrame><div /></ChartFrame>);
    expect(frame().style.height).toBe("100%");
  });

  it("uses an explicit height as both the height and the floor", () => {
    render(<ChartFrame height={320}><div /></ChartFrame>);
    expect(frame().style.height).toBe("320px");
    expect(frame().style.minHeight).toBe("320px");
  });

  it("keeps the larger of the explicit height and the requested floor", () => {
    render(<ChartFrame height={80} minHeight={200}><div /></ChartFrame>);
    expect(frame().style.minHeight).toBe("200px");
  });

  it("sets min-width:0 so a flex or grid child can shrink", () => {
    render(<ChartFrame><div /></ChartFrame>);
    expect(frame().style.minWidth).toBe("0");
  });

  it("does not let ResponsiveContainer impose its own default minimums", () => {
    render(<ChartFrame><div /></ChartFrame>);
    const rc = screen.getByTestId("responsive-container");
    expect(rc).toHaveAttribute("data-min-width", "0");
    expect(rc).toHaveAttribute("data-min-height", "0");
  });
});

describe("PageHeader", () => {
  it("renders the title as the page h1", () => {
    render(<PageHeader title="Creators" />);
    expect(screen.getByRole("heading", { level: 1, name: "Creators" })).toBeInTheDocument();
  });

  it("renders subtitle, meta and actions when given", () => {
    render(
      <PageHeader
        title="Campaigns"
        subtitle="25 of 512 campaigns"
        meta={<span data-testid="meta">chip</span>}
        actions={<button>New Campaign</button>}
      />
    );
    expect(screen.getByText("25 of 512 campaigns")).toBeInTheDocument();
    expect(screen.getByTestId("meta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Campaign" })).toBeInTheDocument();
  });

  it("omits the subtitle paragraph entirely when there is none", () => {
    const { container } = render(<PageHeader title="Clients" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("clamps a long title rather than pushing the actions off the row", () => {
    render(<PageHeader title={"A".repeat(200)} actions={<button>Go</button>} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.style.textOverflow).toBe("ellipsis");
    expect(h1.style.overflow).toBe("hidden");
  });

  it("keeps the shared .rsp-header layout class alongside any caller class", () => {
    const { container } = render(<PageHeader title="X" className="extra" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("rsp-header");
    expect(root.className).toContain("extra");
  });
});

describe("LastUpdated", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it("says what has never happened instead of claiming freshness", () => {
    render(<LastUpdated at={null} neverLabel="Never measured" />);
    expect(screen.getByText("Never measured")).toBeInTheDocument();
  });

  it("treats an unparseable timestamp as never", () => {
    render(<LastUpdated at="not-a-date" />);
    expect(screen.getByText("Never synced")).toBeInTheDocument();
  });

  it("shows a relative age with the prefix", () => {
    render(<LastUpdated at={hoursAgo(3)} prefix="Synced" />);
    expect(screen.getByText(/^Synced .*ago$/)).toBeInTheDocument();
  });

  it("stays muted inside the freshness window and turns amber past it", () => {
    // jsdom's CSS parser drops a var() colour, so the amber state is asserted through
    // the data-stale hook the component sets alongside it.
    const { container, rerender } = render(<LastUpdated at={hoursAgo(6)} />);
    const chip = () => container.firstElementChild as HTMLElement;
    expect(chip()).toHaveAttribute("data-stale", "false");
    rerender(<LastUpdated at={hoursAgo(72)} />);
    expect(chip()).toHaveAttribute("data-stale", "true");
  });

  it("honours a caller's staleness threshold", () => {
    const { container } = render(<LastUpdated at={hoursAgo(6)} staleAfterHours={2} />);
    expect(container.firstElementChild).toHaveAttribute("data-stale", "true");
  });

  it("carries the absolute timestamp in a title, and none when never", () => {
    const { container, rerender } = render(<LastUpdated at={hoursAgo(1)} />);
    expect(container.firstElementChild).toHaveAttribute("title");
    rerender(<LastUpdated at={null} />);
    expect(container.firstElementChild).not.toHaveAttribute("title");
  });
});
