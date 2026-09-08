/**
 * @jest-environment node
 *
 * Share links outlive a soft-deleted campaign — on purpose. DELETE
 * /api/campaigns/[id] only sets deletedAt, and the confirm copy tells the
 * operator that share links are kept. But every verb on
 * /api/campaigns/[id]/share filtered `deletedAt: null`, so the modal could no
 * longer read, retarget or revoke the link it had just promised stays live.
 *
 * Read/toggle/revoke must reach a deleted campaign; minting a NEW public link
 * for one must not.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    report: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import {
  GET as getShare,
  POST as postShare,
  PATCH as patchShare,
  DELETE as deleteShare,
} from "@/app/api/campaigns/[id]/share/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const params = { params: Promise.resolve({ id: "camp-1" }) } as any;
const req = (init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest("http://localhost/api/campaigns/camp-1/share", init);
const jsonReq = (method: string, body: unknown) =>
  req({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const link = {
  id: "rep-1",
  shareToken: "tok",
  isPublic: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  config: { kind: "campaign-performance" },
};

function lastWhere() {
  return mockDb.campaign.findFirst.mock.calls.at(-1)[0].where;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "OWNER", campaignScope: "ALL" } });
  mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", title: "Deleted campaign" });
  mockDb.report.findMany.mockResolvedValue([link]);
  mockDb.report.update.mockImplementation(({ data }: any) => ({ ...link, ...data }));
});

it("GET does not require the campaign to be live", async () => {
  const res = await getShare(req(), params);
  expect(res.status).toBe(200);
  expect(lastWhere()).not.toHaveProperty("deletedAt");
  expect(await res.json()).toMatchObject({ link: { token: "tok" } });
});

it("PATCH can still retarget the link of a deleted campaign", async () => {
  const res = await patchShare(jsonReq("PATCH", { visibility: { showBudget: true } }), params);
  expect(res.status).toBe(200);
  expect(lastWhere()).not.toHaveProperty("deletedAt");
  expect(mockDb.report.update).toHaveBeenCalled();
});

it("DELETE can still revoke the link of a deleted campaign", async () => {
  const res = await deleteShare(req({ method: "DELETE" }), params);
  expect(res.status).toBe(200);
  expect(lastWhere()).not.toHaveProperty("deletedAt");
  expect(mockDb.report.update).toHaveBeenCalledWith({ where: { id: "rep-1" }, data: { isPublic: false } });
});

it("POST still refuses to mint a new link for a deleted campaign", async () => {
  // The route asks for a live campaign, so the deleted row does not match.
  mockDb.campaign.findFirst.mockResolvedValue(null);
  const res = await postShare(jsonReq("POST", {}), params);
  expect(res.status).toBe(404);
  expect(lastWhere()).toMatchObject({ deletedAt: null });
  expect(mockDb.report.create).not.toHaveBeenCalled();
  expect(mockDb.report.update).not.toHaveBeenCalled();
});
