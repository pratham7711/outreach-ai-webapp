/**
 * @jest-environment node
 *
 * Campaign templates end to end through the routes: what a setup is (and is
 * not), whose rows a caller can reach, and what POST /api/campaigns writes
 * when it starts from a template or a past campaign.
 *
 * The database is an in-memory store that evaluates each `where` it is handed
 * -- org, deletedAt and the member's row scope -- so "another org's template
 * is a 404" is the route's own filter doing it, not a mock told to say so.
 * Permissions are the real ones (lib/authz over lib/rbac).
 */
type Row = Record<string, any>;

jest.mock("@/lib/db", () => {
  const store: Record<string, Row[]> = {};
  const failing: Record<string, Error | undefined> = {};
  let seq = 0;

  const matches = (row: Row, where: Row | undefined): boolean => {
    for (const [key, want] of Object.entries(where ?? {})) {
      if (key === "OR") {
        if (!(want as Row[]).some((w) => matches(row, w))) return false;
        continue;
      }
      if (key === "AND") {
        if (!(want as Row[]).every((w) => matches(row, w))) return false;
        continue;
      }
      const have = row[key];
      if (want === null) {
        if (have !== null && have !== undefined) return false;
      } else if (typeof want === "object" && !(want instanceof Date)) {
        if ("some" in want) {
          if (!((have as Row[] | undefined) ?? []).some((r) => matches(r, want.some))) return false;
        } else if ("in" in want) {
          if (!want.in.includes(have)) return false;
        } else if ("contains" in want) {
          if (!String(have ?? "").toLowerCase().includes(String(want.contains).toLowerCase())) return false;
        } else {
          throw new Error(`fake db: unsupported filter on ${key}: ${JSON.stringify(want)}`);
        }
      } else if (have !== want) {
        return false;
      }
    }
    return true;
  };

  const project = (row: Row, select: Row | undefined): Row => {
    if (!select) return { ...row };
    const out: Row = {};
    for (const [key, how] of Object.entries(select)) {
      if (how === true) {
        out[key] = row[key];
      } else if (how && typeof how === "object") {
        const nested = row[key];
        if (Array.isArray(nested)) {
          let list = nested.filter((r) => matches(r, how.where));
          const order = how.orderBy as Record<string, "asc" | "desc"> | undefined;
          if (order) {
            const [[field, dir]] = Object.entries(order);
            list = [...list].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (dir === "desc" ? -1 : 1));
          }
          out[key] = list.map((r) => project(r, how.select));
        } else {
          out[key] = nested === null || nested === undefined ? null : project(nested, how.select);
        }
      }
    }
    return out;
  };

  const model = (name: string) => {
    const rows = () => (store[name] ??= []);
    const guard = () => {
      if (failing[name]) throw failing[name];
    };
    return {
      findFirst: jest.fn(async (args: Row = {}) => {
        guard();
        const row = rows().find((r) => matches(r, args.where));
        return row ? project(row, args.select) : null;
      }),
      findMany: jest.fn(async (args: Row = {}) => {
        guard();
        return rows()
          .filter((r) => matches(r, args.where))
          .slice(0, args.take ?? Infinity)
          .map((r) => project(r, args.select));
      }),
      count: jest.fn(async (args: Row = {}) => {
        guard();
        return rows().filter((r) => matches(r, args.where)).length;
      }),
      create: jest.fn(async (args: Row) => {
        guard();
        const now = new Date();
        const row = { id: `${name}-new-${++seq}`, createdAt: now, updatedAt: now, ...args.data };
        rows().push(row);
        return project(row, args.select);
      }),
      createMany: jest.fn(async (args: Row) => {
        guard();
        for (const data of args.data as Row[]) rows().push({ id: `${name}-new-${++seq}`, ...data });
        return { count: (args.data as Row[]).length };
      }),
      updateMany: jest.fn(async (args: Row) => {
        guard();
        const hit = rows().filter((r) => matches(r, args.where));
        for (const r of hit) Object.assign(r, args.data, { updatedAt: new Date() });
        return { count: hit.length };
      }),
    };
  };

  const db: Row = {};
  for (const name of [
    "campaign",
    "campaignTemplate",
    "campaignRules",
    "campaignPhase",
    "creativeBrief",
    "client",
    "folder",
    "campaignStatusDef",
    "activation",
    "post",
  ]) {
    db[name] = model(name);
  }
  db.$transaction = jest.fn(async (fn: (tx: Row) => unknown) => fn(db));
  return { db, store, failing };
});

