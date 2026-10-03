/**
 * @jest-environment node
 *
 * The daily extension of every org's own Instagram account. Each row is its
 * own attempt: one org's dead token, or a write that throws, is that org's
 * outcome, and every other org is still extended.
 */
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    platformCredential: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

const mockExchange = jest.fn();
jest.mock("@/lib/platforms/instagram", () => ({
  exchangeForLongLivedToken: (...args: unknown[]) => mockExchange(...args),
}));

import {
  agencyProvider,
  encodeAgencyMeta,
  parseAgencyMeta,
  refreshAgencyCredentials,
  storeAgencyCredential,
} from "@/lib/platforms/instagramAgencyCredential";
import { INSTAGRAM_BUSINESS_PROVIDER } from "@/lib/platforms/instagramBusinessToken";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";

const DAY = 86_400_000;
const NOW = new Date("2026-10-04T05:00:00.000Z");

function row(orgId: string, daysLeft: number) {
  const provider = agencyProvider(orgId);
  return {
    provider,
    accessToken: encrypt(`token-${orgId}`, provider),
    expiresAt: new Date(NOW.getTime() + daysLeft * DAY),
    refreshedAt: new Date(NOW.getTime() - 40 * DAY),
    lastAttemptAt: null,
    lastError: null,
    source: encodeAgencyMeta({ via: "oauth", igUserId: `ig-${orgId}`, username: `u-${orgId}`, pageId: "p", fbUserId: "f" }),
    createdAt: new Date(NOW.getTime() - 40 * DAY),
  };
}

const updateFor = (orgId: string) =>
  mockUpdate.mock.calls.map((c) => c[0]).find((a) => a.where.provider === agencyProvider(orgId));

beforeEach(() => {
  mockFindMany.mockReset();
  mockUpdate.mockReset().mockResolvedValue({});
  mockUpsert.mockReset().mockResolvedValue({});
  mockExchange.mockReset().mockImplementation(async (token: string) => {
    if (token === "token-org-dead") return null;
    return { accessToken: `fresh-${token}`, expiresAt: new Date(NOW.getTime() + 60 * DAY) };
  });
});

describe("refreshAgencyCredentials", () => {
  it("extends each org's row on its own, whatever happens to the others", async () => {
    mockFindMany.mockResolvedValue([
      row("org-dead", 3),
      row("org-write-fails", 5),
      row("org-due", 10),
      row("org-fine", 40),
      row("org-expired", -2),
    ]);
    mockUpdate.mockImplementation(async (args: { where: { provider: string }; data: { accessToken?: string } }) => {
      if (args.where.provider === agencyProvider("org-write-fails") && args.data.accessToken) throw new Error("db down");
      return {};
    });

    const out = await refreshAgencyCredentials({ now: NOW });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: { startsWith: "instagram_business:org:" } } }),
    );
    expect(Object.fromEntries(out.outcomes.map((o) => [o.orgId, o.status]))).toEqual({
      "org-dead": "failed",
      "org-write-fails": "failed",
      "org-due": "refreshed",
      "org-fine": "not-due",
      "org-expired": "expired",
    });
    expect(out.byStatus).toEqual({ refreshed: 1, "not-due": 1, expired: 1, "not-extended": 0, failed: 2 });

    // Extended in place: its own token, under its own provider, account details kept.
    const due = updateFor("org-due");
    expect(decrypt(due.data.accessToken, agencyProvider("org-due"))).toBe("fresh-token-org-due");
    expect(due.data.expiresAt).toEqual(new Date(NOW.getTime() + 60 * DAY));
    expect(due.data.lastError).toBeNull();
    expect(parseAgencyMeta(due.data.source)).toMatchObject({ via: "refresh", igUserId: "ig-org-due", username: "u-org-due" });

    // A refused exchange is recorded on that row and nothing else.
    expect(updateFor("org-dead").data).toEqual({ lastAttemptAt: NOW, lastError: expect.stringMatching(/refused/) });

    // Not due and expired rows are never sent to Meta.
    expect(mockExchange).not.toHaveBeenCalledWith("token-org-fine");
    expect(mockExchange).not.toHaveBeenCalledWith("token-org-expired");
  });

  it("never touches the operator credential", async () => {
    mockFindMany.mockResolvedValue([row("org-due", 10)]);
    await refreshAgencyCredentials({ now: NOW });
    expect(mockUpdate.mock.calls.every((c) => c[0].where.provider !== INSTAGRAM_BUSINESS_PROVIDER)).toBe(true);
  });

  it("refreshes a row outside its window when forced", async () => {
    mockFindMany.mockResolvedValue([row("org-fine", 40)]);
    const out = await refreshAgencyCredentials({ now: NOW, force: true });
    expect(mockExchange).toHaveBeenCalledWith("token-org-fine");
    expect(out.outcomes[0].status).toBe("refreshed");
  });

  it("calls a token that comes back no later than the one held not-extended, and keeps it", async () => {
    mockFindMany.mockResolvedValue([row("org-due", 10)]);
    mockExchange.mockResolvedValue({ accessToken: "same-life", expiresAt: new Date(NOW.getTime() + 10 * DAY) });
    const out = await refreshAgencyCredentials({ now: NOW });
    expect(out.outcomes[0].status).toBe("not-extended");
    const written = updateFor("org-due").data;
    expect(decrypt(written.accessToken, agencyProvider("org-due"))).toBe("same-life");
    expect(written.lastError).toMatch(/reconnected/);
  });

  it("stops at the deadline and counts what it left", async () => {
    mockFindMany.mockResolvedValue([row("org-a", 3), row("org-b", 3)]);
    const out = await refreshAgencyCredentials({ now: NOW, deadlineAt: Date.now() - 1 });
    expect(out).toMatchObject({ considered: 0, skipped: 2 });
    expect(mockExchange).not.toHaveBeenCalled();
  });
});

describe("storeAgencyCredential", () => {
  it("encrypts under the org's own provider and records the account in source", async () => {
    await storeAgencyCredential("org-x", {
      accessToken: "agency-token",
      expiresAt: new Date(NOW.getTime() + 60 * DAY),
      account: { igUserId: "ig-x", username: "x", pageId: "p", fbUserId: "f" },
      now: NOW,
    });
    const { where, create, update } = mockUpsert.mock.calls[0][0];
    expect(where).toEqual({ provider: "instagram_business:org:org-x" });
    expect(decrypt(create.accessToken, "instagram_business:org:org-x")).toBe("agency-token");
    expect(() => decrypt(create.accessToken, INSTAGRAM_BUSINESS_PROVIDER)).toThrow();
    expect(parseAgencyMeta(update.source)).toEqual({ via: "oauth", igUserId: "ig-x", username: "x", pageId: "p", fbUserId: "f" });
    expect(update.createdAt).toEqual(NOW);
  });

  it("reads no account out of a source that is not its JSON", () => {
    expect(parseAgencyMeta("manual")).toBeNull();
    expect(parseAgencyMeta('{"username":"x"}')).toBeNull();
  });
});
