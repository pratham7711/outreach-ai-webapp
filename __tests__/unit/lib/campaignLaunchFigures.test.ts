/**
 * The launch marker and the "before vs since" figures beside it. The cases that
 * matter are the ones that would mislead: a lift claimed with no baseline, a
 * launch-day figure credited to the campaign, a later count passed off as the
 * count at launch, a missed day folded into an average.
 */
import { campaignLaunch, earliestPostedAt, launchLabel } from "@/lib/campaigns/launch";
import { LIFT_MIN_DAYS, streamLift } from "@/lib/songs/streamLift";
import { AT_LAUNCH_WINDOW_MS, soundAtLaunch } from "@/lib/sounds/soundAtLaunch";
import { rangeStartDay, rangeStartMs, withinRange } from "@/lib/charts/seriesMode";

const HOUR = 3_600_000;

describe("campaignLaunch", () => {
  it("prefers a launch date the team set over the first post", () => {
    const l = campaignLaunch("2026-10-12T09:00:00Z", "2026-10-10T00:00:00Z");
    expect(l).toEqual({ at: "2026-10-10T00:00:00.000Z", day: "2026-10-10", source: "launchDate" });
    expect(launchLabel(l!)).toBe("Launch");
  });

  it("falls back to the first post, and is null with neither", () => {
    expect(campaignLaunch("2026-10-12T23:30:00Z")).toMatchObject({ day: "2026-10-12", source: "firstPost" });
    expect(campaignLaunch(null)).toBeNull();
    expect(campaignLaunch("not a date")).toBeNull();
  });

  it("takes the earliest post among those loaded, skipping undated ones", () => {
    const first = earliestPostedAt([
      { postedAt: new Date("2026-10-14T00:00:00Z") },
      { postedAt: null },
      { postedAt: "2026-10-09T08:00:00Z" },
    ]);
    expect(first?.toISOString()).toBe("2026-10-09T08:00:00.000Z");
    expect(earliestPostedAt([{ postedAt: null }])).toBeNull();
  });
});

function playsFrom(start: string, counts: number[]) {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return counts.map((count, i) => ({ day: new Date(t0 + i * 24 * HOUR).toISOString().slice(0, 10), count }));
}

function dailyOf(plays: { day: string; count: number }[]) {
  return plays.slice(1).map((p, i) => ({ day: p.day, streams: p.count - plays[i].count }));
}

describe("streamLift", () => {
  it("counts the launch day as before, and the day after as the first day since", () => {
    // 1 Oct .. 8 Oct; launch 4 Oct. Before: 2,3,4 Oct (+10 each). Since: 5..8 Oct (+40 each).
    const plays = playsFrom("2026-10-01", [100, 110, 120, 130, 170, 210, 250, 290]);
    const lift = streamLift({ plays, daily: dailyOf(plays) }, "2026-10-04");
    expect(lift).toMatchObject({ kind: "lift", beforeAvg: 10, sinceAvg: 40, beforeDays: 3, sinceDays: 4, multiple: 4, sinceStreams: 160 });
  });

  it("says there is no baseline when reading began after the launch", () => {
    const plays = playsFrom("2026-10-05", [500, 600, 700, 800]);
    expect(streamLift({ plays, daily: dailyOf(plays) }, "2026-10-04")).toEqual({
      kind: "noBaseline", launchDay: "2026-10-04", firstReadDay: "2026-10-05", sinceStreams: null,
    });
  });

  it(`needs ${LIFT_MIN_DAYS} days with a figure on each side`, () => {
    const plays = playsFrom("2026-10-03", [100, 110, 150, 190, 230, 270]);
    expect(streamLift({ plays, daily: dailyOf(plays) }, "2026-10-04")).toMatchObject({
      kind: "tooFew", beforeDays: 1, sinceDays: 4, sinceStreams: 160,
    });
  });

  it("averages only days with a figure, so a missed day is a gap, not a double day", () => {
    const plays = playsFrom("2026-10-01", [100, 110, 120, 130, 170, 210, 250, 290]);
    const daily = dailyOf(plays).filter((d) => d.day !== "2026-10-06"); // 6 Oct not read
    const lift = streamLift({ plays: plays.filter((p) => p.day !== "2026-10-06"), daily }, "2026-10-04");
    expect(lift).toMatchObject({ kind: "lift", sinceAvg: 40, sinceDays: 3 });
  });

  it("has no multiple when nothing was streamed before", () => {
    const plays = playsFrom("2026-10-01", [100, 100, 100, 100, 140, 180, 220]);
    expect(streamLift({ plays, daily: dailyOf(plays) }, "2026-10-04")).toMatchObject({ kind: "lift", beforeAvg: 0, multiple: null });
  });

  it("is null without a launch or a reading", () => {
    expect(streamLift({ plays: [], daily: [] }, "2026-10-04")).toBeNull();
    expect(streamLift({ plays: playsFrom("2026-10-01", [1, 2]), daily: [] }, null)).toBeNull();
  });
});

describe("soundAtLaunch", () => {
  const launch = Date.parse("2026-10-04T12:00:00Z");
  const p = (h: number, uses: number, rounded = false) => ({ t: launch + h * HOUR, uses, rounded });

  it("takes the newest reading at or before the launch, within the window", () => {
    const r = soundAtLaunch([p(-30, 900), p(-6, 1000), p(20, 1500), p(70, 3000)], launch);
    expect(r).toEqual({ kind: "atLaunch", atLaunch: p(-6, 1000), now: p(70, 3000), added: 2000 });
  });

  it("never passes a reading from long before the launch off as the launch count", () => {
    const r = soundAtLaunch([p(-(AT_LAUNCH_WINDOW_MS / HOUR) - 1, 900), p(20, 1500), p(70, 3000)], launch);
    expect(r).toEqual({ kind: "firstAfter", firstAfter: p(20, 1500), now: p(70, 3000) });
  });

  it("states no difference across a rounded figure", () => {
    const r = soundAtLaunch([p(-2, 74_000, true), p(30, 81_000, true)], launch);
    expect(r).toMatchObject({ kind: "atLaunch", added: null });
  });

  it("is null without a launch or readings", () => {
    expect(soundAtLaunch([], launch)).toBeNull();
    expect(soundAtLaunch([p(1, 1)], null)).toBeNull();
  });
});

describe("chart ranges", () => {
  const now = Date.parse("2026-10-30T15:00:00Z");

  it("counts today as the range's last day", () => {
    expect(rangeStartDay("7d", now)).toBe("2026-10-24");
    expect(rangeStartDay("30d", now)).toBe("2026-10-01");
    expect(rangeStartDay("all", now)).toBeNull();
    expect(rangeStartMs("7d", now)).toBe(Date.parse("2026-10-24T00:00:00Z"));
  });

  it("keeps the rows inside the window, and every row for All", () => {
    const rows = [{ d: "2026-10-20" }, { d: "2026-10-24" }, { d: "2026-10-30T01:00:00Z" }];
    expect(withinRange(rows, (r) => r.d, "7d", now)).toEqual(rows.slice(1));
    expect(withinRange(rows, (r) => r.d, "all", now)).toEqual(rows);
  });
});
