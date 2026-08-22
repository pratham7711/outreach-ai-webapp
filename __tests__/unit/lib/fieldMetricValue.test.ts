/**
 * @jest-environment node
 *
 * lastSyncedAt is one flag for a whole row, but which counters a fetch returns
 * varies by platform: TikTok gives views, likes, comments and shares; Instagram
 * gives views and comments, likes only sometimes, and shares never. The write
 * path used to fill the gaps with `?? 0` and stamp the timestamp anyway, so three
 * Instagram posts on the reference campaign reported "0 likes, 0 shares" while
 * CreatorCore's report of the same three posts shows neither row.
 */
import { fieldMetricValue, measuredFields, MEASURED_FIELDS_KEY } from "@/lib/metricDisplay";

const SYNCED = new Date("2026-08-22T00:00:00Z");
const bag = (fields: string[]) => ({ [MEASURED_FIELDS_KEY]: fields });

describe("measuredFields", () => {
  it("reads the record the sync left behind", () => {
    expect(measuredFields(bag(["views", "likes"]))).toEqual(["views", "likes"]);
  });

  it("returns null for a post nothing recorded, so the caller falls back", () => {
    expect(measuredFields(null)).toBeNull();
    expect(measuredFields({})).toBeNull();
    // The importer's raw record shares this bag and must not be mistaken for one.
    expect(measuredFields({ __cc: { views: 12 } })).toBeNull();
  });

  it("ignores a malformed record rather than trusting it", () => {
    expect(measuredFields({ [MEASURED_FIELDS_KEY]: "likes" })).toBeNull();
  });
});

describe("fieldMetricValue", () => {
  it("hides a zero for a field the platform never reported", () => {
    // Instagram: views and comments came back, shares did not.
    expect(fieldMetricValue(0, SYNCED, bag(["views", "comments"]), "shares")).toBeNull();
    expect(fieldMetricValue(0, SYNCED, bag(["views", "comments"]), "likes")).toBeNull();
  });

  it("shows a zero the platform did report, because that one is a measurement", () => {
    expect(fieldMetricValue(0, SYNCED, bag(["views", "likes"]), "likes")).toBe(0);
  });

  it("falls back to the row-level rule when nothing was recorded", () => {
    // Pre-existing posts and everything the CreatorCore import wrote.
    expect(fieldMetricValue(0, SYNCED, null, "likes")).toBe(0);
    expect(fieldMetricValue(0, null, null, "likes")).toBeNull();
  });

  it("trusts a value it holds even with no provenance at all", () => {
    // The importer wrote real saves counts with no timestamp and no record.
    expect(fieldMetricValue(155, null, null, "saves")).toBe(155);
    expect(fieldMetricValue(155, null, bag(["views"]), "saves")).toBe(155);
  });

  it("reports nothing for a counter that is absent rather than zero", () => {
    expect(fieldMetricValue(null, SYNCED, bag(["views"]), "likes")).toBeNull();
    expect(fieldMetricValue(undefined, SYNCED, bag(["likes"]), "likes")).toBeNull();
  });
});
