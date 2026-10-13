/**
 * @jest-environment node
 *
 * The AI briefing and natural-language query routes follow the payouts switch
 * (lib/payouts/switch.ts): off, the model is never told about payouts, the
 * Payout table is not read, and a "show pending payouts" question is answered
 * as one the route does not understand. On, all three come back.
 */
import { NextRequest } from "next/server";
import { POST as postBriefing } from "@/app/api/ai/briefing/route";
import { POST as postNlQuery } from "@/app/api/ai/nl-query/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    payout: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    post: { findMany: jest.fn() },
    creator: { count: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({
  ...jest.requireActual("@/lib/entitlements"),
  getOrgEntitlements: jest.fn(),
}));
/* State inside the factory: the nl-query route builds its classifier prompt
   from the switch while it loads. */
jest.mock("@/lib/payouts/switch", () => {
  const state = { on: false };
  return {
    get PAYOUTS_ENABLED() {
      return state.on;
    },
    setForTest(on: boolean) {
      state.on = on;
    },
  };
});
const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import { AI_ASSISTANT_FEATURE } from "@/lib/featureKeys";
import * as payoutSwitch from "@/lib/payouts/switch";

const setPayoutsOn = (on: boolean) => (payoutSwitch as unknown as { setForTest(on: boolean): void }).setForTest(on);
const mockDb = db as any;

function post(url: string, body: object) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The user-turn text of the n-th call to the model. */
const promptOf = (n = 0) => mockMessagesCreate.mock.calls[n][0].messages[0].content as string;

beforeEach(() => {
  jest.clearAllMocks();
  setPayoutsOn(false);
  (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "OWNER" } });
  (getOrgEntitlements as jest.Mock).mockResolvedValue({ featureMap: { [AI_ASSISTANT_FEATURE]: true } });
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  mockMessagesCreate.mockResolvedValue({ content: [{ type: "text", text: "summary" }] });
  mockDb.campaign.count.mockResolvedValue(3);
  mockDb.campaign.findFirst.mockResolvedValue({
    id: "cam-1",
    title: "Summer Drop",
    status: "IN_PROGRESS",
    campaignType: "BUDGET_BASED",
    budget: 10000,
    currency: "USD",
    _count: { activations: 5, posts: 12 },
  });
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.creator.count.mockResolvedValue(10);
  mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 3500 } });
  mockDb.payout.count.mockResolvedValue(2);
  mockDb.payout.findMany.mockResolvedValue([{ id: "p1", amount: 10, currency: "USD", status: "PENDING", createdAt: new Date() }]);
});

describe("POST /api/ai/briefing", () => {
  it.each(["org", "campaign"])("leaves payouts out of the %s briefing while payouts are off", async (type) => {
    const res = await postBriefing(post("http://localhost/api/ai/briefing", { type, id: "cam-1" }));
    expect(res.status).toBe(200);
    expect(promptOf()).not.toMatch(/payout/i);
    expect(mockDb.payout.aggregate).not.toHaveBeenCalled();
  });

  it.each(["org", "campaign"])("tells the model about payouts in the %s briefing once they are back on", async (type) => {
    setPayoutsOn(true);
    const res = await postBriefing(post("http://localhost/api/ai/briefing", { type, id: "cam-1" }));
    expect(res.status).toBe(200);
    expect(promptOf()).toMatch(/Total payouts( issued)?: \$3500\.00/);
    expect(mockDb.payout.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1" }) }),
    );
  });
});

describe("POST /api/ai/nl-query", () => {
  const ask = (intent: object) => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(intent) }] });
    return postNlQuery(post("http://localhost/api/ai/nl-query", { query: "show pending payouts" }));
  };

  it("does not offer the payout intent to the classifier while payouts are off", async () => {
    await ask({ type: "unknown" });
    const system = mockMessagesCreate.mock.calls[0][0].system as string;
    expect(system).not.toMatch(/payout/i);
  });

  it("answers a payout question as not understood while payouts are off", async () => {
    const body = await (await ask({ type: "list_payouts", status: "PENDING" })).json();
    expect(body.intent).toEqual({ type: "unknown" });
    expect(body.error).toMatch(/couldn't understand/i);
    expect(body.error).not.toMatch(/payout/i);
    expect(body.results).toBeUndefined();
    expect(mockDb.payout.findMany).not.toHaveBeenCalled();
  });

  it("reports KPIs without payout figures while payouts are off", async () => {
    const body = await (await ask({ type: "get_org_kpis" })).json();
    expect(body.results).toEqual({ activeCampaigns: 3, totalCreators: 10 });
    expect(mockDb.payout.aggregate).not.toHaveBeenCalled();
    expect(mockDb.payout.count).not.toHaveBeenCalled();
  });

  it("lists payouts, org-scoped, once payouts are back on", async () => {
    setPayoutsOn(true);
    const body = await (await ask({ type: "list_payouts", status: "PENDING" })).json();
    expect(body.intent.type).toBe("list_payouts");
    expect(body.count).toBe(1);
    expect(mockDb.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", status: "PENDING" }) }),
    );
  });

  it("adds the payout KPIs back once payouts are back on", async () => {
    setPayoutsOn(true);
    const body = await (await ask({ type: "get_org_kpis" })).json();
    expect(body.results).toEqual({ activeCampaigns: 3, totalCreators: 10, totalPayoutsAmount: 3500, pendingPayouts: 2 });
  });
});
