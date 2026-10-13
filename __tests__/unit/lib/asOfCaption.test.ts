/**
 * @jest-environment node
 *
 * The small "as of" line under a total, and the PDF's "Data as of" line.
 *
 * A total with no time reads as live, and a total over some of the posts reads
 * as a total over all of them. Both lines now carry the time of the newest
 * reading and, when it is partial, how many items it covers.
 */
import { asOfCaption, dataAsOfLine, TIME_NOT_RECORDED } from "@/lib/dataAge";

const AT = new Date("2026-10-13T07:50:00Z");

describe("asOfCaption", () => {
  it("names the time and the coverage when some items are missing", () => {
    expect(asOfCaption(AT, { known: 4, total: 5, what: "views" })).toBe(
      "as of 13 Oct 2026, 07:50 UTC · views known for 4 of 5 posts",
    );
  });

  it("leaves coverage out when it is complete", () => {
    expect(asOfCaption(AT, { known: 5, total: 5 })).toBe("as of 13 Oct 2026, 07:50 UTC");
    expect(asOfCaption(AT)).toBe("as of 13 Oct 2026, 07:50 UTC");
  });

  it("says the time was not recorded rather than borrowing one", () => {
    expect(asOfCaption(null, { known: 2, total: 3, what: "views" })).toBe(
      `${TIME_NOT_RECORDED} · views known for 2 of 3 posts`,
    );
    expect(asOfCaption(null, { known: 3, total: 3 })).toBe(TIME_NOT_RECORDED);
  });

  it("states only the coverage when nothing is known", () => {
    expect(asOfCaption(null, { known: 0, total: 7, what: "views" })).toBe("views known for 0 of 7 posts");
  });

  it("says nothing about an empty set, or with nothing to say", () => {
    expect(asOfCaption(null, { known: 0, total: 0 })).toBeNull();
    expect(asOfCaption(null)).toBeNull();
  });

  it("takes its own noun", () => {
    expect(asOfCaption(AT, { known: 1, total: 2, noun: "sound" })).toBe(
      "as of 13 Oct 2026, 07:50 UTC · known for 1 of 2 sounds",
    );
  });
});

describe("dataAsOfLine with coverage", () => {
  it("is unchanged when every post was read by us", () => {
    expect(dataAsOfLine(AT, { read: 5, total: 5 })).toBe("Data as of 13 Oct 2026, 07:50 UTC");
  });

  it("calls the time the newest reading and counts the posts behind it", () => {
    expect(dataAsOfLine(AT, { read: 1, total: 5 })).toBe(
      "Data as of 13 Oct 2026, 07:50 UTC, the newest reading · 1 of 5 posts read by us; the other 4 show imported figures or none",
    );
  });

  it("says so plainly when no post was read", () => {
    expect(dataAsOfLine(null, { read: 0, total: 5 })).toBe("Data as of: no post read by us yet");
    expect(dataAsOfLine(null)).toBe("Data as of: no readings yet");
  });
});
