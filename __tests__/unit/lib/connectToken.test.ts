/**
 * @jest-environment node
 *
 * A connect link binds to exactly one roster row (orgId + creatorId), is
 * stored only as a hash, and travels through OAuth as a signed state that
 * cannot be edited to point at another row.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorConnectToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    creator: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { connectTablesReady } from "@/lib/creators/connectTables";
import {
  connectState,
  hashConnectToken,
  isWellFormedConnectToken,
  issueConnectToken,
  newConnectToken,
  readConnectState,
  resolveConnectToken,
} from "@/lib/creators/connectToken";

const mockDb = db as unknown as {
  creatorConnectToken: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  creator: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};
const mockReady = connectTablesReady as jest.Mock;
const savedSecret = process.env.NEXTAUTH_SECRET;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXTAUTH_SECRET = "test-auth-secret";
  mockReady.mockResolvedValue(true);
  mockDb.creator.findFirst.mockResolvedValue({ id: "c-bound", handle: "fake_handle" });
  mockDb.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = savedSecret;
});

describe("the token", () => {
  it("is 32 random bytes, URL-safe, and never repeats", () => {
    const a = newConnectToken();
    const b = newConnectToken();
    expect(a).not.toBe(b);
    expect(isWellFormedConnectToken(a)).toBe(true);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
  });

  it("is stored as a SHA-256 hash, not as itself", () => {
    const raw = newConnectToken();
    expect(hashConnectToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashConnectToken(raw)).not.toContain(raw);
  });

  it("rejects malformed tokens before any query", async () => {
    expect(await resolveConnectToken("short")).toBeNull();
    expect(await resolveConnectToken("x".repeat(42) + "!")).toBeNull();
    expect(mockDb.creatorConnectToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("resolveConnectToken", () => {
  const raw = "A".repeat(43);

  it("binds to the one roster row it was made for, by orgId AND id", async () => {
    mockDb.creatorConnectToken.findUnique
      .mockResolvedValueOnce({ id: "tok-1" })
      .mockResolvedValueOnce({ id: "tok-1", orgId: "org-a", creatorId: "c-bound", revokedAt: null });
    const binding = await resolveConnectToken(raw);
    expect(binding).toEqual({
      tokenId: "tok-1",
      orgId: "org-a",
      creatorId: "c-bound",
      creatorHandle: "fake_handle",
    });
    expect(mockDb.creatorConnectToken.findUnique.mock.calls[0][0].where).toEqual({
      tokenHash: hashConnectToken(raw),
    });
    // Never a handle match, never another org's row.
    expect(mockDb.creator.findFirst.mock.calls[0][0].where).toEqual({
      id: "c-bound",
      orgId: "org-a",
      deletedAt: null,
    });
  });

  it("refuses a revoked link", async () => {
    mockDb.creatorConnectToken.findUnique
      .mockResolvedValueOnce({ id: "tok-1" })
      .mockResolvedValueOnce({ id: "tok-1", orgId: "org-a", creatorId: "c-bound", revokedAt: new Date() });
    expect(await resolveConnectToken(raw)).toBeNull();
  });

  it("refuses a link whose roster row is gone", async () => {
    mockDb.creatorConnectToken.findUnique
      .mockResolvedValueOnce({ id: "tok-1" })
      .mockResolvedValueOnce({ id: "tok-1", orgId: "org-a", creatorId: "c-bound", revokedAt: null });
    mockDb.creator.findFirst.mockResolvedValue(null);
    expect(await resolveConnectToken(raw)).toBeNull();
  });

  it("refuses everything while the table does not exist", async () => {
    mockReady.mockResolvedValue(false);
    expect(await resolveConnectToken(raw)).toBeNull();
    expect(mockDb.creatorConnectToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("issueConnectToken", () => {
  it("revokes the row's live link and makes a new one, storing only its hash", async () => {
    mockDb.creatorConnectToken.updateMany.mockResolvedValue({ count: 1 });
    mockDb.creatorConnectToken.create.mockResolvedValue({ id: "tok-2", createdAt: new Date() });
    const issued = await issueConnectToken({ orgId: "org-a", creatorId: "c-bound", createdById: "u-1" });
    expect(issued && isWellFormedConnectToken(issued.token)).toBe(true);

    expect(mockDb.creatorConnectToken.updateMany.mock.calls[0][0].where).toEqual({
      orgId: "org-a",
      creatorId: "c-bound",
      revokedAt: null,
    });
    const data = mockDb.creatorConnectToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashConnectToken(issued!.token));
    expect(JSON.stringify(data)).not.toContain(issued!.token);
  });

  it("makes nothing while the table does not exist", async () => {
    mockReady.mockResolvedValue(false);
    expect(await issueConnectToken({ orgId: "org-a", creatorId: "c" })).toBeNull();
    expect(mockDb.creatorConnectToken.create).not.toHaveBeenCalled();
  });
});

describe("the OAuth state", () => {
  it("round-trips the token row id", () => {
    const state = connectState("tok-1")!;
    expect(state.startsWith("ct.")).toBe(true);
    expect(readConnectState(state)).toBe("tok-1");
  });

  it("refuses a state edited to point at another link", () => {
    const state = connectState("tok-1")!;
    const [p, nonce, , mac] = state.split(".");
    expect(readConnectState(`${p}.${nonce}.tok-2.${mac}`)).toBeNull();
  });

  it("refuses a state signed with another secret", () => {
    const state = connectState("tok-1")!;
    process.env.NEXTAUTH_SECRET = "a-different-secret";
    expect(readConnectState(state)).toBeNull();
  });

  it("ignores the plain random states the signed-in flow uses", () => {
    expect(readConnectState("0123456789abcdef0123456789abcdef")).toBeNull();
    expect(readConnectState(null)).toBeNull();
    expect(readConnectState("ct.nope")).toBeNull();
  });

  it("cannot be made without a secret", () => {
    delete process.env.NEXTAUTH_SECRET;
    const savedAuth = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(connectState("tok-1")).toBeNull();
    if (savedAuth !== undefined) process.env.AUTH_SECRET = savedAuth;
  });
});
