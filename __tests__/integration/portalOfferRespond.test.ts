/**
 * @jest-environment node
 *
 * POST /api/portal/offers/[id]/respond.
 *
 * The exploit this closes: "accept" leaves the row at COUNTERED (it has to —
 * ACCEPTED is the brand's final say and app/api/negotiations/approve refuses an
 * offer already in it), so the ACCEPTED/REJECTED guard never fired for a
 * creator. A creator could accept at the standing rate and then counter HIGHER;
 * the counter's AI round raises aiCounterRate, and the brand's approve
 * recomputes standingRate and pays the new number. Acceptance is now recorded
 * by finalRate — written nowhere else on the creator's side — and any further
 * respond on an offer that has one is refused.
 *
 * Ownership: the offer's roster row must be one this portal login has PROVEN it
 * owns (lib/portal/creatorLink.ts). A handle match alone used to be enough, so
 * anyone who registered a roster handle could accept another org's offer.
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/portal/offers/[id]/respond/route";

jest.mock("@/lib/db", () => ({
  db: {
    negotiationOffer: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    creator: { findFirst: jest.fn(), findMany: jest.fn() },
    creatorSocialAccount: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({
  getCreatorSession: jest.fn(),
  creatorHandleVariants: (h: string) => [h.replace(/^@/, ""), `@${h.replace(/^@/, "")}`],
}));
jest.mock("@/lib/negotiation/conversation", () => ({
  getOrCreateConversation: jest.fn(async () => "conv-1"),
  appendMessage: jest.fn(async () => undefined),
}));
jest.mock("@/lib/negotiation/engine", () => ({
  getAdvisor: () => ({
    proposeCounter: jest.fn(async () => ({ counterRate: 1500, message: "how about 1500" })),
  }),
}));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

const mockDb = db as any;
const mockSession = getCreatorSession as jest.Mock;

const offer = (over: Record<string, unknown> = {}) => ({
  id: "off-1",
  orgId: "org-1",
  campaignId: "camp-1",
  creatorId: "cr-1",
  conversationId: "conv-1",
  status: "PENDING",
  offeredRate: 1000,
  counterRate: null,
  aiCounterRate: null,
  finalRate: null,
  aiRound: 0,
  currency: "USD",
  ...over,
});

const respond = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost/api/portal/offers/off-1/respond", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "off-1" }) }
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({
    creatorUserId: "cu-1",
    handle: "blessingjolie",
    name: "Blessing",
    email: "b@example.com",
  });
  mockDb.negotiationOffer.findFirst.mockResolvedValue(offer());
  mockDb.negotiationOffer.update.mockImplementation(async ({ data }: any) => ({ id: "off-1", ...data }));
  mockDb.negotiationOffer.updateMany.mockResolvedValue({ count: 1 });
  mockDb.negotiationOffer.findUniqueOrThrow.mockResolvedValue(offer({ status: "COUNTERED", finalRate: 1000 }));
  mockDb.creator.findFirst.mockResolvedValue({
    id: "cr-1",
    followersCount: 1000,
    averageViews: 500,
    rate: null,
  });
  /* The roster row names this portal login (proof 1, identity): the row the
     creator linked by accepting the agency's invite. */
  mockDb.creator.findMany.mockResolvedValue([
    { id: "cr-1", orgId: "org-1", creatorUserId: "cu-1" },
  ]);
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
});

