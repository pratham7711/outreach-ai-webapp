/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
}), { virtual: true });

import { StatusTabs } from "@/components/ds/StatusTabs";
import { Pagination } from "@/components/ds/Pagination";

const TABS = [
  { key: "ALL", label: "All", color: "#374151", count: 12 },
  { key: "PENDING", label: "Pending", color: "#D97706", count: 3 },
  { key: "COMPLETE", label: "Complete", color: "#059669" },
];

describe("StatusTabs", () => {
  it("renders every tab with tablist semantics", () => {
    render(<StatusTabs tabs={TABS} active="ALL" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Pending/ })).toBeInTheDocument();
  });

  it("marks only the active tab as selected", () => {
    render(<StatusTabs tabs={TABS} active="PENDING" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /Pending/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "false");
  });

  it("fires onChange with the tab key", () => {
    const onChange = jest.fn();
    render(<StatusTabs tabs={TABS} active="ALL" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /Complete/ }));
    expect(onChange).toHaveBeenCalledWith("COMPLETE");
  });

  it("shows count badges only for tabs with a positive count", () => {
    render(<StatusTabs tabs={TABS} active="ALL" onChange={() => {}} />);
    const badges = screen.getAllByTestId("badge");
    expect(badges.map((b) => b.textContent)).toEqual(["12", "3"]);
  });
});

describe("Pagination", () => {
  it("renders range text when total and pageSize provided", () => {
    render(<Pagination page={2} totalPages={5} total={94} pageSize={20} onPageChange={() => {}} />);
    expect(screen.getByText("Showing 21-40 of 94")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  });

  it("clamps the range end to total on the last page", () => {
    render(<Pagination page={5} totalPages={5} total={94} pageSize={20} onPageChange={() => {}} />);
    expect(screen.getByText("Showing 81-94 of 94")).toBeInTheDocument();
  });

  it("disables Prev on the first page and Next on the last", () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Previous page/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next page/ })).toBeEnabled();
    rerender(<Pagination page={3} totalPages={3} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Next page/ })).toBeDisabled();
  });

  it("disables both buttons while loading", () => {
    render(<Pagination page={2} totalPages={3} loading onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Previous page/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next page/ })).toBeDisabled();
  });

  it("fires onPageChange with the adjacent page", () => {
    const onPageChange = jest.fn();
    render(<Pagination page={2} totalPages={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Previous page/ }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: /Next page/ }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
