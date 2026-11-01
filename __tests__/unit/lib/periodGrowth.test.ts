import { growthDelta, viewsGrowth } from "@/lib/analytics/periodGrowth";
import { followersReached } from "@/lib/campaigns/followersReached";

const day = (iso: string, viewsCount: number) => ({ day: new Date(`${iso}T00:00:00Z`), viewsCount });

/** One reading a day from `start`, the total rising by `perDay[i]` each day. */
function series(start: string, perDay: number[], base = 1000) {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  let total = base;
  return [day(start, total), ...perDay.map((n, i) => {
    total += n;
    return { day: new Date(t0 + (i + 1) * 86_400_000), viewsCount: total };
  })];
}

describe("viewsGrowth", () => {
  it("is the difference of the daily total over the window, against the window before", () => {
    const rows = series("2026-10-01", [...Array(7).fill(100), ...Array(7).fill(150)]);
    const g = viewsGrowth(rows, 7)!;
    expect(g.current).toBe(1050);
    expect(g.previous).toBe(700);
    expect(g.change).toBeCloseTo(0.5, 5);
    expect(g.from).toBe("2026-10-08");
    expect(g.to).toBe("2026-10-15");
  });

  it("reports the window without a comparison when the earlier one was not read", () => {
    const g = viewsGrowth(series("2026-10-01", Array(10).fill(10)), 7)!;
    expect(g.current).toBe(70);
    expect(g.previous).toBeNull();
    expect(g.change).toBeNull();
    expect(growthDelta(g)).toBeUndefined();
  });

  it("gives nothing when there is no reading near the window's start", () => {
    expect(viewsGrowth(series("2026-10-01", Array(3).fill(10)), 30)).toBeNull();
    expect(viewsGrowth([day("2026-10-01", 5)], 7)).toBeNull();
  });

  it("does not divide by an earlier window that gained nothing", () => {
    const g = viewsGrowth(series("2026-10-01", [...Array(7).fill(0), ...Array(7).fill(20)]), 7)!;
    expect(g.previous).toBe(0);
    expect(g.change).toBeNull();
  });

  it("gives nothing once the newest daily reading is more than two days old", () => {
    const rows = series("2026-10-01", Array(14).fill(10));
    expect(viewsGrowth(rows, 7, Date.parse("2026-10-17T09:00:00Z"))).not.toBeNull();
    expect(viewsGrowth(rows, 7, Date.parse("2026-10-18T09:00:00Z"))).toBeNull();
  });

  it("words the delta as the tile prints it", () => {
    const g = viewsGrowth(series("2026-10-01", [...Array(7).fill(200), ...Array(7).fill(150)]), 7)!;
    expect(growthDelta(g)).toEqual({ value: "-25%", trend: "down", label: "vs the 7 days before" });
  });
});

describe("followersReached", () => {
  it("adds up posting creators' followers and leaves unread counts out", () => {
    const r = followersReached([
      { posts: 2, creator: { followersCount: 1000 } },
      { posts: 1, creator: { followersCount: 0 } },
      { posts: 0, creator: { followersCount: 50000 } },
      { posts: 3, creator: { followersCount: 250 } },
    ]);
    expect(r).toEqual({ followers: 1250, counted: 2, posting: 3 });
  });
});
