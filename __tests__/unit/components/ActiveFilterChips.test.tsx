/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({}), { virtual: true });

import { ActiveFilterChips, type FilterDef } from "@/components/ds/FilterDrawer";

const FILTERS: FilterDef[] = [
  {
    type: "multiSelect",
    key: "campaignType",
    label: "Campaign type",
    options: [
      { value: "VIEW_BASED", label: "View Based" },
      { value: "BUDGET_BASED", label: "Budget Based" },
      { value: "OPEN_COMMUNITY", label: "Open Community" },
    ],
  },
  { type: "dateRange", label: "Created", fromKey: "createdFrom", toKey: "createdTo" },
  { type: "numberRange", label: "Views", minKey: "minViews", maxKey: "maxViews" },
  {
    type: "toggleGroup",
    label: "Activity",
    options: [
      { key: "hasCreators", label: "Has creators assigned" },
      { key: "hasPosts", label: "Has posts delivered" },
    ],
  },
];

describe("ActiveFilterChips", () => {
  it("renders nothing when no filter is set", () => {
    const { container } = render(<ActiveFilterChips filters={FILTERS} values={{}} onClear={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each active filter with its option labels, not raw values", () => {
    render(
      <ActiveFilterChips
        filters={FILTERS}
        values={{ campaignType: "VIEW_BASED,BUDGET_BASED", createdFrom: "2026-10-01", minViews: "1000", hasPosts: "1" }}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("Campaign type: View Based, Budget Based")).toBeInTheDocument();
    expect(screen.getByText("Created: from 2026-10-01")).toBeInTheDocument();
    expect(screen.getByText("Views: ≥ 1000")).toBeInTheDocument();
    expect(screen.getByText("Has posts delivered")).toBeInTheDocument();
    expect(screen.queryByText("Has creators assigned")).toBeNull();
  });

  it("shortens three or more picks to the first and a count", () => {
    render(
      <ActiveFilterChips
        filters={FILTERS}
        values={{ campaignType: "VIEW_BASED,BUDGET_BASED,OPEN_COMMUNITY" }}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("Campaign type: View Based +2")).toBeInTheDocument();
  });

  it("clears every param behind one chip, and all of them from Clear all", () => {
    const onClear = jest.fn();
    render(
      <ActiveFilterChips
        filters={FILTERS}
        values={{ createdFrom: "2026-10-01", createdTo: "2026-10-31", hasPosts: "1" }}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Created: 2026-10-01 – 2026-10-31" }));
    expect(onClear).toHaveBeenLastCalledWith(["createdFrom", "createdTo"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenLastCalledWith(["createdFrom", "createdTo", "hasPosts"]);
  });

  it("offers Clear all only when there is more than one chip", () => {
    render(<ActiveFilterChips filters={FILTERS} values={{ hasPosts: "1" }} onClear={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });
});
