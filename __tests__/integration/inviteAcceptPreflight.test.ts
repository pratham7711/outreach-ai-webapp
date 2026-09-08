/**
 * @jest-environment node
 *
 * The public end of the invite flow.
 *
 * Three things were wrong with it. The accept endpoint was unauthenticated by
 * design and had no rate limit, so the only thing between a stranger and a
 * workspace was one token guessed at whatever rate they liked. That token came
 * from the schema default, `cuid()` — sortable and timestamp-seeded, not a
 * secret. And the page had no way to ask whether a link was still good, so an
 * expired or already-used invitation rendered the full form and only failed
 * after the reader had chosen a password.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    userInvite: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    user: { findUnique: jest.fn(), count: jest.fn() },
    organization: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), emailConfigured: jest.fn(() => true) }));
jest.mock("@/lib/inviteEmail", () => ({
  sendInviteEmail: jest.fn(async () => ({ sent: true })),
}));
jest.mock("bcryptjs", () => ({ hash: jest.fn(async () => "hashed") }));

import { GET as PREFLIGHT, POST as ACCEPT } from "@/app/api/invites/accept/route";
import { POST as CREATE_INVITE } from "@/app/api/invites/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const soon = new Date(Date.now() + 864e5);

/* The limiter buckets by IP and its state is module-level, so each test gets
   its own address rather than sharing a bucket with its neighbours. */
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

const preflight = (token: string, ip = nextIp()) =>
  PREFLIGHT(
    new NextRequest(`http://localhost/api/invites/accept?token=${encodeURIComponent(token)}`, {
      headers: { "x-real-ip": ip },
    })
  );

const accept = (body: unknown, ip = nextIp()) =>
  ACCEPT(
    new NextRequest("http://localhost/api/invites/accept", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-real-ip": ip },
    })
  );

const invite = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  orgId: "org-1",
  email: "new@person.test",
  role: "ADMIN",
  token: "valid-token",
  expiresAt: soon,
  acceptedAt: null,
  organization: { name: "Acme Inc", brandName: "Acme" },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.userInvite.findUnique.mockResolvedValue(invite());
  mockDb.user.findUnique.mockResolvedValue(null);
});

// ─── GET /api/invites/accept ─────────────────────────────────────────────────

describe("the preflight", () => {
  it("describes a live invitation in the four facts the page shows", async () => {
    const res = await preflight("valid-token");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      orgName: "Acme",
      role: "ADMIN",
      email: "new@person.test",
      expiresAt: soon.toISOString(),
    });
  });

  it("leaks nothing else — no id, no orgId, no token echo", async () => {
    const body = await (await preflight("valid-token")).json();
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("orgId");
    expect(body).not.toHaveProperty("token");
  });

  it("is a 404 for a token that matches nothing", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(null);
    expect((await preflight("nope")).status).toBe(404);
  });

  it("is a 404 with no token at all, rather than a 500", async () => {
    expect((await preflight("")).status).toBe(404);
    expect(mockDb.userInvite.findUnique).not.toHaveBeenCalled();
  });

  it("is a 410 for one already used, and says to sign in instead", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(invite({ acceptedAt: new Date() }));
    const res = await preflight("valid-token");
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/already been used/i);
  });

  it("is a 410 for an expired one, and says to ask for a new link", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(
      invite({ expiresAt: new Date(Date.now() - 1000) })
    );
    const res = await preflight("valid-token");
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/expired/i);
  });

  it("falls back to the legal name when the org has no brand name", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(
      invite({ organization: { name: "Acme Inc", brandName: null } })
    );
    expect((await (await preflight("valid-token")).json()).orgName).toBe("Acme Inc");
  });
});

// ─── The rate limit ──────────────────────────────────────────────────────────

describe("the rate limit", () => {
  it("refuses the eleventh guess from one address within the window", async () => {
    const ip = nextIp();
    mockDb.userInvite.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 10; i++) {
      expect((await preflight(`guess-${i}`, ip)).status).toBe(404);
    }
    const res = await preflight("guess-10", ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("counts POST attempts against the same budget as GET", async () => {
    const ip = nextIp();
    mockDb.userInvite.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 10; i++) {
      await preflight(`g-${i}`, ip);
    }
    const res = await accept({ token: "x", name: "N", password: "password1" }, ip);
    expect(res.status).toBe(429);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("does not punish a different address", async () => {
    const ip = nextIp();
    mockDb.userInvite.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 11; i++) await preflight(`g-${i}`, ip);
    expect((await preflight("g-0", nextIp())).status).toBe(404);
  });
});

// ─── The token itself ────────────────────────────────────────────────────────

describe("the token an invite is created with", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({
      user: { id: "u-1", orgId: "org-1", email: "owner@acme.test", role: "OWNER" },
    });
    mockDb.userInvite.findFirst.mockResolvedValue(null);
    mockDb.organization.findUnique.mockResolvedValue({ name: "Acme", brandName: "Acme" });
    mockDb.userInvite.create.mockImplementation(async ({ data }: any) => ({
      id: "inv-1",
      ...data,
    }));
  });

  it("is 64 hex characters from the CSPRNG, not the cuid() schema default", async () => {
    const res = await CREATE_INVITE(
      new NextRequest("http://localhost/api/invites", {
        method: "POST",
        body: JSON.stringify({ email: "new@person.test", role: "MEMBER" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const token = mockDb.userInvite.create.mock.calls[0][0].data.token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs between two invitations", async () => {
    const make = () =>
      CREATE_INVITE(
        new NextRequest("http://localhost/api/invites", {
          method: "POST",
          body: JSON.stringify({ email: "a@person.test" }),
          headers: { "Content-Type": "application/json" },
        })
      );
    await make();
    await make();
    const [a, b] = mockDb.userInvite.create.mock.calls.map((c: any) => c[0].data.token);
    expect(a).not.toBe(b);
  });
});
