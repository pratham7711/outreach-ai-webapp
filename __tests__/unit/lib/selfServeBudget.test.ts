import { computeSelfServeBudget } from "@/lib/campaigns/selfServeBudget";

/* This is the number someone commits a budget against, so the rule it has to
   obey is narrow: a creator with no rate on file is not a creator who is free.
   Creator.rate is nullable and set on 12 of 1,834 creators, so the unpriced case
   is the normal one, not the edge. */

const fee = { platformFeeMinor: 2500, currency: "USD" };

describe("computeSelfServeBudget", () => {
  it("adds up the rates it has, plus the fee", () => {
    const b = computeSelfServeBudget({ creatorRates: [100, 250], ...fee });
    expect(b.creatorTotal).toBe(350);
    expect(b.platformFee).toBe(25);
    expect(b.total).toBe(375);
    expect(b.unpricedCreators).toBe(0);
  });

  it("counts a creator with no rate instead of pricing them at zero", () => {
    const b = computeSelfServeBudget({ creatorRates: [100, null, null], ...fee });
    expect(b.creatorTotal).toBe(100);
    expect(b.unpricedCreators).toBe(2);
    // The total is still the priced subset — it just no longer claims to be the
    // whole quote on its own.
    expect(b.total).toBe(125);
  });

  it("treats a zero, a NaN and an absent rate the same way: unknown", () => {
    // A rate of 0 in the column is the same unfetched default as a null here,
    // and neither is a price someone agreed to.
    const b = computeSelfServeBudget({
      creatorRates: [0, Number.NaN, null, undefined as never, "40" as never],
      ...fee,
    });
    expect(b.creatorTotal).toBe(0);
    expect(b.unpricedCreators).toBe(5);
    expect(b.perCreator.every((line) => line.rate === null)).toBe(true);
  });

  it("keeps a line per selection so the summary can line up with the list", () => {
    const b = computeSelfServeBudget({ creatorRates: [100, null, 50], ...fee });
    expect(b.perCreator).toEqual([
      { index: 0, rate: 100 },
      { index: 1, rate: null },
      { index: 2, rate: 50 },
    ]);
  });

  it("never lets a negative rate reduce the total", () => {
    const b = computeSelfServeBudget({ creatorRates: [100, -500], ...fee });
    expect(b.creatorTotal).toBe(100);
    expect(b.unpricedCreators).toBe(1);
  });

  it("survives a malformed input rather than pricing something wrong", () => {
    const b = computeSelfServeBudget({ creatorRates: null as never, platformFeeMinor: NaN, currency: "" });
    expect(b).toMatchObject({ currency: "USD", creatorTotal: 0, platformFee: 0, total: 0, unpricedCreators: 0 });
  });
});
