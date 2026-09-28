/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    report: { findUnique: jest.fn() },
    post: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/creators/avatarStore", () => ({ readStoredAvatar: jest.fn() }));
jest.mock("@/lib/creators/avatarResponse", () => ({ serveAvatar: jest.fn(() => new Response("img", { status: 200 })) }));
jest.mock("@/lib/media/proxyImage", () => ({ imageDimension: (_: unknown, d: number) => d, resizeImage: jest.fn() }));

import { GET } from "@/app/api/share/[token]/avatar/[creatorId]/route";
import { db } from "@/lib/db";
import { readStoredAvatar } from "@/lib/creators/avatarStore";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const report = (showCreators: boolean) => ({
  isPublic: true,
  orgId: "org-1",
  campaignId: "camp-1",
  config: { kind: "campaign-performance", visibility: { showCreators } },
});
const fetchAvatar = (token: string, creatorId: string) =>
  GET(new NextRequest(`http://localhost/api/share/${token}/avatar/${creatorId}`), { params: Promise.resolve({ token, creatorId }) });

beforeEach(() => {
  jest.clearAllMocks();
  mdb.post.findMany.mockResolvedValue([{ creatorId: "on-campaign" }]);
  mdb.activation.findMany.mockResolvedValue([]);
});

describe("GET /api/share/[token]/avatar/[creatorId]", () => {
  it("serves a creator on the link's campaign, from the link's org", async () => {
    mdb.report.findUnique.mockResolvedValue(report(true));
    expect((await fetchAvatar("t-ok", "on-campaign")).status).toBe(200);
    expect(readStoredAvatar).toHaveBeenCalledWith("on-campaign", "org-1");
  });

  it("refuses a creator from elsewhere, and every face on a link that hides creators", async () => {
    mdb.report.findUnique.mockResolvedValue(report(true));
    expect((await fetchAvatar("t-other", "elsewhere")).status).toBe(404);
    mdb.report.findUnique.mockResolvedValue(report(false));
    expect((await fetchAvatar("t-hidden", "on-campaign")).status).toBe(404);
    expect(readStoredAvatar).not.toHaveBeenCalled();
  });

  it("resolves a link once for a whole burst of pictures", async () => {
    mdb.report.findUnique.mockResolvedValue(report(true));
    await Promise.all(Array.from({ length: 24 }, () => fetchAvatar("t-burst", "on-campaign")));
    expect(mdb.report.findUnique).toHaveBeenCalledTimes(1);
    expect(mdb.post.findMany).toHaveBeenCalledTimes(1);
  });
});
