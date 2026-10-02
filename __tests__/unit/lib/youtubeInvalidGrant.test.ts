/**
 * @jest-environment node
 *
 * Google's invalid_grant means "Reconnect needed" and nothing more.
 *
 * While Google's app is in Testing mode every refresh token dies after seven
 * days, so this signal arrives for EVERY YouTube connection, every week. If it
 * deleted anything, every YouTube connection would be wiped weekly. These tests
 * pin that it marks, stops reading, and never deletes or blanks a token.
 */
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/platforms/accountState", () => ({
  isReconnectNeeded: jest.fn(),
  markReconnectNeeded: jest.fn(),
}));

import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto/encrypt";
import { isReconnectNeeded, markReconnectNeeded } from "@/lib/platforms/accountState";
import { ensureFreshYouTubeToken } from "@/lib/platforms/youtubeToken";

const mockDb = db as unknown as {
  creatorSocialAccount: { update: jest.Mock; delete: jest.Mock; deleteMany: jest.Mock };
};
const mockIsMarked = isReconnectNeeded as jest.Mock;
const mockMark = markReconnectNeeded as jest.Mock;

const ORG = "org-1";
const originalFetch = global.fetch;
const savedEnv = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

function expiredAccount() {
  return {
    id: "sa-yt",
    accessToken: encrypt("old-access", ORG),
    refreshToken: encrypt("dead-refresh", ORG),
    tokenExpiry: new Date(Date.now() - 60_000),
  };
}

function googleAnswers(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "g-id";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  mockIsMarked.mockResolvedValue(false);
  mockMark.mockResolvedValue(true);
});

afterAll(() => {
  global.fetch = originalFetch;
  if (savedEnv.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = savedEnv.id;
  if (savedEnv.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = savedEnv.secret;
});

describe("ensureFreshYouTubeToken on invalid_grant", () => {
  it("marks the connection Reconnect needed and deletes nothing", async () => {
    googleAnswers(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });

    await expect(ensureFreshYouTubeToken(expiredAccount(), ORG)).resolves.toBeUndefined();

    expect(mockMark).toHaveBeenCalledWith("sa-yt", "invalid_grant");
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
    // Not even an update: the stored refresh token and history stay as they were.
    expect(mockDb.creatorSocialAccount.update).not.toHaveBeenCalled();
  });

  it("does not mark on any other failure, which is worth retrying tomorrow", async () => {
    googleAnswers(500, { error: "backend_error" });
    await expect(ensureFreshYouTubeToken(expiredAccount(), ORG)).resolves.toBeUndefined();
    expect(mockMark).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("stops asking Google once the connection is marked", async () => {
    mockIsMarked.mockResolvedValue(true);
    global.fetch = jest.fn();
    await expect(ensureFreshYouTubeToken(expiredAccount(), ORG)).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });

  it("deletes nothing even when the mark cannot be stored (table absent)", async () => {
    mockMark.mockResolvedValue(false);
    googleAnswers(400, { error: "invalid_grant" });
    await expect(ensureFreshYouTubeToken(expiredAccount(), ORG)).resolves.toBeUndefined();
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("refreshes and stores a working token exactly as before", async () => {
    googleAnswers(200, { access_token: "new-access", expires_in: 3600 });
    await expect(ensureFreshYouTubeToken(expiredAccount(), ORG)).resolves.toBe("new-access");
    expect(mockMark).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.update).toHaveBeenCalledTimes(1);
    const { where, data } = mockDb.creatorSocialAccount.update.mock.calls[0][0];
    expect(where).toEqual({ id: "sa-yt" });
    expect(data.tokenExpiry).toBeInstanceOf(Date);
  });

  it("serves a token that has not expired without asking anyone", async () => {
    global.fetch = jest.fn();
    const live = { ...expiredAccount(), tokenExpiry: new Date(Date.now() + 30 * 60_000) };
    await expect(ensureFreshYouTubeToken(live, ORG)).resolves.toBe("old-access");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockIsMarked).not.toHaveBeenCalled();
  });
});
