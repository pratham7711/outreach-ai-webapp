/**
 * @jest-environment node
 *
 * Write routes a VIEWER could write to.
 *
 * VIEWER is the read-only seat — rbac.ts gives it `*:read` and nothing else,
 * and the product sells it as read-only. Five collection endpoints took only
 * `authenticateRequest`, so a VIEWER could create clients, creators, creator
 * lists, campaign folders, and a self-serve campaign that commits a budget.
 *
 * The GETs alongside them stay open to every member; only the writes are
 * gated, each on the closest key rbac.ts already defines:
 *   clients, folders, self-serve campaigns → campaigns:create
 *   creators, creator lists               → creators:create
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    client: { create: jest.fn(), findMany: jest.fn() },
    creator: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    creatorList: { create: jest.fn(), findMany: jest.fn() },
    folder: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    campaign: { create: jest.fn(), groupBy: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn(() => "127.0.0.1") }));

import { POST as CLIENTS_POST, GET as CLIENTS_GET } from "@/app/api/clients/route";
import { POST as CREATORS_POST } from "@/app/api/creators/route";
import { POST as LISTS_POST, GET as LISTS_GET } from "@/app/api/lists/route";
import { POST as FOLDERS_POST } from "@/app/api/folders/route";
import { POST as SELF_SERVE_POST } from "@/app/api/campaigns/self-serve/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const as = (role: string | null) =>
  mockAuth.mockResolvedValue({
    user: { id: "u-1", orgId: "org-1", email: "who@acme.test", ...(role ? { role } : {}) },
  });

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

/** Every write here, with the model whose create() must not be reached. */
const WRITES = [
  {
    name: "POST /api/clients",
    permission: "campaigns:create",
    call: () => CLIENTS_POST(post("/api/clients", { name: "Acme" })),
    model: () => mockDb.client.create,
  },
  {
    name: "POST /api/creators",
    permission: "creators:create",
    call: () => CREATORS_POST(post("/api/creators", { name: "Ada", handle: "@ada" })),
    model: () => mockDb.creator.create,
  },
  {
    name: "POST /api/lists",
    permission: "creators:create",
    call: () => LISTS_POST(post("/api/lists", { name: "Shortlist" })),
    model: () => mockDb.creatorList.create,
  },
  {
    name: "POST /api/folders",
    permission: "campaigns:create",
    call: () => FOLDERS_POST(post("/api/folders", { name: "Q3" })),
    model: () => mockDb.folder.create,
  },
  {
    name: "POST /api/campaigns/self-serve",
    permission: "campaigns:create",
    call: () =>
      SELF_SERVE_POST(
        post("/api/campaigns/self-serve", { title: "Launch", creatorIds: ["cr-1"] })
      ),
    model: () => mockDb.campaign.create,
  },
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.folder.findFirst.mockResolvedValue(null);
  mockDb.creator.findMany.mockResolvedValue([{ id: "cr-1", rate: 100 }]);
  mockDb.$transaction.mockImplementation((fn: any) => fn(mockDb));
  /* The allowed cases run past the gate into the real handler, which audits
     what it created — so every create has to answer with a row. */
  for (const create of [
    mockDb.client.create,
    mockDb.creator.create,
    mockDb.creatorList.create,
    mockDb.folder.create,
    mockDb.campaign.create,
  ]) {
    create.mockImplementation(async ({ data }: any) => ({ id: "new-1", ...data }));
  }
});

describe("a VIEWER", () => {
  it.each(WRITES.map((w) => [w.name, w] as const))(
    "cannot %s, and nothing is written",
    async (_name, write) => {
      as("VIEWER");
      const res = await write.call();
      expect(res.status).toBe(403);
      expect(write.model()).not.toHaveBeenCalled();
    }
  );
});

describe("a MEMBER, who holds both create keys", () => {
  it.each(WRITES.map((w) => [w.name, w] as const))(
    "is not refused at the gate for %s",
    async (_name, write) => {
      as("MEMBER");
      const res = await write.call();
      expect(res.status).not.toBe(403);
    }
  );
});

describe("nobody at all", () => {
  it.each(WRITES.map((w) => [w.name, w] as const))(
    "gets a 401 rather than a 403 from %s",
    async (_name, write) => {
      mockAuth.mockResolvedValue(null);
      const res = await write.call();
      expect(res.status).toBe(401);
    }
  );
});

describe("the reads alongside them", () => {
  it("still answer a VIEWER, because reading is the whole seat", async () => {
    as("VIEWER");
    mockDb.client.findMany.mockResolvedValue([]);
    mockDb.creatorList.findMany.mockResolvedValue([]);
    expect((await CLIENTS_GET(new NextRequest("http://localhost/api/clients"))).status).toBe(200);
    expect((await LISTS_GET(new NextRequest("http://localhost/api/lists"))).status).toBe(200);
  });
});