const mockAuth: Row = {};
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: async () => mockAuth,
  getAuditActor: () => ({ actorId: "user-a", actorName: "Ana" }),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }));
jest.mock("@/lib/sounds/snapshot", () => ({ primeSongAudio: jest.fn(async () => {}) }));
jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: jest.fn() }));

import { NextRequest } from "next/server";
import { POST as createCampaign } from "@/app/api/campaigns/route";
import { GET as listSources, POST as saveTemplate } from "@/app/api/campaign-templates/route";
import { PATCH as renameTemplate, DELETE as deleteTemplate } from "@/app/api/campaign-templates/[id]/route";
import { GET as readSource } from "@/app/api/campaign-templates/source/route";
import { extractCampaignSetup } from "@/lib/campaigns/templates/setup";
import { alsoCopies, parseSetup, partsPresent, summarise, withParts, type CampaignSetup } from "@/lib/campaigns/templates/payload";

const { db, store, failing } = jest.requireMock("@/lib/db") as {
  db: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
  store: Record<string, Row[]>;
  failing: Record<string, Error | undefined>;
};

const ORG = "org-a";
const OTHER_ORG = "org-b";
const OWNER = { orgId: ORG, userId: "user-a", role: "OWNER", campaignScope: "ALL", actorType: "user" };

const LAUNCH_AT = new Date("2026-12-01T09:00:00Z");
const PHASE_START = new Date("2026-12-05T00:00:00Z");

/** A campaign with everything a campaign can carry, setup and not. */
const sourceCampaign = (): Row => ({
  id: "camp-a",
  orgId: ORG,
  title: "Static Bloom",
  clientId: "cl-a",
  budget: 15000,
  currency: "EUR",
  postApprovalMode: "AUTO_APPROVED",
  notes: "Pay on posting.",
  brief: { content: "<p>Hook in the <strong>first</strong> second.</p>" },
  phases: [
    { name: "Push", sequence: 4, targetPosts: 30, startDate: PHASE_START, endDate: PHASE_START },
    { name: "Teaser", sequence: 2, targetPosts: null, startDate: PHASE_START, endDate: null },
  ],
  activations: [{ id: "act-1", creatorId: "creator-1", orgId: ORG }],
  posts: [{ id: "post-1", url: "https://www.tiktok.com/@someone/video/7400000000000000001" }],
  songId: "song-a",
  thumbnailUrl: "https://cdn.example/static-bloom.jpg",
  folderId: "folder-a",
  status: "IN_PROGRESS",
  ccCampaignId: "cc-123",
  teamMembers: [],
  createdById: "user-a",
  deletedAt: null,
});

const sourceRules = (): Row => ({
  campaignId: "camp-a",
  orgId: ORG,
  dos: ["Show the hook"],
  donts: ["No competitor songs"],
  requiredHashtags: ["#staticbloom"],
  requiredMentions: [],
  minFollowers: 5000,
  maxPostsPerAccount: null,
  viewGoal: null,
  allowExclusions: false,
  allowBoostCodes: true,
  launchAt: LAUNCH_AT,
  examplePostUrls: ["https://www.tiktok.com/@example/video/7400000000000000009"],
});

const SAVED: CampaignSetup = {
  version: 1,
  clientId: "cl-a",
  budget: 8000,
  currency: "GBP",
  postApprovalMode: "AUTO_APPROVED",
  notes: "Template notes.",
  brief: "<p>Template brief.</p>",
  rules: {
    dos: ["Use the chorus"],
    donts: [],
    requiredHashtags: ["#wave"],
    requiredMentions: ["@label"],
    minFollowers: null,
    maxPostsPerAccount: 2,
    viewGoal: 100000,
    allowExclusions: true,
    allowBoostCodes: false,
  },
  phases: [
    { name: "Wave 1", sequence: 1, targetPosts: 20 },
    { name: "Wave 2", sequence: 2, targetPosts: null },
  ],
};

