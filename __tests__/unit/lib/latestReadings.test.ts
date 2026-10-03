/**
 * @jest-environment node
 *
 * The roster dates Avg. Views by the reading that measured it. TikTok's
 * newest reading usually did not: posts are read once a day and followers
 * every few hours, so the newest reading carries avgViews 0 and matched
 * nothing, and the figure read "time not recorded".
 */
jest.mock("@/lib/db", () => ({
  db: { creatorTrackerSnapshot: { groupBy: jest.fn(), findMany: jest.fn() } },
}));

import { db } from "@/lib/db";
import { latestTrackerReadings } from "@/lib/creators/latestReadings";
import { creatorAvgViewsTime } from "@/lib/creators/figureTime";

const snap = db.creatorTrackerSnapshot as unknown as { groupBy: jest.Mock; findMany: jest.Mock };
const NEWEST = new Date("2026-10-03T04:30:00Z");
const MEASURED = new Date("2026-10-02T22:30:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  snap.groupBy.mockImplementation(async (args: { where: { avgViews?: unknown } }) => [
    { creatorId: "cr-1", _max: { recordedAt: args.where.avgViews ? MEASURED : NEWEST } },
  ]);
  snap.findMany.mockImplementation(async (args: { where: { OR: { recordedAt: Date }[] } }) =>
    args.where.OR[0].recordedAt === MEASURED
      ? [{ creatorId: "cr-1", followersCount: 900, avgViews: 1234, recordedAt: MEASURED }]
      : [{ creatorId: "cr-1", followersCount: 910, avgViews: 0, recordedAt: NEWEST }],
  );
});

it("carries the newest reading that measured views beside the newest reading", async () => {
  const readings = await latestTrackerReadings("org-1", ["cr-1"]);
  expect(readings.get("cr-1")).toEqual({
    followersCount: 910,
    avgViews: 0,
    recordedAt: NEWEST,
    viewsReading: { avgViews: 1234, recordedAt: MEASURED },
  });
  for (const call of snap.groupBy.mock.calls) expect(call[0].where.creator).toEqual({ orgId: "org-1" });
});

it("lets the roster date the figure that reading measured", async () => {
  const latest = (await latestTrackerReadings("org-1", ["cr-1"])).get("cr-1");
  const time = creatorAvgViewsTime({ averageViews: 1234, latestSnapshot: latest?.viewsReading ?? null });
  expect(time.at).toEqual(MEASURED);
});

it("never throws; a page that cannot date its figures still shows them", async () => {
  snap.groupBy.mockRejectedValue(new Error("down"));
  await expect(latestTrackerReadings("org-1", ["cr-1"])).resolves.toEqual(new Map());
});
