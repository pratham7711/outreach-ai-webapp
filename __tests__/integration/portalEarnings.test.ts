/**
 * @jest-environment node
 *
 * A creator can accrue earnings on a USD campaign and an INR one at the same
 * time. The route used to reduce both into one `totalApprovedMinor`, which the
 * portal then printed behind a dollar sign — a balance wrong in both
 * currencies. It now buckets per currency.
 */
import { GET } from "@/app/api/portal/earnings/route";

jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/marketplace/earnings", () => ({ computeCreatorEarnings: jest.fn() }));

import { getCreatorSession } from "@/lib/creator-auth";
import { computeCreatorEarnings } from "@/lib/marketplace/earnings";

const mockSession = getCreatorSession as jest.Mock;
const mockEarnings = computeCreatorEarnings as jest.Mock;

const earning = (over: Record<string, unknown> = {}) => ({
  campaignId: "camp-1",
  campaignTitle: "Leak It",
  publicSlug: "leak-it",
  orgName: "Acme",
  currency: "USD",
  approvedMinor: 50_000,
  pendingMinor: 10_000,
  minPayoutMinor: null,
  submissionCount: 2,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ creatorUserId: "cu-1", handle: "awxyken" });
  mockEarnings.mockResolvedValue([earning()]);
});

it("returns 401 without a creator session", async () => {
  mockSession.mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
});

it("buckets approved and pending earnings per currency", async () => {
  mockEarnings.mockResolvedValue([
    earning({ currency: "INR", approvedMinor: 4_000_000, pendingMinor: 0 }),
    earning({ campaignId: "camp-2", currency: "USD", approvedMinor: 50_000, pendingMinor: 10_000 }),
    earning({ campaignId: "camp-3", currency: "INR", approvedMinor: 1_000_000, pendingMinor: 500_000 }),
  ]);

  const body = await (await GET()).json();

  expect(body.approvedByCurrency).toEqual([
    { currency: "INR", minor: 5_000_000 },
    { currency: "USD", minor: 50_000 },
  ]);
  expect(body.pendingByCurrency).toEqual([
    { currency: "INR", minor: 500_000 },
    { currency: "USD", minor: 10_000 },
  ]);
  // The sum this replaced, which was neither rupees nor dollars.
  expect(body.totalApprovedMinor).toBeUndefined();
});

it("still reports each campaign row with its own currency", async () => {
  const body = await (await GET()).json();
  expect(body.campaigns[0]).toMatchObject({ currency: "USD", approvedMinor: 50_000 });
});