function seed() {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(failing)) delete failing[key];
  store.client = [
    { id: "cl-a", orgId: ORG, name: "Velvet Room Records" },
    { id: "cl-b", orgId: OTHER_ORG, name: "Other Org Records" },
  ];
  store.campaign = [
    sourceCampaign(),
    { ...sourceCampaign(), id: "camp-b", orgId: OTHER_ORG, title: "Theirs", clientId: "cl-b", createdById: "user-b" },
    { ...sourceCampaign(), id: "camp-gone", title: "Deleted", deletedAt: new Date("2026-10-01T00:00:00Z") },
    {
      ...sourceCampaign(),
      id: "camp-team",
      title: "On the team",
      createdById: "user-x",
      teamMembers: [{ userId: "member-1" }],
    },
  ];
  store.campaignRules = [sourceRules(), { ...sourceRules(), campaignId: "camp-b", orgId: OTHER_ORG }];
  store.campaignTemplate = [
    { id: "tpl-a", orgId: ORG, name: "Three waves", description: null, payload: SAVED, createdById: "user-a", deletedAt: null, updatedAt: new Date() },
    { id: "tpl-b", orgId: OTHER_ORG, name: "Theirs", description: null, payload: SAVED, createdById: "user-b", deletedAt: null, updatedAt: new Date() },
    { id: "tpl-gone", orgId: ORG, name: "Deleted", description: null, payload: SAVED, createdById: "user-a", deletedAt: new Date(), updatedAt: new Date() },
    { id: "tpl-v2", orgId: ORG, name: "From the future", description: null, payload: { ...SAVED, version: 2 }, createdById: "user-a", deletedAt: null, updatedAt: new Date() },
  ];
  store.activation = [{ id: "act-1", campaignId: "camp-a", creatorId: "creator-1", orgId: ORG }];
  store.post = [{ id: "post-1", campaignId: "camp-a", orgId: ORG }];
}

const as = (auth: Row) => {
  for (const key of Object.keys(mockAuth)) delete mockAuth[key];
  Object.assign(mockAuth, auth);
};
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const subject = (over: Row = {}) => ({ orgId: ORG, userId: "user-a", role: "OWNER", campaignScope: "ALL" as const, ...over });
const missingTable = (table: string) =>
  Object.assign(new Error(`The table \`public.${table}\` does not exist in the current database.`), { code: "P2021" });

/** Everything created in the campaign-shaped tables after seeding. */
const created = (model: string) => (store[model] ?? []).filter((r) => String(r.id).includes("-new-"));

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  as(OWNER);
});

describe("the setup payload", () => {
  it("leaves out the parts switched off, and the currency goes with the budget", () => {
    const setup = withParts(SAVED, { budget: false, rules: false, notes: false });
    expect(setup).toMatchObject({ clientId: "cl-a", budget: null, currency: null, notes: null, rules: null });
    expect(setup.brief).toBe(SAVED.brief);
    expect(setup.phases).toEqual(SAVED.phases);
    expect(partsPresent(setup)).toEqual(["client", "approval", "brief", "phases"]);
  });

  it("reads only the version it knows", () => {
    expect(parseSetup(SAVED)).toEqual(SAVED);
    expect(parseSetup({ ...SAVED, version: 2 })).toBeNull();
    expect(parseSetup({ ...SAVED, phases: [{ name: "", sequence: 1, targetPosts: null }] })).toBeNull();
    expect(parseSetup(null)).toBeNull();
  });

  it("names only what is there", () => {
    expect(alsoCopies(summarise(SAVED))).toBe("the brief, 6 rules and 2 phases");
    expect(alsoCopies(summarise({ ...SAVED, brief: null, rules: null }))).toBe("2 phases");
    expect(alsoCopies(summarise({ ...SAVED, brief: null, rules: null, phases: [] }))).toBeNull();
  });
});

