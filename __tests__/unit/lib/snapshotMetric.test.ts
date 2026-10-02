/**
 * @jest-environment node
 *
 * PostMetricSnapshot's counters are non-nullable, and a partial read used to
 * store `?? 0` for whatever it left out -- an Instagram post at 0 views between
 * two readings of thousands. These pin that a reading which did not measure a
 * counter is never read back as a measured 0: charts skip it, the posts list
 * does not take a delta against it, and the bot heuristics never see the dip.
 */
import {
  MEASURED_FIELDS_KEY,
  readableSnapshots,
  snapshotMetric,
  snapshotViewsKnown,
  snapshotViewsKnownSql,
} from "@/lib/metricDisplay";
import { detectBotSignals } from "@/lib/fraud/botSignals";
import { toPostDto } from "@/lib/serialization/postList";

const bag = (fields: string[]) => ({ [MEASURED_FIELDS_KEY]: fields });
const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));

describe("snapshotMetric", () => {
  it("a placeholder 0 the reading did not measure is unknown", () => {
    expect(snapshotMetric(0, bag(["comments"]), "views")).toBeNull();
  });

  it("a measured 0 stays 0", () => {
    expect(snapshotMetric(0, bag(["views", "comments"]), "views")).toBe(0);
  });

  it("a carried-forward figure is kept whatever the list says", () => {
    expect(snapshotMetric(4200, bag(["comments"]), "views")).toBe(4200);
  });

  it("a row written before the list existed is taken as read", () => {
    expect(snapshotMetric(0, null, "views")).toBe(0);
    expect(snapshotMetric(0, {}, "views")).toBe(0);
  });

  it("snapshotViewsKnown is the same rule for views", () => {
    expect(snapshotViewsKnown({ viewsCount: 0, platformMetrics: bag(["likes"]) })).toBe(false);
    expect(snapshotViewsKnown({ viewsCount: 0, platformMetrics: null })).toBe(true);
    expect(snapshotViewsKnown({ viewsCount: 7, platformMetrics: bag([]) })).toBe(true);
  });
});

describe("readableSnapshots", () => {
  const row = (h: number, views: number, likes: number, fields: string[] | null) => ({
    id: `s${h}`,
    recordedAt: at(h),
    viewsCount: views,
    likesCount: likes,
    commentsCount: 3,
    sharesCount: 0,
    platformMetrics: fields ? bag(fields) : null,
  });

  it("drops a reading whose views were not measured", () => {
    const out = readableSnapshots([
      row(0, 10_000, 500, ["views", "likes", "comments"]),
      row(2, 0, 0, ["comments"]),
      row(4, 10_400, 520, ["views", "likes", "comments"]),
    ]);
    expect(out.map((r) => r.id)).toEqual(["s0", "s4"]);
  });

  it("holds a counter the reading left out at its last known level", () => {
    const out = readableSnapshots([
      row(0, 10_000, 500, ["views", "likes", "comments"]),
      row(2, 10_200, 0, ["views", "comments"]),
    ]);
    expect(out[1].likesCount).toBe(500);
  });

  it("a counter never measured stays null rather than 0", () => {
    const out = readableSnapshots([row(0, 10_000, 0, ["views", "comments"])]);
    expect(out[0].likesCount).toBeNull();
    expect(out[0].commentsCount).toBe(3);
  });
});

describe("snapshotViewsKnownSql", () => {
  it("names the alias it is given and the measured key", () => {
    const sql = snapshotViewsKnownSql("s");
    expect(sql).toContain('s."viewsCount" = 0');
    expect(sql).toContain(`s."platformMetrics" -> '${MEASURED_FIELDS_KEY}'`);
    // NULL-safe: a row with no bag must pass, not vanish from the chart.
    expect(sql).toContain("COALESCE(");
  });
});

describe("bot signals over a partial read", () => {
  it("a 0-view placeholder between real readings raises no view spike", () => {
    const rows = [0, 2, 4, 6, 8, 10].map((h, i) => ({
      id: `s${h}`,
      recordedAt: at(h),
      viewsCount: i === 3 ? 0 : 20_000 + i * 400,
      likesCount: 900 + i * 10,
      commentsCount: 40,
      sharesCount: 5,
      platformMetrics: i === 3 ? bag(["likes", "comments"]) : bag(["views", "likes", "comments"]),
    }));
    // Fed raw, the recovery from the placeholder reads as a HIGH spike.
    expect(detectBotSignals(rows).filter((s) => s.type === "VIEW_SPIKE")).toEqual([
      expect.objectContaining({ severity: "HIGH" }),
    ]);
    expect(detectBotSignals(readableSnapshots(rows)).filter((s) => s.type === "VIEW_SPIKE")).toHaveLength(0);
  });

  it("no low-engagement signal when likes were never measured", () => {
    const rows = readableSnapshots(
      [0, 2, 4].map((h, i) => ({
        recordedAt: at(h),
        viewsCount: 50_000 + i * 1000,
        likesCount: 0,
        commentsCount: 10,
        sharesCount: 0,
        platformMetrics: bag(["views", "comments"]),
      })),
    );
    expect(detectBotSignals(rows).filter((s) => s.type === "LOW_ENGAGEMENT")).toHaveLength(0);
  });
});

describe("posts list delta", () => {
  it("is taken against the newest readings that measured views", () => {
    const dto = toPostDto(
      {
        id: "p1",
        viewsCount: 10_400,
        snapshots: [
          { id: "s3", viewsCount: 10_400, recordedAt: at(6), platformMetrics: bag(["views"]) },
          { id: "s2", viewsCount: 0, recordedAt: at(4), platformMetrics: bag(["comments"]) },
          { id: "s1", viewsCount: 10_000, recordedAt: at(2), platformMetrics: bag(["views"]) },
          { id: "s0", viewsCount: 9_000, recordedAt: at(0), platformMetrics: bag(["views"]) },
        ],
      },
      false,
      [],
    );
    expect(dto.snapshots.map((s) => s.id)).toEqual(["s3", "s1"]);
  });
});
