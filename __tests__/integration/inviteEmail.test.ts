/**
 * @jest-environment node
 */

/**
 * Delivering the invite.
 *
 * Until this path existed the token was generated, stored, and shown to
 * nobody. The behaviour worth pinning is the split responsibility: the invite
 * row is the source of truth and must survive a dead mail provider, while the
 * UI must never be told an email went out when it did not.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    userInvite: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
    user: { count: jest.fn() },
    organization: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), emailConfigured: jest.fn(() => true) }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), createAuditActor: jest.fn(() => ({})) }));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  rateLimitKey: jest.fn(() => "key"),
}));

import { POST as CREATE } from "@/app/api/invites/route";
import { POST as RESEND } from "@/app/api/invites/[id]/resend/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockSend = sendEmail as jest.Mock;
const mockAudit = logAudit as jest.Mock;

const ORG = "org-1";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { orgId: ORG, email: "owner@acme.test" } });
  mockSend.mockResolvedValue({ sent: true, id: "re_1" });
  mockDb.organization.findUnique.mockResolvedValue({ name: "Acme", brandName: "Acme Studio" });
  mockDb.userInvite.findFirst.mockResolvedValue(null);
});

describe("creating an invite sends the mail", () => {
  const created = {
    id: "inv-1", orgId: ORG, email: "new@person.test", role: "ADMIN",
    token: "tok-abc", expiresAt: new Date("2026-09-08T00:00:00Z"),
  };

  it("emails the invitee and reports that it did", async () => {
    mockDb.userInvite.create.mockResolvedValue(created);

    const res = await CREATE(req("http://localhost/api/invites", { email: "new@person.test", role: "ADMIN" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.emailed).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const sent = mockSend.mock.calls[0][0];
    expect(sent.to).toBe("new@person.test");
    /* The org's own brand name, not ours: the recipient is joining Acme, and
       an invitation that names only the platform is unrecognisable. */
    expect(sent.subject).toContain("Acme Studio");
    expect(sent.text).toContain("/accept-invite?token=tok-abc");
    /* The enum must not leak into prose. */
    expect(sent.text).toContain("an admin");
    expect(sent.text).not.toContain("ADMIN");
    expect(sent.text).toContain("2026-09-08");
    /* Somebody to answer to makes an unexpected invite answerable. */
    expect(sent.replyTo).toBe("owner@acme.test");
  });

  /* The whole reason the send is not awaited-and-thrown. */
  it("still creates the invite when the provider is down, and says so", async () => {
    mockDb.userInvite.create.mockResolvedValue(created);
    mockSend.mockResolvedValue({ sent: false, reason: "failed" });

    const res = await CREATE(req("http://localhost/api/invites", { email: "new@person.test" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("inv-1");
    expect(body.emailed).toBe(false);
  });

  it("does not send anything when the invite was refused", async () => {
    mockDb.userInvite.findFirst.mockResolvedValue({ id: "existing" });

    const res = await CREATE(req("http://localhost/api/invites", { email: "dupe@person.test" }));

    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("resending an invite", () => {
  const pending = {
    id: "inv-1", orgId: ORG, email: "new@person.test", role: "MEMBER",
    token: "tok-abc", acceptedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    organization: { name: "Acme", brandName: "Acme Studio" },
  };

  it("sends again and audits it", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(pending);

    const res = await RESEND(req("http://localhost/api/invites/inv-1/resend"), ctx("inv-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.emailed).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invite.resend", orgId: ORG }));
  });

  /* The token is reusable, so resend must not become a way to mail an address
     in somebody else's tenant. */
  it("refuses an invite belonging to another org, and sends nothing", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue({ ...pending, orgId: "someone-else" });

    const res = await RESEND(req("http://localhost/api/invites/inv-1/resend"), ctx("inv-1"));

    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses an already-accepted invite", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue({ ...pending, acceptedAt: new Date() });

    const res = await RESEND(req("http://localhost/api/invites/inv-1/resend"), ctx("inv-1"));

    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  /* Re-sending a dead link would put a link in someone's inbox that fails when
     they click it, which is worse than the silence it replaced. */
  it("refuses an expired invite rather than mailing a dead link", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue({ ...pending, expiresAt: new Date(Date.now() - 1000) });

    const res = await RESEND(req("http://localhost/api/invites/inv-1/resend"), ctx("inv-1"));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("expired");
    expect(mockSend).not.toHaveBeenCalled();
  });

  /* Unlike create, there is no row to fall back on here: the only product of
     this endpoint is the email, so a failed send is a failed request. */
  it("reports a failed send as an error instead of a success", async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(pending);
    mockSend.mockResolvedValue({ sent: false, reason: "not-configured" });

    const res = await RESEND(req("http://localhost/api/invites/inv-1/resend"), ctx("inv-1"));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.emailed).toBe(false);
    expect(body.error).toContain("Copy the invite link");
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await RESEND(req("http://localhost/api/invites/inv-1/resend"), ctx("inv-1"));

    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
