/**
 * @jest-environment node
 *
 * One writer per field (plan A7, A8): the priority table and pickWriter.
 */
import { FIELD_SOURCES, mayOverwrite, pickWriter, sourceRank, type MetricField } from "@/lib/metrics/fieldSources";

const NOW = new Date("2026-10-02T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("FIELD_SOURCES", () => {
  it("never lists a manual entry as a writer of any field", () => {
    for (const [field, rule] of Object.entries(FIELD_SOURCES)) {
      expect({ field, sources: rule.sources }).toEqual({ field, sources: expect.not.arrayContaining(["manual"]) });
    }
  });

  it("ranks the connection above the public read for followers and post views", () => {
    expect(FIELD_SOURCES["creator.followers"].sources).toEqual(["connected", "public"]);
    expect(FIELD_SOURCES["post.views"].sources).toEqual(["connected", "public"]);
  });

  it("lets only the connection write a connection's own stats and a post's reach", () => {
    expect(FIELD_SOURCES["account.followers"].sources).toEqual(["connected"]);
    expect(FIELD_SOURCES["post.reach"].sources).toEqual(["connected"]);
  });

  it("gives every field a positive freshness window", () => {
    for (const rule of Object.values(FIELD_SOURCES)) expect(rule.freshnessMs).toBeGreaterThan(0);
  });

  it("answers null rank for a source a field does not list", () => {
    expect(sourceRank("creator.followers", "connected")).toBe(0);
    expect(sourceRank("creator.followers", "public")).toBe(1);
    expect(sourceRank("creator.followers", "manual")).toBeNull();
    expect(sourceRank("post.reach", "public")).toBeNull();
  });
});

describe("pickWriter", () => {
  const field: MetricField = "creator.followers";

  it("keeps a fresh connected value over a newer public read", () => {
    const winner = pickWriter(
      field,
      [
        { source: "public", value: 1200, measuredAt: hoursAgo(0) },
        { source: "connected", value: 1234, measuredAt: hoursAgo(5) },
      ],
      NOW,
    );
    expect(winner).toMatchObject({ source: "connected", value: 1234 });
  });

  it("lets the public read win once the connected value is past its window", () => {
    const winner = pickWriter(
      field,
      [
        { source: "connected", value: 1234, measuredAt: hoursAgo(48) },
        { source: "public", value: 1300, measuredAt: hoursAgo(0) },
      ],
      NOW,
    );
    expect(winner).toMatchObject({ source: "public", value: 1300 });
  });

  it("takes the newest reading when none is fresh", () => {
    const winner = pickWriter(
      field,
      [
        { source: "connected", value: 1, measuredAt: hoursAgo(100) },
        { source: "public", value: 2, measuredAt: hoursAgo(50) },
      ],
      NOW,
    );
    expect(winner).toMatchObject({ value: 2 });
  });

  it("breaks a tie between same-rank fresh readings by recency", () => {
    const winner = pickWriter(
      "post.views",
      [
        { source: "public", value: 10, measuredAt: hoursAgo(3) },
        { source: "public", value: 20, measuredAt: hoursAgo(1) },
      ],
      NOW,
    );
    expect(winner).toMatchObject({ value: 20 });
  });

  it("never picks a manual entry, even when it is the only candidate", () => {
    expect(pickWriter(field, [{ source: "manual", value: 999_999, measuredAt: hoursAgo(0) }], NOW)).toBeNull();
    const winner = pickWriter(
      field,
      [
        { source: "manual", value: 999_999, measuredAt: hoursAgo(0) },
        { source: "public", value: 1000, measuredAt: hoursAgo(80) },
      ],
      NOW,
    );
    expect(winner).toMatchObject({ source: "public", value: 1000 });
  });

  it("drops a candidate with no value or no measurement time", () => {
    const winner = pickWriter(
      field,
      [
        { source: "connected", value: null, measuredAt: hoursAgo(1) },
        { source: "connected", value: 5, measuredAt: null },
        { source: "connected", value: Number.NaN, measuredAt: hoursAgo(1) },
        { source: "public", value: 7, measuredAt: hoursAgo(2) },
      ],
      NOW,
    );
    expect(winner).toMatchObject({ source: "public", value: 7 });
  });

  it("refuses a public read for a connected-only field", () => {
    expect(pickWriter("post.reach", [{ source: "public", value: 5, measuredAt: hoursAgo(0) }], NOW)).toBeNull();
  });

  it("returns the caller's own object, with whatever it carried", () => {
    const mine = { source: "connected" as const, value: 3, measuredAt: hoursAgo(1), accountId: "acct-fake" };
    expect(pickWriter(field, [mine], NOW)).toBe(mine);
  });

  it("answers null for no candidates", () => {
    expect(pickWriter(field, [], NOW)).toBeNull();
  });
});

describe("mayOverwrite", () => {
  it("does not let a public read replace a connected value inside the window", () => {
    expect(
      mayOverwrite("post.views", { source: "connected", writtenAt: hoursAgo(2) }, { source: "public" }, NOW),
    ).toBe(false);
  });

  it("lets it once the window has passed", () => {
    expect(
      mayOverwrite("post.views", { source: "connected", writtenAt: hoursAgo(7) }, { source: "public" }, NOW),
    ).toBe(true);
  });

  it("lets an equal or higher source always write", () => {
    expect(mayOverwrite("post.views", { source: "public", writtenAt: hoursAgo(0) }, { source: "public" }, NOW)).toBe(true);
    expect(mayOverwrite("post.views", { source: "public", writtenAt: hoursAgo(0) }, { source: "connected" }, NOW)).toBe(true);
  });

  it("never lets a manual entry write, and never lets one block a real reading", () => {
    expect(mayOverwrite("creator.followers", { source: "public", writtenAt: hoursAgo(99) }, { source: "manual" }, NOW)).toBe(false);
    expect(mayOverwrite("creator.followers", { source: "manual", writtenAt: hoursAgo(0) }, { source: "public" }, NOW)).toBe(true);
  });

  it("lets a reading through when the current value has no known write time", () => {
    expect(mayOverwrite("creator.followers", { source: "connected", writtenAt: null }, { source: "public" }, NOW)).toBe(true);
  });
});
