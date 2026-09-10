/**
 * The shared compact-money formatter.
 *
 * It exists because the client report hand-rolled its own: a "$" prefix for USD
 * and a trailing code for everything else, so one GBP campaign's leaderboard
 * read "1.1B GBP" while the tile above it read "£1,100,000,000.00" — the same
 * number, printed two ways, on the same screen. Intl carries every currency's
 * symbol, so the only correct implementation is the one that asks it.
 */
import { formatCompactCurrency } from "@/lib/format";

describe("formatCompactCurrency", () => {
  it("uses the currency's own symbol, not a USD-only prefix", () => {
    expect(formatCompactCurrency(1_100_000_000, "USD")).toBe("$1.1B");
    expect(formatCompactCurrency(1_100_000_000, "GBP")).toBe("£1.1B");
    expect(formatCompactCurrency(1_100_000_000, "INR")).toBe("₹1.1B");
    expect(formatCompactCurrency(1_100_000_000, "EUR")).toBe("€1.1B");
  });

  it("never prints a bare currency code alongside the figure", () => {
    for (const currency of ["USD", "GBP", "INR", "EUR"]) {
      expect(formatCompactCurrency(1_100_000_000, currency)).not.toContain(currency);
    }
  });

  it("compacts at every magnitude and defaults to USD", () => {
    expect(formatCompactCurrency(12_500, "GBP")).toBe("£12.5K");
    expect(formatCompactCurrency(0, "EUR")).toBe("€0");
    expect(formatCompactCurrency(2_400_000)).toBe("$2.4M");
  });

  /* A non-finite amount is a bug upstream, but the report still has to render. */
  it("falls back rather than printing NaN", () => {
    expect(formatCompactCurrency(Number.NaN, "GBP")).toBe("£0");
  });
});
