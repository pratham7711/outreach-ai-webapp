import { COUNT_INPUT_ERROR, formatCompact, parseCountInput } from "@/lib/format";

/**
 * Follower counts are read off a profile page, where they are already written
 * as "2.4M". Number("2.4m") is NaN, JSON.stringify turns that into null, and
 * the route's z.number().int() answers 400 — which AddCreatorModal used to
 * swallow, so the Add button did nothing at all.
 */
describe("parseCountInput", () => {
  it("reads the shapes a follower count is actually written in", () => {
    expect(parseCountInput("2.4m")).toEqual({ ok: true, value: 2_400_000 });
    expect(parseCountInput("2.4M")).toEqual({ ok: true, value: 2_400_000 });
    expect(parseCountInput("890k")).toEqual({ ok: true, value: 890_000 });
    expect(parseCountInput("1,200,000")).toEqual({ ok: true, value: 1_200_000 });
    expect(parseCountInput("1 200 000")).toEqual({ ok: true, value: 1_200_000 });
    expect(parseCountInput("3.1 B")).toEqual({ ok: true, value: 3_100_000_000 });
    expect(parseCountInput("500")).toEqual({ ok: true, value: 500 });
  });

  it("round-trips what formatCompact prints, which is where the paste comes from", () => {
    for (const n of [500, 890_000, 2_400_000, 12_000_000]) {
      expect(parseCountInput(formatCompact(n))).toEqual({ ok: true, value: n });
    }
  });

  it("always yields an integer — the column is an Int", () => {
    const parsed = parseCountInput("1.2345k");
    expect(parsed).toEqual({ ok: true, value: 1235 });
  });

  it("treats blank as 'not given' rather than zero", () => {
    expect(parseCountInput("")).toEqual({ ok: true, value: undefined });
    expect(parseCountInput("   ")).toEqual({ ok: true, value: undefined });
  });

  it("refuses what it cannot turn into a count, and says so", () => {
    for (const bad of ["abc", "-5", "2.4x", "1e6", "2..4", "m", "12,00,0k0"]) {
      expect(parseCountInput(bad)).toEqual({ ok: false, error: COUNT_INPUT_ERROR });
    }
  });

  it("refuses a value too large to be a safe integer rather than silently rounding", () => {
    expect(parseCountInput("99999999b")).toEqual({ ok: false, error: COUNT_INPUT_ERROR });
  });
});
