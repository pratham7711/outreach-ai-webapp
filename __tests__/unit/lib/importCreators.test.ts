/**
 * @jest-environment node
 */
import type { ImportLink, ImportPerson } from "@/lib/creators/importParse";

/* An in-memory stand-in for exactly the queries planImport/applyImport make,
   so a second import can be run against what the first one wrote. All data
   is synthetic. */
type Row = Record<string, any>;
const store: { creator: Row[]; link: Row[]; detail: Row[]; tagDef: Row[]; tagLink: Row[] } = {
  creator: [], link: [], detail: [], tagDef: [], tagLink: [],
};
let seq = 0;
const bare = (h: string) => h.replace(/^@+/, "").toLowerCase();
const matchesOr = (row: Row, or: Row[] | undefined) =>
  !or || or.some((c) => c.platform === row.platform && c.handle.in.some((h: string) =>
    c.handle.mode === "insensitive" ? h.toLowerCase() === row.handle.toLowerCase() : h === row.handle));

const fake: any = {
  creatorProfileLink: {
    findMany: jest.fn(async ({ where }: any) =>
      store.link.filter((l) => {
        const owner = store.creator.find((c) => c.id === l.creatorId)!;
        return l.orgId === where.orgId && owner.deletedAt === null && matchesOr(l, where.OR);
      })),
    createMany: jest.fn(async ({ data }: any) => {
      let count = 0;
      for (const d of data) {
        if (store.link.some((l) => l.orgId === d.orgId && l.platform === d.platform && l.handle === d.handle)) continue;
        store.link.push({ id: `link-${++seq}`, ...d });
        count++;
      }
      return { count };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const l = store.link.find((x) => x.id === where.id && x.orgId === where.orgId && x.creatorId === where.creatorId);
      if (!l) throw new Error("update: no such link for this creator in org");
      Object.assign(l, data);
      return l;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = store.link.length;
      store.link = store.link.filter((l) => {
        const owner = store.creator.find((c) => c.id === l.creatorId)!;
        return !(l.orgId === where.orgId && owner.deletedAt !== null && matchesOr(l, where.OR));
      });
      return { count: before - store.link.length };
    }),
  },
  creator: {
    findMany: jest.fn(async ({ where }: any) => {
      if (where.id) {
        return store.creator
          .filter((c) => where.id.in.includes(c.id) && c.orgId === where.orgId)
          .map((c) => ({
            ...c,
            profileLinks: store.link.filter((l) => l.creatorId === c.id),
            detail: store.detail.find((d) => d.creatorId === c.id) ?? null,
            tagLinks: store.tagLink.filter((t) => t.creatorId === c.id).map((t) => ({ tag: store.tagDef.find((d) => d.id === t.tagId) })),
          }));
      }
      return store.creator.filter((c) => c.orgId === where.orgId && c.deletedAt === null && matchesOr(c, where.OR));
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) store.creator.push({ deletedAt: null, rate: null, contactEmail: null, ...d });
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const c = store.creator.find((x) => x.id === where.id && x.orgId === where.orgId);
      if (!c) throw new Error("update: no such creator in org");
      Object.assign(c, data);
      return c;
    }),
  },
  creatorDetail: {
    createMany: jest.fn(async ({ data }: any) => {
      store.detail.push(...data);
      return { count: data.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      store.detail.push(data);
      return data;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const d = store.detail.find((x) => x.creatorId === where.creatorId && x.orgId === where.orgId);
      if (!d) throw new Error("update: no such detail in org");
      Object.assign(d, data);
      return d;
    }),
  },
  creatorTagDef: {
    findMany: jest.fn(async ({ where }: any) => store.tagDef.filter((d) => d.orgId === where.orgId)),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) {
        if (!store.tagDef.some((t) => t.orgId === d.orgId && t.name === d.name)) store.tagDef.push({ id: `tag-${++seq}`, ...d });
      }
      return { count: data.length };
    }),
  },
  creatorTagLink: {
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) {
        if (!store.tagLink.some((t) => t.creatorId === d.creatorId && t.tagId === d.tagId)) store.tagLink.push(d);
      }
      return { count: data.length };
    }),
  },
  $transaction: jest.fn(async (fn: any) => fn(fake)),
};

// A getter, because jest.mock is hoisted above the fake it hands out.
jest.mock("@/lib/db", () => ({
  get db() {
    return fake;
  },
}));

import { applyImport, planImport } from "@/lib/creators/importCreators";

/* Counts ride along the way an older caller's sheet would have carried them,
   so every test below also shows that none of them is ever written. */
