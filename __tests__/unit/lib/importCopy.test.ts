import { withoutImportCopy } from "@/lib/serialization/importCopy";

describe("withoutImportCopy", () => {
  it("drops __cc and keeps every other key", () => {
    const bag = { __cc: { big: "x".repeat(100) }, __measured: ["views"], perThousand: 3 };
    expect(withoutImportCopy(bag)).toEqual({ __measured: ["views"], perThousand: 3 });
  });

  it("does not mutate the stored object", () => {
    const bag = { __cc: 1, a: 2 };
    withoutImportCopy(bag);
    expect(bag).toEqual({ __cc: 1, a: 2 });
  });

  it("returns the same object when there is no copy to drop", () => {
    const bag = { a: 1 };
    expect(withoutImportCopy(bag)).toBe(bag);
  });

  it.each([null, undefined, 0, "s", [1, 2]])("passes %p through", (v) => {
    expect(withoutImportCopy(v)).toBe(v);
  });
});
