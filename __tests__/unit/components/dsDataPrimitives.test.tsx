/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
}));

import { DataTable, type DataTableColumn } from "@/components/ds/DataTable";
import { Pagination, pageItems } from "@/components/ds/Pagination";
import { NoResults } from "@/components/ds/NoResults";

type Row = { id: string; name: string; views: number };

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "views", header: "Views", align: "right", width: 120, render: (r) => r.views.toLocaleString("en-US") },
];

const ROWS: Row[] = [
  { id: "a", name: "Alpha", views: 1200 },
  { id: "b", name: "Beta", views: 30 },
];

beforeEach(() => mockPush.mockClear());

describe("DataTable", () => {
  it("keeps the headers and draws the empty state in a row under them", () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty={<p>Nothing here</p>} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Views" })).toBeInTheDocument();
    const cell = within(table).getByText("Nothing here").closest("td");
    expect(cell).toHaveAttribute("colspan", "2");
    expect(cell?.closest("tbody")).not.toBeNull();
  });

  it("falls back to NoResults when no empty state is given", () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("right-aligns a numeric column in both the header and the cells", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByRole("columnheader", { name: "Views" })).toHaveAttribute("data-align", "right");
    expect(screen.getByText("1,200").closest("td")).toHaveAttribute("data-align", "right");
    expect(screen.getByText("Alpha").closest("td")).not.toHaveAttribute("data-align");
  });

  it("gives each column its width through a colgroup", () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const cols = container.querySelectorAll("colgroup > col");
    expect(cols).toHaveLength(2);
    expect((cols[1] as HTMLElement).style.width).toBe("120px");
  });

  it("with rowHref, links the primary cell and opens the row on click", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowHref={(r) => `/things/${r.id}`} />);
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/things/a");
    fireEvent.click(screen.getByText("30"));
    expect(mockPush).toHaveBeenCalledWith("/things/b");
  });

  it("without rowHref, rows are not links and clicks go nowhere", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByText("Alpha"));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Alpha").closest("tr")).not.toHaveAttribute("data-href");
  });

  it("leaves a click on a control inside the row to that control", () => {
    const withButton: DataTableColumn<Row>[] = [
      ...COLUMNS,
      { key: "act", header: "Actions", hideHeader: true, render: () => <button type="button">Menu</button> },
    ];
    render(<DataTable columns={withButton} rows={ROWS} rowKey={(r) => r.id} rowHref={(r) => `/things/${r.id}`} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Menu" })[0]);
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });

  it("draws skeleton rows while the first page loads, and no empty state", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading skeletonRows={3} empty={<p>Nothing here</p>} />,
    );
    expect(container.querySelectorAll("tbody tr.cc-dt-skeleton-row")).toHaveLength(3);
    expect(screen.queryByText("Nothing here")).toBeNull();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });
});

describe("Pagination", () => {
  it("says which rows are shown, grouped, with an en dash", () => {
    render(<Pagination page={2} totalPages={125} total={3118} pageSize={25} onPageChange={() => {}} />);
    expect(screen.getByText("26–50 of 3,118")).toBeInTheDocument();
  });

  it("with one page, keeps the count and draws no controls", () => {
    render(<Pagination page={1} totalPages={1} total={8} pageSize={25} onPageChange={() => {}} />);
    expect(screen.getByText("1–8 of 8")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing at all with no rows and one page", () => {
    const { container } = render(<Pagination page={1} totalPages={1} total={0} pageSize={25} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("jumps to a page number and marks the current one", () => {
    const onPageChange = jest.fn();
    render(<Pagination page={1} totalPages={4} total={90} pageSize={25} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("folds long runs of pages into gaps", () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(2, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
    expect(pageItems(4, 9)).toEqual([1, 2, 3, 4, 5, "gap", 9]);
  });
});

describe("NoResults", () => {
  it("says nothing matched and offers a way out", () => {
    const onClear = jest.fn();
    render(<NoResults onClear={onClear} />);
    expect(screen.getByRole("status")).toHaveTextContent("No results found");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("takes its own wording and has no button without onClear", () => {
    render(<NoResults title="No events match" description="Try another search." />);
    expect(screen.getByText("No events match")).toBeInTheDocument();
    expect(screen.getByText("Try another search.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