function link(platform: ImportLink["platform"], handle: string, followersCount: number | null = 1000): ImportLink {
  return { platform, handle, url: `https://example.com/${handle}`, followersCount, averageViews: 100 } as ImportLink;
}
function person(over: Partial<ImportPerson> = {}): ImportPerson {
  return {
    rows: [2],
    name: "Aki Edits",
    email: "aki@example.com",
    country: "Brazil",
    audienceCountry: "United States",
    niche: "anime edits",
    tags: ["Anime"],
    rate: 25,
    signedUpAt: new Date("2026-01-01T00:00:00Z"),
    links: [link("TIKTOK", "akiedits", 50000), link("INSTAGRAM", "aki.edits", 3000)],
    ...over,
  };
}
function legacyCreator(over: Row = {}) {
  const c = {
    id: `c-${++seq}`, orgId: "org-1", name: "@akiedits", handle: "@AkiEdits", platform: "TIKTOK",
    followersCount: 0, averageViews: 0, contactEmail: null, rate: null, deletedAt: null, ...over,
  };
  store.creator.push(c);
  return c;
}

beforeEach(() => {
  store.creator = []; store.link = []; store.detail = []; store.tagDef = []; store.tagLink = [];
  jest.clearAllMocks();
});

describe("planImport + applyImport", () => {
  it("creates one creator per person, every account a link, TikTok primary", async () => {
    const plan = await planImport("org-1", [person()], ["LKM"]);
    expect(plan.people[0].action).toBe("create");
    expect(plan.newTags).toEqual(["Anime", "LKM"]);

    const counts = await applyImport("org-1", plan, "Sign-up form");
    expect(counts).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(store.creator).toEqual([
      expect.objectContaining({ orgId: "org-1", name: "Aki Edits", handle: "@akiedits", platform: "TIKTOK", rate: 25 }),
    ]);
    // Figures come from the platforms: nothing from the sheet is written.
    expect(store.creator[0]).not.toHaveProperty("followersCount");
    expect(store.creator[0]).not.toHaveProperty("averageViews");
    for (const l of store.link) {
      expect(l).not.toHaveProperty("followersCount");
      expect(l).not.toHaveProperty("averageViews");
    }
    expect(store.link.map((l) => [l.platform, l.handle, l.isPrimary])).toEqual([
      ["TIKTOK", "akiedits", true],
      ["INSTAGRAM", "aki.edits", false],
    ]);
    expect(store.detail[0]).toMatchObject({ audienceCountry: "United States", source: "Sign-up form" });
    expect(store.tagLink).toHaveLength(2);
  });

  it("is a no-op the second time", async () => {
    await applyImport("org-1", await planImport("org-1", [person()]), "x");
    const again = await planImport("org-1", [person()]);
    expect(again.people[0]).toMatchObject({ action: "unchanged", changes: [] });
    expect(await applyImport("org-1", again, "x")).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(store.creator).toHaveLength(1);
    expect(store.link).toHaveLength(2);
  });

  it("fills a hand-made creator's blanks and never overwrites what is set", async () => {
    const c = legacyCreator({ contactEmail: "agency-typed@example.com", rate: 99 });
    const plan = await planImport("org-1", [person()]);
    expect(plan.people[0]).toMatchObject({ action: "update", creatorId: c.id });
    expect(plan.people[0].changes).toEqual(
      expect.arrayContaining(["adds Instagram", "fills name", "adds details", "adds 1 tag"]),
    );
    expect(plan.people[0].changes).not.toContain("fills followers");
    await applyImport("org-1", plan, "x");
    expect(store.creator).toHaveLength(1);
    // A stored 0 stays 0 (shown as "—" until a read): the sheet's 50,000 is not taken.
    expect(store.creator[0]).toMatchObject({ name: "Aki Edits", contactEmail: "agency-typed@example.com", rate: 99, followersCount: 0 });
    // Its own account becomes the primary link.
    expect(store.link.find((l) => l.platform === "TIKTOK")).toMatchObject({ creatorId: c.id, isPrimary: true });
  });

  it("does not offer the handle back as a name", async () => {
    legacyCreator();
    for (const name of ["@AkiEdits", "AKIEDITS", "akiedits"]) {
      const plan = await planImport("org-1", [person({ name })]);
      expect(plan.people[0].fill.name).toBeUndefined();
      expect(plan.people[0].changes).not.toContain("fills name");
    }
  });

  it("keeps a real name the agency gave", async () => {
    legacyCreator({ name: "Aki (priority)" });
    const plan = await planImport("org-1", [person()]);
    expect(plan.people[0].fill.name).toBeUndefined();
  });

  it("never matches another org's creator", async () => {
    legacyCreator({ orgId: "org-2" });
    const plan = await planImport("org-1", [person()]);
    expect(plan.people[0].action).toBe("create");
    await applyImport("org-1", plan, "x");
    expect(store.creator.filter((c) => c.orgId === "org-2")[0]).toMatchObject({ name: "@akiedits", followersCount: 0 });
  });

  it("does not steal an account that already belongs to someone else", async () => {
    const other = legacyCreator({ name: "Someone", handle: "@aki.edits", platform: "INSTAGRAM" });
    await applyImport("org-1", await planImport("org-1", [person({ links: [link("TIKTOK", "akiedits")] })]), "x");
    const plan = await planImport("org-1", [person()]);
    expect(plan.people[0].addLinks).toEqual([]);
    await applyImport("org-1", plan, "x");
    expect(store.link.some((l) => l.creatorId === other.id)).toBe(false);
  });

  it("gives a returning creator the accounts a deleted one still held", async () => {
    const gone = legacyCreator({ deletedAt: new Date() });
    store.link.push({ id: "old", creatorId: gone.id, orgId: "org-1", platform: "TIKTOK", handle: "akiedits" });
    const plan = await planImport("org-1", [person()]);
    expect(plan.people[0].action).toBe("create");
    await applyImport("org-1", plan, "x");
    const fresh = store.creator.find((c) => c.deletedAt === null)!;
    expect(store.link.filter((l) => l.creatorId === fresh.id).map((l) => l.platform)).toEqual(["TIKTOK", "INSTAGRAM"]);
  });

  describe("correcting what the first import misread", () => {
    // What the first import's parser made of the row, and what today's makes of it.
    const misread = () =>
      person({ name: "aki@example.com", audienceCountry: "IndonÉSia", links: [link("TIKTOK", "akiedits", 17), link("INSTAGRAM", "aki.edits", null)] });
    const reread = () =>
      person({ name: "akiedits", audienceCountry: "Indonesia", links: [link("TIKTOK", "akiedits", 17300), link("INSTAGRAM", "aki.edits", 284000)] });

    beforeEach(async () => {
      await applyImport("org-1", await planImport("org-1", [misread()]), "Sign-up form");
    });

    it("corrects each value still exactly as that import wrote it, and says before → after", async () => {
      const plan = await planImport("org-1", [reread()], [], [misread()]);
      expect(plan.people[0].action).toBe("correct");
      expect(plan.people[0].corrections).toEqual([
        "name “aki@example.com” → “akiedits”",
        "audience country “IndonÉSia” → “Indonesia”",
      ]);
      // Counts are neither corrected nor filled: the platform's read owns them.
      expect(plan.people[0].changes.some((c) => /followers|views/.test(c))).toBe(false);

      expect(await applyImport("org-1", plan, "x")).toMatchObject({ created: 0, updated: 0, corrected: 1 });
      expect(store.creator[0]).toMatchObject({ name: "akiedits" });
      expect(store.creator[0]).not.toHaveProperty("followersCount");
      expect(store.link.map((l) => [l.platform, l.followersCount])).toEqual([
        ["TIKTOK", undefined],
        ["INSTAGRAM", undefined],
      ]);
      expect(store.detail[0].audienceCountry).toBe("Indonesia");

      const again = await planImport("org-1", [reread()], [], [misread()]);
      expect(again.people[0]).toMatchObject({ action: "unchanged", corrections: [], changes: [] });
    });

    it("leaves a value alone once anyone has changed it", async () => {
      // A live refresh fetched the real count; the agency typed the audience.
      Object.assign(store.creator[0], { followersCount: 18000 });
      Object.assign(store.link.find((l) => l.platform === "TIKTOK")!, { followersCount: 18000 });
      Object.assign(store.detail[0], { audienceCountry: "Indonesia, Malaysia" });
      Object.assign(store.creator[0], { name: "Aki (priority)" });

      const plan = await planImport("org-1", [reread()], [], [misread()]);
      expect(plan.people[0].corrections).toEqual([]);
      await applyImport("org-1", plan, "x");
      expect(store.creator[0]).toMatchObject({ name: "Aki (priority)", followersCount: 18000 });
      expect(store.link.find((l) => l.platform === "TIKTOK")!.followersCount).toBe(18000);
      expect(store.detail[0].audienceCountry).toBe("Indonesia, Malaysia");
    });

    it("never overwrites a set value without the first reading to compare against", async () => {
      const plan = await planImport("org-1", [reread()]);
      expect(plan.people[0].corrections).toEqual([]);
      expect(plan.people[0].fill).not.toHaveProperty("followersCount");
    });
  });

  it("reuses an existing tag whatever its case", async () => {
    store.tagDef.push({ id: "t-anime", orgId: "org-1", name: "anime" });
    const plan = await planImport("org-1", [person()]);
    expect(plan.newTags).toEqual([]);
    await applyImport("org-1", plan, "x");
    expect(store.tagDef).toHaveLength(1);
    expect(store.tagLink[0].tagId).toBe("t-anime");
  });
});
