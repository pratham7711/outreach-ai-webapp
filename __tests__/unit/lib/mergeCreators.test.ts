jest.mock("@/lib/db", () => ({ db: {} }));

import { planMerge, type MergeSide } from "@/lib/creators/mergeCreators";

function side(over: Partial<MergeSide> = {}): MergeSide {
  return {
    id: "keep",
    name: "Synth Keeper",
    handle: "@synthkeep",
    platform: "TIKTOK",
    contactEmail: null,
    rate: null,
    boostRate: null,
    bio: null,
    paymentInfo: null,
    notes: null,
    niches: [],
    trackedSince: null,
    creatorUserId: null,
    links: [],
    detail: null,
    activations: [],
    tagIds: [],
    flagIds: [],
    lists: [],
    socialAccounts: [],
    ...over,
  };
}

const plan = (keep: MergeSide, drop: MergeSide) => {
  const r = planMerge(keep, drop);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
};

describe("planMerge", () => {
  it("refuses a creator merged into itself", () => {
    expect(planMerge(side(), side())).toEqual({ ok: false, error: expect.stringMatching(/itself/) });
  });

  it("refuses two different portal identities", () => {
    const r = planMerge(side({ creatorUserId: "cu-1" }), side({ id: "drop", creatorUserId: "cu-2" }));
    expect(r.ok).toBe(false);
  });

  it("keeps the kept creator's values and fills only its blanks", () => {
    const p = plan(
      side({ contactEmail: "keep@example.com", rate: null }),
      side({ id: "drop", name: "Synth Other", contactEmail: "drop@example.com", rate: 15, bio: "edits", paymentInfo: "paypal" }),
    );
    expect(p.creator).toEqual({ rate: 15, bio: "edits", paymentInfo: "paypal" });
    expect(p.filled).toEqual(["rate", "bio", "paymentInfo"]);
  });

  it("takes the duplicate's name only when the kept one is just its handle", () => {
    expect(plan(side({ name: "synthkeep" }), side({ id: "drop", name: "Synth Person", handle: "Synth Display" })).creator).toMatchObject({ name: "Synth Person" });
    expect(plan(side(), side({ id: "drop", name: "Synth Person", handle: "@x" })).creator).not.toHaveProperty("name");
    // A display-name record whose name is its handle names no one.
    expect(plan(side({ name: "synthkeep" }), side({ id: "drop", name: "synth display", handle: "synth display" })).creator).not.toHaveProperty("name");
  });

  it("appends the duplicate's notes instead of losing them, once", () => {
    expect(plan(side({ notes: "Quoted $10" }), side({ id: "drop", notes: "Prefers email" })).creator.notes).toBe("Quoted $10\n\nPrefers email");
    expect(plan(side({ notes: "Quoted $10" }), side({ id: "drop", notes: "Quoted $10" })).creator).not.toHaveProperty("notes");
    expect(plan(side(), side({ id: "drop", notes: "Prefers email" })).creator.notes).toBe("Prefers email");
  });

  it("unions niches and keeps the earliest watchlist date", () => {
    const early = new Date("2026-01-01"), late = new Date("2026-06-01");
    const p = plan(side({ niches: ["MUSIC"], trackedSince: late }), side({ id: "drop", niches: ["MUSIC", "TECH"], trackedSince: early }));
    expect(p.creator).toMatchObject({ niches: ["MUSIC", "TECH"], trackedSince: early });
  });

  it("carries the portal identity over when only the duplicate has one", () => {
    expect(plan(side(), side({ id: "drop", creatorUserId: "cu-1" })).creator).toMatchObject({ creatorUserId: "cu-1" });
  });

  it("moves the duplicate's accounts as secondary ones, never replacing the kept primary", () => {
    const p = plan(
      side({ links: [{ id: "k1", platform: "TIKTOK", handle: "synthkeep", isPrimary: true }] }),
      side({ id: "drop", links: [{ id: "d1", platform: "INSTAGRAM", handle: "synthkeep.ig", isPrimary: true }] }),
    );
    expect(p.links).toEqual([{ id: "d1", isPrimary: false }]);
  });

  it("lets a moved account stay primary only when it is the kept creator's own account", () => {
    const drop = side({
      id: "drop",
      links: [
        { id: "d1", platform: "TIKTOK", handle: "synthkeep", isPrimary: true },
        { id: "d2", platform: "INSTAGRAM", handle: "synthkeep.ig", isPrimary: false },
      ],
    });
    expect(plan(side(), drop).links).toEqual([{ id: "d1", isPrimary: true }, { id: "d2", isPrimary: false }]);
    expect(plan(side({ handle: "@someoneelse" }), drop).links).toEqual([{ id: "d1", isPrimary: false }, { id: "d2", isPrimary: false }]);
  });

  it("moves the detail row when the kept creator has none, else fills its blanks", () => {
    const detail = { country: "Brazil", audienceCountry: "Brazil", niche: "Anime", source: "Sign-up", signedUpAt: new Date("2026-02-01") };
    expect(plan(side(), side({ id: "drop", detail })).detail).toEqual({ move: true });
    const kept = { country: "Peru", audienceCountry: null, niche: null, source: null, signedUpAt: new Date("2026-03-01") };
    expect(plan(side({ detail: kept }), side({ id: "drop", detail })).detail).toEqual({
      fill: { audienceCountry: "Brazil", niche: "Anime", source: "Sign-up", signedUpAt: detail.signedUpAt },
    });
  });

  it("folds an activation on a campaign both are on, and moves the rest", () => {
    const p = plan(
      side({ activations: [{ id: "ka", campaignId: "camp-1" }] }),
      side({ id: "drop", activations: [{ id: "da", campaignId: "camp-1" }, { id: "db", campaignId: "camp-2" }] }),
    );
    expect(p.activations).toEqual({ move: ["db"], fold: [{ from: "da", into: "ka" }] });
  });

  it("adds only the tags, flags, lists and connected accounts the kept creator lacks", () => {
    const at = new Date("2026-04-01");
    const p = plan(
      side({ tagIds: ["t1"], flagIds: ["f1"], lists: [{ listId: "l1", addedAt: at }], socialAccounts: [{ id: "s1", platform: "TIKTOK", platformUserId: "u1" }] }),
      side({
        id: "drop",
        tagIds: ["t1", "t2"],
        flagIds: ["f1", "f2"],
        lists: [{ listId: "l1", addedAt: at }, { listId: "l2", addedAt: at }],
        socialAccounts: [{ id: "s2", platform: "TIKTOK", platformUserId: "u1" }, { id: "s3", platform: "INSTAGRAM", platformUserId: "u2" }],
      }),
    );
    expect(p.tagIds).toEqual(["t2"]);
    expect(p.flagIds).toEqual(["f2"]);
    expect(p.lists).toEqual([{ listId: "l2", addedAt: at }]);
    expect(p.socialAccountIds).toEqual(["s3"]);
  });
});
