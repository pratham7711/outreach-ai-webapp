/**
 * @jest-environment node
 */

/**
 * Who may run the team.
 *
 * Every invite endpoint used to check only that you were signed in. A VIEWER
 * could therefore invite a new OWNER at an address they controlled, and the
 * create response handed back the token, so they did not even need the email
 * to arrive. rbac.ts had always reserved users:manage for OWNER and ADMIN;
 * these endpoints simply never asked it.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    userInvite: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), count: jest.fn() },
    user: { count: jest.fn(), findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), emailConfigured: jest.fn(() => true) }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  rateLimitKey: jest.fn(() => "key"),
}));

import { GET, POST } from "@/app/api/invites/route";
import { DELETE } from "@/app/api/invites/[id]/route";
import { POST as RESEND } from "@/app/api/invites/[id]/resend/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockSend = sendEmail as jest.Mock;

const ORG = "org-1";
const as = (role: string) =>
  mockAuth.mockResolvedValue({ user: { id: "u-1", orgId: ORG, email: "who@acme.test", role } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new NextRequest("http://localhost/api/invites", {
    method: "POST",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ sent: true, id: "re_1" });
  mockDb.organization.findUnique.mockResolvedValue({ name: "Acme", brandName: "Acme" });
  mockDb.userInvite.findFirst.mockResolvedValue(null);
  mockDb.userInvite.findMany.mockResolvedValue([]);
  /* No account exists at the invited address; the collision case lives in
     invites.test.ts. */
  mockDb.user.findUnique.mockResolvedValue(null);
  mockDb.userInvite.create.mockResolvedValue({
    id: "inv-1", orgId: ORG, email: "x@y.test", role: "MEMBER",
    token: "tok", expiresAt: new Date(Date.now() + 864e5),
  });
  mockDb.userInvite.findUnique.mockResolvedValue({
    id: "inv-1", orgId: ORG, email: "x@y.test", role: "MEMBER", token: "tok",
    acceptedAt: null, expiresAt: new Date(Date.now() + 864e5),
    organization: { name: "Acme", brandName: "Acme" },
  });
});

const ALLOWED = ["OWNER", "ADMIN"];
const REFUSED = ["MANAGER", "MEMBER", "VIEWER"];

describe("roles that may not manage the team", () => {
  it.each(REFUSED)("refuses %s creating an invite, and sends no mail", async (role) => {
    as(role);
    const res = await POST(post({ email: "new@person.test", role: "MEMBER" }));
    expect(res.status).toBe(403);
    expect(mockDb.userInvite.create).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  /* The listing carries `token`, and the accept endpoint checks the token and
     never the address, so reading this list is enough to take over any pending
     invite in the org. */
  it.each(REFUSED)("refuses %s listing invites, because the rows carry tokens", async (role) => {
    as(role);
    const res = await GET(new NextRequest("http://localhost/api/invites"));
    expect(res.status).toBe(403);
    expect(mockDb.userInvite.findMany).not.toHaveBeenCalled();
  });

  it.each(REFUSED)("refuses %s cancelling an invite", async (role) => {
    as(role);
    const res = await DELETE(new NextRequest("http://localhost/api/invites/inv-1", { method: "DELETE" }), ctx("inv-1"));
    expect(res.status).toBe(403);
    expect(mockDb.userInvite.delete).not.toHaveBeenCalled();
  });

  it.each(REFUSED)("refuses %s resending an invite", async (role) => {
    as(role);
    const res = await RESEND(new NextRequest("http://localhost/api/invites/inv-1/resend", { method: "POST" }), ctx("inv-1"));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("roles that may", () => {
  it.each(ALLOWED)("lets %s create an invite", async (role) => {
    as(role);
    const res = await POST(post({ email: "new@person.test", role: "MEMBER" }));
    expect(res.status).toBe(201);
    expect(mockDb.userInvite.create).toHaveBeenCalled();
  });

  it.each(ALLOWED)("lets %s list invites", async (role) => {
    as(role);
    const res = await GET(new NextRequest("http://localhost/api/invites"));
    expect(res.status).toBe(200);
  });
});

describe("handing out the role above your own", () => {
  /* users:manage lets an ADMIN run the team. Minting an OWNER is not running
     the team -- it is granting the role that outranks you, at an address you
     choose, which is the escalation the gate exists to stop. */
  it("refuses an ADMIN inviting an OWNER", async () => {
    as("ADMIN");
    const res = await POST(post({ email: "new@person.test", role: "OWNER" }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain("Only an owner");
    expect(mockDb.userInvite.create).not.toHaveBeenCalled();
  });

  it("allows an OWNER inviting an OWNER", async () => {
    as("OWNER");
    const res = await POST(post({ email: "new@person.test", role: "OWNER" }));
    expect(res.status).toBe(201);
  });

  it("still lets an ADMIN invite every role below owner", async () => {
    for (const role of ["ADMIN", "MANAGER", "MEMBER", "VIEWER"]) {
      jest.clearAllMocks();
      mockDb.organization.findUnique.mockResolvedValue({ name: "Acme", brandName: "Acme" });
      mockDb.userInvite.findFirst.mockResolvedValue(null);
      mockDb.user.findUnique.mockResolvedValue(null);
      mockDb.userInvite.create.mockResolvedValue({
        id: "inv-1", orgId: ORG, email: "x@y.test", role,
        token: "tok", expiresAt: new Date(Date.now() + 864e5),
      });
      mockSend.mockResolvedValue({ sent: true, id: "re_1" });
      as("ADMIN");
      const res = await POST(post({ email: "new@person.test", role }));
      expect(res.status).toBe(201);
    }
  });
});

describe("no session at all", () => {
  it("is still a 401 rather than a 403", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(post({ email: "new@person.test" }));
    expect(res.status).toBe(401);
  });
});
