/**
 * @jest-environment node
 *
 * A views figure the latest read did not return must not look as fresh as the
 * figures that read did return. On 2026-10-02 no Instagram reading carried
 * views, and every one of those posts showed its views under "Updated just
 * now". These pin when a views figure carries its own date, and which date.
 */
import { viewsAsOf, viewsCarried, viewsReadAt } from "@/lib/posts/fieldFreshness";
import { MEASURED_FIELDS_KEY } from "@/lib/metricDisplay";

const bag = (fields: string[] | null, writers?: Record<string, unknown>) => ({
  ...(fields ? { [MEASURED_FIELDS_KEY]: fields } : {}),
  ...(writers ? { __writers: writers } : {}),
});

describe("viewsCarried", () => {
  it("is true when a shown views figure was not in the latest read", () => {
    expect(viewsCarried(17_406, bag(["comments"]))).toBe(true);
  });

  it("is false when the latest read carried views", () => {
    expect(viewsCarried(17_406, bag(["views", "comments"]))).toBe(false);
  });

  it("is false for a 0, which is already shown as unknown", () => {
    expect(viewsCarried(0, bag(["comments"]))).toBe(false);
  });

  it("is false for a post with no measured list to judge by", () => {
    expect(viewsCarried(17_406, bag(null))).toBe(false);
    expect(viewsCarried(17_406, null)).toBe(false);
  });
});

describe("viewsReadAt", () => {
  const writers = { views: { source: "public", at: "2026-10-02T13:00:53.000Z" } };

  it("takes the writer note when no views reading is newer", () => {
    expect(viewsReadAt(bag(["comments"], writers), [])).toBe("2026-10-02T13:00:53.000Z");
  });

  it("takes a newer snapshot that measured views", () => {
    const at = viewsReadAt(bag(["comments"], writers), [
      { recordedAt: "2026-10-03T00:51:00.000Z", viewsCount: 18_000, platformMetrics: bag(["views"]) },
    ]);
    expect(at).toBe("2026-10-03T00:51:00.000Z");
  });

  it("ignores a snapshot that carried views forward", () => {
    const at = viewsReadAt(bag(["comments"]), [
      { recordedAt: "2026-10-03T00:51:00.000Z", viewsCount: 18_000, platformMetrics: bag(["comments"]) },
      { recordedAt: "2026-10-01T09:08:00.000Z", viewsCount: 16_000, platformMetrics: bag(["views", "comments"]) },
    ]);
    expect(at).toBe("2026-10-01T09:08:00.000Z");
  });

  it("is null, not a guess, when nothing recorded a time", () => {
    expect(viewsReadAt(bag(["comments"]), [])).toBeNull();
    expect(viewsReadAt(bag(["comments"], { views: { source: "public", at: "not a date" } }), [])).toBeNull();
  });
});

describe("viewsAsOf", () => {
  it("dates a carried figure", () => {
    const note = viewsAsOf({ viewsCount: 17_406, platformMetrics: bag(["comments"]), viewsReadAt: "2026-10-01T09:08:00.000Z" });
    expect(note).toMatchObject({ at: "2026-10-01T09:08:00.000Z", short: "as of 1 Oct 2026", sentence: "Views as of 1 Oct 2026" });
    expect(note?.title).toContain("did not return views");
  });

  it("says 'earlier reading' rather than inventing a date", () => {
    expect(viewsAsOf({ viewsCount: 17_406, platformMetrics: bag(["comments"]), viewsReadAt: null })).toMatchObject({
      at: null,
      short: "earlier reading",
      sentence: "Views from an earlier reading",
    });
  });

  it("is null for a figure the latest read returned", () => {
    expect(viewsAsOf({ viewsCount: 17_406, platformMetrics: bag(["views"]), viewsReadAt: "2026-10-01T09:08:00.000Z" })).toBeNull();
  });
});
