/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  EmptyState: ({ title }: any) => <p>{title}</p>,
  Skeleton: () => <div data-testid="skeleton" />,
}), { virtual: true });
jest.mock("next/dynamic", () => () => () => null);
jest.mock("@/components/charts/lazyCharts", () => ({ loadCharts: () => Promise.resolve({}) }));

import CampaignComparison from "@/app/(dashboard)/analytics/CampaignComparison";

const campaigns = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i}`,
  title: i === 3 ? "Summer Launch" : `Campaign ${i}`,
  status: "IN_PROGRESS",
}));

beforeEach(() => {
  global.fetch = jest.fn(() => new Promise(() => {})) as any;
});

function setup() {
  render(<CampaignComparison campaigns={campaigns} range="ALL" platform="ALL" />);
  return screen.getByRole("combobox", { name: "Add a campaign to the comparison" });
}

describe("CampaignComparison picker", () => {
  it("does not render every campaign as a button up front", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Campaign 0" })).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters by what is typed and adds the highlighted option on Enter", () => {
    const input = setup();
    fireEvent.change(input, { target: { value: "summer" } });
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });

    const chosen = screen.getByRole("list", { name: "Campaigns being compared" });
    expect(within(chosen).getByText("Summer Launch")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("moves with the arrow keys and removes a chosen campaign by its own button", () => {
    const input = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-c1$/);
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Campaign 1 from the comparison" }));
    expect(screen.queryByRole("list", { name: "Campaigns being compared" })).toBeNull();
  });

  it("closes on Escape and reopens on a click in the field it never left", () => {
    const input = setup();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("stops at five and says why", () => {
    const input = setup();
    for (let i = 0; i < 6; i++) {
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "Enter" });
    }
    const chosen = screen.getByRole("list", { name: "Campaigns being compared" });
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(5);
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "5 selected. Remove one to add another.");
  });
});
