import { formatCurrencyTotals, formatMoney, formatRowsByCurrency, totalsByCurrency } from "@/lib/money";

/**
 * Money that carries its own currency cannot be added up. Several tiles did it
 * anyway and printed the result behind one symbol, so a rupee request and a
 * dollar request became a figure true in neither.
 */
describe("totalsByCurrency", () => {
  it("keeps each currency in its own bucket", () => {
    expect(
      totalsByCurrency([
        { currency: "INR", amount: 40000 },
        { currency: "USD", amount: 500 },
        { currency: "INR", amount: 2000 },
      ])
    ).toEqual([
      { currency: "INR", amount: 42000 },
      { currency: "USD", amount: 500 },
    ]);
  });

  it("orders by amount with the code as a stable tiebreak", () => {
    expect(
      totalsByCurrency([
        { currency: "USD", amount: 100 },
        { currency: "EUR", amount: 100 },
        { currency: "GBP", amount: 900 },
      ]).map((t) => t.currency)
    ).toEqual(["GBP", "EUR", "USD"]);
  });

  it("folds an unlabelled row into the fallback rather than a blank bucket", () => {
    expect(totalsByCurrency([{ currency: null, amount: 10 }, { currency: "USD", amount: 5 }])).toEqual([
      { currency: "USD", amount: 15 },
    ]);
  });

  it("is case-insensitive about the code", () => {
    expect(totalsByCurrency([{ currency: "usd", amount: 1 }, { currency: "USD", amount: 2 }])).toEqual([
      { currency: "USD", amount: 3 },
    ]);
  });
});

describe("formatCurrencyTotals", () => {
  it("prints one figure per currency instead of a wrong sum", () => {
    const out = formatCurrencyTotals([
      { currency: "INR", amount: 40000 },
      { currency: "EUR", amount: 500 },
    ]);
    expect(out).toContain("40,000");
    expect(out).toContain("500");
    expect(out).toContain(" · ");
    // 40,500 would be the sum this replaced.
    expect(out).not.toContain("40,500");
  });

  it("prints a single currency plainly", () => {
    expect(formatCurrencyTotals([{ currency: "USD", amount: 1200 }])).toBe("$1,200.00");
  });

  it("prints zero in the fallback for an empty set", () => {
    expect(formatCurrencyTotals([], "EUR")).toBe("€0.00");
  });
});

describe("formatMoney", () => {
  it("uses each currency's own symbol", () => {
    expect(formatMoney(1000, "USD")).toBe("$1,000.00");
    expect(formatMoney(1000, "GBP")).toBe("£1,000.00");
  });

  it("renders a non-finite amount as zero rather than NaN", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("$0.00");
  });
});

describe("formatRowsByCurrency", () => {
  it("buckets and formats in one call", () => {
    const out = formatRowsByCurrency([
      { currency: "USD", amount: 10 },
      { currency: "USD", amount: 15 },
    ]);
    expect(out).toBe("$25.00");
  });
});
