/**
 * @jest-environment node
 *
 * lib/creators/figureTime: a creator figure is dated only by a read that
 * produced it. A hand edit or an import gets no age rather than a borrowed one.
 */
import { creatorAvgViewsTime, creatorFollowersTime, figureTimeDto, linkFollowersTime } from "@/lib/creators/figureTime";

const READ = new Date("2026-10-01T06:00:00Z");
const TRACKED = new Date("2026-10-01T12:00:00Z");

describe("creatorFollowersTime", () => {
  it("is the primary account's read when that read wrote the count", () => {
    const t = creatorFollowersTime({ followersCount: 1500, primaryLink: { followersCount: 1500, refreshedAt: READ, refreshError: null } });
    expect(t).toMatchObject({ at: READ, source: "Profile read", field: "profile" });
  });

  it("is the newer of a matching profile read and tracker reading", () => {
    const t = creatorFollowersTime({
      followersCount: 1500,
      primaryLink: { followersCount: 1500, refreshedAt: READ },
      latestSnapshot: { followersCount: 1500.4, recordedAt: TRACKED },
    });
    expect(t).toMatchObject({ at: TRACKED, source: "Tracker reading", field: "tracker" });
  });

  it("gives a count no read produced no age", () => {
    const t = creatorFollowersTime({
      followersCount: 9999,
      primaryLink: { followersCount: 1500, refreshedAt: READ },
      latestSnapshot: { followersCount: 1500, recordedAt: TRACKED },
    });
    expect(t.at).toBeNull();
    expect(t.missing).toBe("time not recorded");
  });

  it("says the last read failed when the held count cannot be dated", () => {
    const t = creatorFollowersTime({ followersCount: 1500, primaryLink: { followersCount: 1500, refreshedAt: READ, refreshError: "rate-limited" } });
    expect(t.at).toBeNull();
    expect(t.missing).toBe("last read failed; time not recorded");
  });

  it("says not read for a count that is not there", () => {
    expect(creatorFollowersTime({ followersCount: 0 })).toMatchObject({ at: null, source: "Not read", missing: "not read yet" });
  });
});

describe("creatorAvgViewsTime", () => {
  it("dates a posts-derived mean by the newest post read", () => {
    const t = creatorAvgViewsTime({ derived: { value: 10, asOf: READ, source: "Tracked posts" }, averageViews: 0 });
    expect(t).toMatchObject({ at: READ, source: "Tracked posts", field: "post" });
  });

  it("dates the account page's figure like followers", () => {
    const t = creatorAvgViewsTime({ averageViews: 800, latestSnapshot: { avgViews: 800, recordedAt: TRACKED } });
    expect(t).toMatchObject({ at: TRACKED, source: "Tracker reading" });
  });
});

describe("linkFollowersTime", () => {
  it("is the account's own good read, or says why there is no time", () => {
    expect(linkFollowersTime({ followersCount: 10, refreshedAt: READ })).toMatchObject({ at: READ, source: "Profile read" });
    expect(linkFollowersTime({ followersCount: 10, refreshedAt: READ, refreshError: "x" }).missing).toBe("last read failed; time not recorded");
    expect(linkFollowersTime({ followersCount: 10 }).missing).toBe("not read by us yet");
    expect(linkFollowersTime({ followersCount: null }).missing).toBe("not read yet");
  });

  it("serialises for a client component", () => {
    expect(figureTimeDto(linkFollowersTime({ followersCount: 10, refreshedAt: READ })).at).toBe(READ.toISOString());
  });
});
