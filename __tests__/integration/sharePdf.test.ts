/**
 * @jest-environment node
 *
 * The share PDF is the same public, session-less URL as the CSV export beside
 * it, and a strictly more expensive one — it boots react-pdf and lays out every
 * post. The export has been rate limited since it shipped; this route had no
 * limit and no maxDuration at all.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: { report: { findUnique: jest.fn() }, organization: { findUnique: jest.fn() } },
}));
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }));
// ESM the runner does not transform, and not what is under test here.
jest.mock("@react-pdf/renderer", () => ({
  renderToBuffer: jest.fn().mockResolvedValue(Buffer.from("%PDF-1.4")),
}));
jest.mock("@/lib/reports/CampaignPerformancePDF", () => ({ CampaignPerformancePDF: () => null }));
jest.mock("@/lib/reports/campaignPerformance", () => ({
  computeCampaignPerformance: jest.fn().mockResolvedValue({ kpis: {}, posts: [], leaderboard: [] }),
  redactForShare: (d: unknown) => d,
}));

import { GET, maxDuration } from "@/app/api/share/[token]/pdf/route";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";

const mockDb = db as any;
const mockRateLimit = rateLimit as jest.Mock;

const call = (token = "tok") =>
  GET(new NextRequest(`http://localhost/api/share/${token}/pdf`), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockDb.report.findUnique.mockResolvedValue({
    isPublic: true,
    config: { kind: "campaign-performance" },
    campaign: { id: "camp-1", orgId: "org-1", title: "Wherever I go", budget: 100, currency: "USD" },
  });
  mockDb.organization.findUnique.mockResolvedValue({ uiConfig: null });
});

it("serves the PDF when the caller is inside the budget", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/pdf");
});

it("counts against the same 20-per-10-minutes budget as the CSV export", async () => {
  await call();
  expect(mockRateLimit).toHaveBeenCalledWith(
    expect.objectContaining({ key: expect.stringContaining("share-pdf:"), limit: 20, windowMs: 600_000 })
  );
});

it("429s with Retry-After rather than rendering, once the budget is spent", async () => {
  mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });

  const res = await call();

  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("42");
  // Refused before the token is even looked up.
  expect(mockDb.report.findUnique).not.toHaveBeenCalled();
});

it("states its own maxDuration instead of inheriting a platform default", () => {
  expect(maxDuration).toBe(60);
});
