/**
 * @jest-environment node
 */
import { KNOWN_FOLLOWERS, pinsUnknownLast, splitByKnownFollowers, unknownLastWindow } from "@/lib/creators/rosterSort";

describe("unknownLastWindow", () => {
  it("reads a page that lies wholly among the known counts", () => {
    expect(unknownLastWindow(100, 0, 24)).toEqual({ known: { skip: 0, take: 24 }, unknown: { skip: 0, take: 0 } });
  });

  it("splits a page that straddles the boundary", () => {
    // 30 known: page 2 of 24 is known rows 24..29, then unknown rows 0..17.
    expect(unknownLastWindow(30, 24, 24)).toEqual({ known: { skip: 24, take: 6 }, unknown: { skip: 0, take: 18 } });
  });

  it("reads a page that lies wholly among the unknowns", () => {
    expect(unknownLastWindow(30, 48, 24)).toEqual({ known: { skip: 30, take: 0 }, unknown: { skip: 18, take: 24 } });
  });

  it("covers every row exactly once across consecutive pages", () => {
    const known = 37;
    const total = 100;
    const seen: string[] = [];
    for (let skip = 0; skip < total; skip += 24) {
      const w = unknownLastWindow(known, skip, 24);
      for (let i = 0; i < w.known.take; i++) seen.push(`k${w.known.skip + i}`);
      for (let i = 0; i < Math.min(w.unknown.take, total - known - w.unknown.skip); i++) seen.push(`u${w.unknown.skip + i}`);
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen.slice(0, known).every((x) => x.startsWith("k"))).toBe(true);
  });
});

describe("splitByKnownFollowers", () => {
  it("keeps the caller's filter, org included, on both segments", () => {
    const where = { orgId: "org-1", deletedAt: null };
    const split = splitByKnownFollowers(where);
    expect(split.known).toEqual({ AND: [where, KNOWN_FOLLOWERS] });
    expect(split.unknown).toEqual({ AND: [where, { NOT: KNOWN_FOLLOWERS }] });
  });

  it("treats only a positive count as known", () => {
    expect(KNOWN_FOLLOWERS).toEqual({ followersCount: { gt: 0 } });
  });
});

describe("pinsUnknownLast", () => {
  it("applies to followers in both directions and nothing else", () => {
    expect(pinsUnknownLast({ key: "followers", dir: "asc" })).toBe(true);
    expect(pinsUnknownLast({ key: "followers", dir: "desc" })).toBe(true);
    expect(pinsUnknownLast({ key: "posts", dir: "asc" })).toBe(false);
  });
});
