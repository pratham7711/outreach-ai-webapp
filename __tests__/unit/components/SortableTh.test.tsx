/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useTableSort, type SortAccessors } from "@/components/ds/SortableTh";

type Row = { name: string; views: number | null };

const ACC: SortAccessors<Row> = {
  name: (r) => r.name,
  views: (r) => r.views,
};

const ROWS: Row[] = [
  { name: "Bea", views: 50 },
  { name: "alice", views: null },
  { name: "Cy", views: 900 },
];

function names(rows: Row[]) {
  return rows.map((r) => r.name);
}

describe("useTableSort", () => {
  it("leaves rows untouched until a column is picked", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACC));
    expect(names(result.current.sorted)).toEqual(["Bea", "alice", "Cy"]);
  });

  it("sorts numbers biggest-first on the first click", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACC));
    act(() => result.current.toggle("views"));
    expect(result.current.sort).toEqual({ key: "views", dir: "desc" });
    expect(names(result.current.sorted)).toEqual(["Cy", "Bea", "alice"]);
  });

  it("keeps unknown values at the bottom in both directions", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACC));
    act(() => result.current.toggle("views"));
    act(() => result.current.toggle("views"));
    expect(result.current.sort).toEqual({ key: "views", dir: "asc" });
    // alice has no view count, so she is last even when sorting fewest-first.
    expect(names(result.current.sorted)).toEqual(["Bea", "Cy", "alice"]);
  });

  it("sorts text A-Z first, case-insensitively", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACC));
    act(() => result.current.toggle("name"));
    expect(result.current.sort).toEqual({ key: "name", dir: "asc" });
    expect(names(result.current.sorted)).toEqual(["alice", "Bea", "Cy"]);
  });

  it("does not mutate the source array", () => {
    const rows = [...ROWS];
    const { result } = renderHook(() => useTableSort(rows, ACC));
    act(() => result.current.toggle("views"));
    expect(names(rows)).toEqual(["Bea", "alice", "Cy"]);
  });
});