describe("POST /api/portal/offers/[id]/respond — acceptance is terminal", () => {
  it("records an acceptance as finalRate at the standing rate", async () => {
    const res = await respond({ action: "accept" });
    expect(res.status).toBe(200);
    expect(mockDb.negotiationOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "off-1", status: "PENDING", finalRate: null }),
        data: expect.objectContaining({ finalRate: 1000 }),
      })
    );
  });

  it("409s an accept that lost the race to another response", async () => {
    mockDb.negotiationOffer.updateMany.mockResolvedValue({ count: 0 });
    const res = await respond({ action: "accept" });
    expect(res.status).toBe(409);
    expect(mockDb.negotiationOffer.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("409s a second counter racing the first for the single AI round", async () => {
    mockDb.negotiationOffer.updateMany.mockResolvedValue({ count: 0 });
    const res = await respond({ action: "counter", counterRate: 1200 });
    expect(res.status).toBe(409);
    expect(mockDb.negotiationOffer.update).not.toHaveBeenCalled();
  });

  it("409s a second accept instead of rewriting finalRate", async () => {
    mockDb.negotiationOffer.findFirst.mockResolvedValue(
      offer({ status: "COUNTERED", finalRate: 1000, aiCounterRate: 1400 })
    );
    const res = await respond({ action: "accept" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already accepted/i);
    expect(mockDb.negotiationOffer.updateMany).not.toHaveBeenCalled();
  });

  it("409s a counter filed after an acceptance", async () => {
    mockDb.negotiationOffer.findFirst.mockResolvedValue(
      offer({ status: "COUNTERED", finalRate: 1000 })
    );
    const res = await respond({ action: "counter", counterRate: 5000 });
    expect(res.status).toBe(409);
    expect(mockDb.negotiationOffer.updateMany).not.toHaveBeenCalled();
    expect(mockDb.negotiationOffer.update).not.toHaveBeenCalled();
  });

  it.each(["ACCEPTED", "REJECTED"])("409s any respond on a %s offer", async (status) => {
    mockDb.negotiationOffer.findFirst.mockResolvedValue(offer({ status }));
    expect((await respond({ action: "accept" })).status).toBe(409);
    expect((await respond({ action: "counter", counterRate: 2000 })).status).toBe(409);
    expect(mockDb.negotiationOffer.updateMany).not.toHaveBeenCalled();
    expect(mockDb.negotiationOffer.update).not.toHaveBeenCalled();
  });

  it("still allows the first counter, and still stops at the single AI round", async () => {
    expect((await respond({ action: "counter", counterRate: 1200 })).status).toBe(200);

    mockDb.negotiationOffer.findFirst.mockResolvedValue(
      offer({ status: "COUNTERED", counterRate: 1200, aiCounterRate: 1400, aiRound: 1 })
    );
    expect((await respond({ action: "counter", counterRate: 9000 })).status).toBe(409);
  });

  it("404s an offer whose creator does not bridge to this portal user", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    expect((await respond({ action: "accept" })).status).toBe(404);
  });
});

describe("POST /api/portal/offers/[id]/respond — ownership must be proven", () => {
  it("404s a portal login that only shares the roster handle, and writes nothing", async () => {
    // Same handle, not linked to this login, no connected account: a handle match only.
    mockDb.creator.findMany.mockResolvedValue([{ id: "cr-1", orgId: "org-1", creatorUserId: null }]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
    const res = await respond({ action: "accept" });
    expect(res.status).toBe(404);
    expect(mockDb.negotiationOffer.updateMany).not.toHaveBeenCalled();
    expect(mockDb.negotiationOffer.update).not.toHaveBeenCalled();
  });

  it("404s a row linked to a DIFFERENT portal login", async () => {
    mockDb.creator.findMany.mockResolvedValue([{ id: "cr-1", orgId: "org-1", creatorUserId: "cu-other" }]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
    expect((await respond({ action: "accept" })).status).toBe(404);
  });

  it("does not take a matching contact email as proof", async () => {
    mockSession.mockResolvedValue({
      creatorUserId: "cu-1",
      handle: "blessingjolie",
      name: "Blessing",
      email: "the-real-creator@example.com",
    });
    mockDb.creator.findMany.mockResolvedValue([
      { id: "cr-1", orgId: "org-1", creatorUserId: null, contactEmail: "the-real-creator@example.com" },
    ]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
    expect((await respond({ action: "accept" })).status).toBe(404);
  });

  it("accepts the OAuth proof: a connected account whose platform handle is this portal handle", async () => {
    mockDb.creator.findMany.mockResolvedValue([{ id: "cr-1", orgId: "org-1", creatorUserId: null }]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([{ creatorId: "cr-1", handle: "@BlessingJolie" }]);
    expect((await respond({ action: "accept" })).status).toBe(200);
  });
});
