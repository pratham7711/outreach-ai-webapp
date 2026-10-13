/**
 * @jest-environment node
 *
 * GET /api/campaigns/[id]/performance answers the Performance tab, which never
 * renders the per-post rows, and Settings' audio panel, which needs only the
 * sound. Neither should be sent the rest.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({ db: { campaign: { findFirst: jest.fn() } } }));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/reports/campaignPerformance", () => ({
  computeCampaignPerformance: jest.fn(),
  loadCampaignAudio: jest.fn(),
}));

import { GET } from "@/app/api/campaigns/[id]/performance/route";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeCampaignPerformance, loadCampaignAudio } from "@/lib/reports/campaignPerformance";

const params = { params: Promise.resolve({ id: "camp-1" }) };
const req = (qs = "") => new NextRequest(`http://localhost/api/campaigns/camp-1/performance${qs}`);
const audio = { title: "Song", artist: "A", coverUrl: null, uses: 10, usageSeries: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "OWNER", campaignScope: "ALL" });
  (db.campaign.findFirst as jest.Mock).mockResolvedValue({ id: "camp-1", orgId: "org-1", budget: null, currency: "USD" });
  (computeCampaignPerformance as jest.Mock).mockResolvedValue({
    currency: "USD", kpis: { views: 5 }, timeSeries: [], seriesPlatforms: [], platformSplit: [], leaderboard: [],
    posts: [{ id: "p1" }], audio,
  });
  (loadCampaignAudio as jest.Mock).mockResolvedValue(audio);
});

it("returns the report without the per-post rows", async () => {
  const body = await (await GET(req(), params)).json();
  expect(body.posts).toBeUndefined();
  expect(Object.keys(body).sort()).toEqual(["audio", "currency", "kpis", "leaderboard", "platformSplit", "seriesPlatforms", "timeSeries"]);
});

it("answers ?only=audio from the audio loader alone, without the chart", async () => {
  const body = await (await GET(req("?only=audio"), params)).json();
  expect(body).toEqual({ audio });
  expect(computeCampaignPerformance).not.toHaveBeenCalled();
  expect(loadCampaignAudio).toHaveBeenCalledWith("camp-1", "org-1", { series: false });
});

it("still 404s a campaign outside the caller's org or scope on the light path", async () => {
  (db.campaign.findFirst as jest.Mock).mockResolvedValue(null);
  const res = await GET(req("?only=audio"), params);
  expect(res.status).toBe(404);
  expect(loadCampaignAudio).not.toHaveBeenCalled();
});