describe("extractCampaignSetup: the one reading of a campaign's setup", () => {
  it("takes the setup and nothing else: no creators, posts, sound, picture, title, launch date, example posts or phase dates", async () => {
    const found = await extractCampaignSetup(subject(), "camp-a");
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Static Bloom");
    expect(found!.setup).toEqual({
      version: 1,
      clientId: "cl-a",
      budget: 15000,
      currency: "EUR",
      postApprovalMode: "AUTO_APPROVED",
      notes: "Pay on posting.",
      brief: "<p>Hook in the <strong>first</strong> second.</p>",
      rules: {
        dos: ["Show the hook"],
        donts: ["No competitor songs"],
        requiredHashtags: ["#staticbloom"],
        requiredMentions: [],
        minFollowers: 5000,
        maxPostsPerAccount: null,
        viewGoal: null,
        allowExclusions: false,
        allowBoostCodes: true,
      },
      /* In sequence order, renumbered from 1, without their dates. */
      phases: [
        { name: "Teaser", sequence: 1, targetPosts: null },
        { name: "Push", sequence: 2, targetPosts: 30 },
      ],
    });
    const json = JSON.stringify(found!.setup);
    for (const leak of ["creator-1", "act-1", "post-1", "song-a", "static-bloom.jpg", "folder-a", "cc-123", "Static Bloom", "example/video", "2026-12"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("asks the database for setup columns only", async () => {
    await extractCampaignSetup(subject(), "camp-a");
    const { select } = db.campaign.findFirst.mock.calls[0][0];
    expect(Object.keys(select).sort()).toEqual(
      ["brief", "budget", "clientId", "currency", "id", "notes", "phases", "postApprovalMode", "title"].sort(),
    );
    expect(Object.keys(select.phases.select).sort()).toEqual(["name", "sequence", "targetPosts"]);
    const rulesSelect = db.campaignRules.findFirst.mock.calls[0][0].select;
    expect(rulesSelect).not.toHaveProperty("launchAt");
    expect(rulesSelect).not.toHaveProperty("examplePostUrls");
  });

  it("finds nothing in another org, or once the campaign is deleted", async () => {
    expect(await extractCampaignSetup(subject(), "camp-b")).toBeNull();
    expect(await extractCampaignSetup(subject({ orgId: OTHER_ORG, userId: "user-b" }), "camp-a")).toBeNull();
    expect(await extractCampaignSetup(subject(), "camp-gone")).toBeNull();
    expect(db.campaign.findFirst.mock.calls[0][0].where).toMatchObject({ orgId: ORG, deletedAt: null });
  });

  it("keeps an assigned-only member to the campaigns they can open", async () => {
    const member = subject({ userId: "member-1", role: "MEMBER", campaignScope: "ASSIGNED" });
    expect(await extractCampaignSetup(member, "camp-a")).toBeNull();
    expect(await extractCampaignSetup(member, "camp-team")).not.toBeNull();
  });

  it("reads no rules, rather than failing, before the rules table exists", async () => {
    failing.campaignRules = missingTable("CampaignRules");
    const found = await extractCampaignSetup(subject(), "camp-a");
    expect(found!.setup.rules).toBeNull();
    expect(found!.setup.brief).not.toBeNull();
  });

  it("treats an empty brief and blank notes as none", async () => {
    Object.assign(store.campaign[0], { brief: { content: "<p></p>" }, notes: "   " });
    const found = await extractCampaignSetup(subject(), "camp-a");
    expect(found!.setup.brief).toBeNull();
    expect(found!.setup.notes).toBeNull();
  });
});

describe("GET /api/campaign-templates/source", () => {
  const read = (kind: string, id: string) => readSource(req(`/api/campaign-templates/source?kind=${kind}&id=${id}`));

  it("hands back a template of this org, with what else it copies", async () => {
    const res = await read("template", "tpl-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "template", id: "tpl-a", name: "Three waves", setup: SAVED, clientName: "Velvet Room Records", canSave: true });
    expect(body.alsoCopies).toBe("the brief, 6 rules and 2 phases");
  });

  it("is a 404 for another org's template or campaign, and for a deleted one", async () => {
    expect((await read("template", "tpl-b")).status).toBe(404);
    expect((await read("campaign", "camp-b")).status).toBe(404);
    expect((await read("template", "tpl-gone")).status).toBe(404);
    expect((await read("campaign", "camp-gone")).status).toBe(404);
  });

  it("refuses a template saved by a newer version, by name", async () => {
    const res = await read("template", "tpl-v2");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("From the future");
  });

  it("still copies a past campaign before the templates table exists", async () => {
    failing.campaignTemplate = missingTable("CampaignTemplate");
    expect((await read("template", "tpl-a")).status).toBe(404);
    expect((await read("campaign", "camp-a")).status).toBe(200);
  });

  it("says a viewer cannot save", async () => {
    as({ ...OWNER, role: "VIEWER" });
    expect((await (await read("campaign", "camp-a")).json()).canSave).toBe(false);
  });
});

describe("GET /api/campaign-templates", () => {
  it("lists this org's live templates and campaigns, nobody else's", async () => {
    const body = await (await listSources(req("/api/campaign-templates"))).json();
    expect(body.ready).toBe(true);
    expect(body.templates.map((t: Row) => t.id).sort()).toEqual(["tpl-a", "tpl-v2"]);
    expect(body.templates.find((t: Row) => t.id === "tpl-v2").summary).toBeNull();
    expect(body.campaigns.map((c: Row) => c.id).sort()).toEqual(["camp-a", "camp-team"]);
  });

  it("says not ready, and still lists campaigns, before the templates table exists", async () => {
    failing.campaignTemplate = missingTable("CampaignTemplate");
    const body = await (await listSources(req("/api/campaign-templates"))).json();
    expect(body.ready).toBe(false);
    expect(body.templates).toEqual([]);
    expect(body.campaigns.length).toBeGreaterThan(0);
  });
});

describe("POST /api/campaign-templates", () => {
  const save = (body: unknown) => saveTemplate(req("/api/campaign-templates", "POST", body));

  it("saves the setup read from the campaign, in the caller's org whatever the body says", async () => {
    const res = await save({ campaignId: "camp-a", name: "  Static Bloom setup ", orgId: OTHER_ORG, payload: { brief: "<p>forged</p>" } });
    expect(res.status).toBe(201);
    const [row] = created("campaignTemplate");
    expect(row).toMatchObject({ orgId: ORG, name: "Static Bloom setup", description: null, createdById: "user-a" });
    expect(row.payload).toEqual((await extractCampaignSetup(subject(), "camp-a"))!.setup);
    expect(JSON.stringify(row.payload)).not.toContain("forged");
    expect((await res.json()).template.summary).toMatchObject({ brief: true, rules: 5, phases: 2 });
  });

  it("leaves out the parts the person switched off", async () => {
    await save({ campaignId: "camp-a", name: "Brief only", include: { client: false, budget: false, approval: false, notes: false, rules: false, phases: false } });
    const [row] = created("campaignTemplate");
    expect(partsPresent(row.payload)).toEqual(["brief"]);
    expect(row.payload.currency).toBeNull();
  });

  it("refuses a save with every part switched off", async () => {
    const res = await save({
      campaignId: "camp-a",
      name: "Nothing",
      include: { client: false, budget: false, approval: false, notes: false, brief: false, rules: false, phases: false },
    });
    expect(res.status).toBe(400);
    expect(created("campaignTemplate")).toEqual([]);
  });

  it("is a 404 for another org's campaign, and saves nothing", async () => {
    expect((await save({ campaignId: "camp-b", name: "Theirs" })).status).toBe(404);
    expect(created("campaignTemplate")).toEqual([]);
  });

  it("is for whoever may create campaigns: a viewer gets 403", async () => {
    as({ ...OWNER, role: "VIEWER" });
    expect((await save({ campaignId: "camp-a", name: "x" })).status).toBe(403);
    as({ ...OWNER, role: "MEMBER" });
    expect((await save({ campaignId: "camp-a", name: "x" })).status).toBe(201);
  });

  it("says templates are not ready, rather than failing, before the table exists", async () => {
    failing.campaignTemplate = missingTable("CampaignTemplate");
    const res = await save({ campaignId: "camp-a", name: "x" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("templates_not_ready");
  });
});

describe("PATCH and DELETE /api/campaign-templates/[id]", () => {
  it("renames this org's template", async () => {
    const res = await renameTemplate(req("/api/campaign-templates/tpl-a", "PATCH", { name: "Three waves, EU" }), ctx("tpl-a"));
    expect(res.status).toBe(200);
    expect(store.campaignTemplate.find((t) => t.id === "tpl-a")!.name).toBe("Three waves, EU");
  });

  it("is a 404 for another org's template, and leaves it alone", async () => {
    expect((await renameTemplate(req("/api/campaign-templates/tpl-b", "PATCH", { name: "Mine now" }), ctx("tpl-b"))).status).toBe(404);
    expect((await deleteTemplate(req("/api/campaign-templates/tpl-b", "DELETE"), ctx("tpl-b"))).status).toBe(404);
    const theirs = store.campaignTemplate.find((t) => t.id === "tpl-b")!;
    expect(theirs.name).toBe("Theirs");
    expect(theirs.deletedAt).toBeNull();
    for (const call of db.campaignTemplate.updateMany.mock.calls) expect(call[0].where.orgId).toBe(ORG);
  });

  it("deletes softly, after which the template can no longer be started from", async () => {
    expect((await deleteTemplate(req("/api/campaign-templates/tpl-a", "DELETE"), ctx("tpl-a"))).status).toBe(200);
    expect(store.campaignTemplate.find((t) => t.id === "tpl-a")!.deletedAt).toBeInstanceOf(Date);
    expect((await readSource(req("/api/campaign-templates/source?kind=template&id=tpl-a"))).status).toBe(404);
    const res = await createCampaign(req("/api/campaigns", "POST", { title: "Late", setupFrom: { kind: "template", id: "tpl-a" } }));
    expect(res.status).toBe(404);
  });

  it("is for whoever may create campaigns", async () => {
    as({ ...OWNER, role: "VIEWER" });
    expect((await deleteTemplate(req("/api/campaign-templates/tpl-a", "DELETE"), ctx("tpl-a"))).status).toBe(403);
    expect(store.campaignTemplate.find((t) => t.id === "tpl-a")!.deletedAt).toBeNull();
  });
});

describe("POST /api/campaigns with setupFrom", () => {
  const start = (body: Row) => createCampaign(req("/api/campaigns", "POST", { title: "Midnight Static", ...body }));
  const newCampaign = () => created("campaign")[0];

  it("creates the campaign with the template's setup, and its brief, rules and phases in the same transaction", async () => {
    const res = await start({ setupFrom: { kind: "template", id: "tpl-a" } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.setupFrom).toEqual({ kind: "template", id: "tpl-a", copied: { brief: true, rules: true, phases: 2 } });

    expect(newCampaign()).toMatchObject({
      orgId: ORG,
      title: "Midnight Static",
      clientId: "cl-a",
      budget: 8000,
      currency: "GBP",
      postApprovalMode: "AUTO_APPROVED",
      notes: "Template notes.",
      songId: null,
      thumbnailUrl: null,
      folderId: null,
    });
    const id = newCampaign().id;
    expect(created("creativeBrief")).toEqual([expect.objectContaining({ campaignId: id, content: "<p>Template brief.</p>" })]);
    expect(created("campaignRules")).toEqual([
      expect.objectContaining({ campaignId: id, orgId: ORG, ...SAVED.rules, examplePostUrls: [], launchAt: null }),
    ]);
    expect(created("campaignPhase").map((p) => [p.campaignId, p.name, p.sequence, p.targetPosts])).toEqual([
      [id, "Wave 1", 1, 20],
      [id, "Wave 2", 2, null],
    ]);
    expect(created("campaignPhase").every((p) => p.startDate === undefined && p.endDate === undefined)).toBe(true);
    /* All of it inside the one transaction. */
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("copies a past campaign's setup and never its creators or posts", async () => {
    const res = await start({ setupFrom: { kind: "campaign", id: "camp-a" } });
    expect(res.status).toBe(201);
    const id = newCampaign().id;
    expect(newCampaign()).toMatchObject({ title: "Midnight Static", clientId: "cl-a", budget: 15000, currency: "EUR", songId: null, thumbnailUrl: null });
    expect(created("creativeBrief")[0].content).toBe("<p>Hook in the <strong>first</strong> second.</p>");
    expect(created("campaignRules")[0]).toMatchObject({ campaignId: id, minFollowers: 5000, allowBoostCodes: true, launchAt: null, examplePostUrls: [] });
    expect(created("campaignPhase").map((p) => [p.name, p.sequence])).toEqual([
      ["Teaser", 1],
      ["Push", 2],
    ]);
    expect(db.activation.create).not.toHaveBeenCalled();
    expect(db.activation.createMany).not.toHaveBeenCalled();
    expect(db.post.create).not.toHaveBeenCalled();
    expect(db.post.createMany).not.toHaveBeenCalled();
    expect(store.activation.filter((a) => a.campaignId === id)).toEqual([]);
  });

  it("lets the fields the body sends win over the source's, a null included", async () => {
    store.client.push({ id: "cl-a2", orgId: ORG, name: "Kiteline" });
    const res = await start({
      setupFrom: { kind: "template", id: "tpl-a" },
      clientId: "cl-a2",
      budget: 500,
      currency: "INR",
      postApprovalMode: "MANUAL",
      notes: null,
    });
    expect(res.status).toBe(201);
    expect(newCampaign()).toMatchObject({ clientId: "cl-a2", budget: 500, currency: "INR", postApprovalMode: "MANUAL", notes: null });
    expect(created("creativeBrief")).toHaveLength(1);
    expect(created("campaignPhase")).toHaveLength(2);
  });

  it("clears the client when the body says so", async () => {
    await start({ setupFrom: { kind: "template", id: "tpl-a" }, clientId: null });
    expect(newCampaign().clientId).toBeNull();
  });

  it("takes the brief, rules and phases from the server's copy, never from the body", async () => {
    const res = await start({
      setupFrom: { kind: "template", id: "tpl-a" },
      brief: "<p>forged</p>",
      rules: { dos: ["forged"] },
      phases: [{ name: "Forged", sequence: 1, targetPosts: 999 }],
    });
    expect(res.status).toBe(201);
    expect(created("creativeBrief")[0].content).toBe("<p>Template brief.</p>");
    expect(created("campaignRules")[0].dos).toEqual(["Use the chorus"]);
    expect(created("campaignPhase").map((p) => p.name)).toEqual(["Wave 1", "Wave 2"]);
  });

  it("starts unfiled when the template's client is no longer this org's", async () => {
    store.campaignTemplate[0].payload = { ...SAVED, clientId: "cl-b" };
    const res = await start({ setupFrom: { kind: "template", id: "tpl-a" } });
    expect(res.status).toBe(201);
    expect(newCampaign().clientId).toBeNull();
  });

  it("is a 404 for another org's template or campaign, and writes nothing", async () => {
    expect((await start({ setupFrom: { kind: "template", id: "tpl-b" } })).status).toBe(404);
    expect((await start({ setupFrom: { kind: "campaign", id: "camp-b" } })).status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(created("campaign")).toEqual([]);
  });

  it("still creates the campaign, with its brief and phases, before the rules table exists, and says the rules did not copy", async () => {
    failing.campaignRules = missingTable("CampaignRules");
    const res = await start({ setupFrom: { kind: "template", id: "tpl-a" } });
    expect(res.status).toBe(201);
    expect((await res.json()).setupFrom.copied).toEqual({ brief: true, rules: false, phases: 2 });
    expect(created("campaign")).toHaveLength(1);
    expect(created("creativeBrief")).toHaveLength(1);
  });

  it("writes no brief, rules or phases without setupFrom", async () => {
    const res = await start({});
    expect(res.status).toBe(201);
    expect(await res.json()).not.toHaveProperty("setupFrom");
    expect(created("creativeBrief")).toEqual([]);
    expect(created("campaignRules")).toEqual([]);
    expect(created("campaignPhase")).toEqual([]);
  });
});
