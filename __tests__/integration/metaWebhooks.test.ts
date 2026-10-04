/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as deauthorize } from "@/app/api/webhooks/meta/deauthorize/route";
import { GET as deletionStatus, POST as dataDeletion } from "@/app/api/webhooks/meta/data-deletion/route";
import { deletionConfirmationCode, signRequest } from "@/lib/oauth/metaSignedRequest";

jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      deleteMany: jest.fn(),
    },
    platformCredential: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

/* The grantor lookup (CreatorAccountState) — empty unless a test says the
   Facebook user granted something. */
jest.mock("@/lib/platforms/accountState", () => ({
  accountIdsForGrantor: jest.fn(),
}));

import { db } from "@/lib/db";
import { accountIdsForGrantor } from "@/lib/platforms/accountState";

const mockDb = db as unknown as {
  creatorSocialAccount: { deleteMany: jest.Mock };
  platformCredential: { findMany: jest.Mock; deleteMany: jest.Mock };
};
const mockGrantor = accountIdsForGrantor as jest.Mock;

const ENV_KEYS = [
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "FACEBOOK_CLIENT_ID",
  "FACEBOOK_CLIENT_SECRET",
  "THREADS_CLIENT_ID",
  "THREADS_CLIENT_SECRET",
  "INSTAGRAM_LOGIN_CLIENT_ID",
  "INSTAGRAM_LOGIN_CLIENT_SECRET",
  "APP_URL",
  "NEXTAUTH_URL",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

/** The JSON status API, asked about the code in the URL we handed Meta. */
function statusRequest(pageUrl: string) {
  const code = new URL(pageUrl).searchParams.get("code") ?? "";
  return new NextRequest(`https://campaign.madeboring.com/api/webhooks/meta/data-deletion?code=${encodeURIComponent(code)}`);
}

function formPost(url: string, signedRequest: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signedRequest }).toString(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.INSTAGRAM_CLIENT_ID = "ig-id";
  process.env.INSTAGRAM_CLIENT_SECRET = "meta-secret";
  process.env.THREADS_CLIENT_ID = "th-id";
  process.env.THREADS_CLIENT_SECRET = "threads-secret";
  process.env.APP_URL = "https://campaign.madeboring.com";
  mockDb.creatorSocialAccount.deleteMany.mockResolvedValue({ count: 2 });
  mockDb.platformCredential.findMany.mockResolvedValue([]);
  mockDb.platformCredential.deleteMany.mockResolvedValue({ count: 0 });
  mockGrantor.mockResolvedValue([]);
});

/** An org's own Instagram account row, as Settings → Integrations stores it. */
function agencyRow(orgId: string, fbUserId: string | null) {
  return {
    provider: `instagram_business:org:${orgId}`,
    source: JSON.stringify({ via: "oauth", igUserId: `ig-${orgId}`, username: `agency_${orgId}`, pageId: null, fbUserId }),
  };
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("POST /api/webhooks/meta/deauthorize", () => {
  it("forgets the user on every platform the signing app covers", async () => {
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "17841400000000000" }, "meta-secret"),
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 2 });
    expect(mockDb.creatorSocialAccount.deleteMany).toHaveBeenCalledTimes(1);
    const where = mockDb.creatorSocialAccount.deleteMany.mock.calls[0][0].where;
    expect([...where.platform.in].sort()).toEqual(["FACEBOOK", "INSTAGRAM"]);
    // Whatever matched on the account id before still matches.
    expect(where.AND[1].OR).toEqual([{ platformUserId: "17841400000000000" }]);
    // Instagram Login rows are a different grant and are left alone.
    expect(where.AND[0].OR).toEqual([
      { origin: null },
      { origin: { not: "oauth_instagram_login" } },
    ]);
  });

  it("finds Facebook and Instagram rows by the Facebook user who granted them", async () => {
    /* Meta sends the app-scoped Facebook USER id; the rows hold the Page or IG
       account id. Matching only platformUserId deleted nothing. */
    mockGrantor.mockResolvedValue(["sa-ig", "sa-fb"]);
    await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "fb-user-1" }, "meta-secret"),
      ),
    );
    expect(mockGrantor).toHaveBeenCalledWith("fb-user-1");
    const where = mockDb.creatorSocialAccount.deleteMany.mock.calls[0][0].where;
    expect(where.AND[1].OR).toEqual([
      { platformUserId: "fb-user-1" },
      { id: { in: ["sa-ig", "sa-fb"] } },
    ]);
  });

  it("also removes an agency's own Instagram account that this Facebook user granted", async () => {
    mockDb.platformCredential.findMany.mockResolvedValue([
      agencyRow("org-a", "fb-user-1"),
      agencyRow("org-b", "fb-user-2"),
      agencyRow("org-c", null),
    ]);
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "fb-user-1" }, "meta-secret"),
      ),
    );
    expect(await res.json()).toEqual({ ok: true, removed: 3 });
    expect(mockDb.platformCredential.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockDb.platformCredential.deleteMany.mock.calls[0][0]).toEqual({
      where: { provider: { in: ["instagram_business:org:org-a"] } },
    });
  });

  it("still forgets the creator rows when the agency lookup fails", async () => {
    mockDb.platformCredential.findMany.mockRejectedValue(new Error("db down"));
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "fb-user-1" }, "meta-secret"),
      ),
    );
    expect(await res.json()).toEqual({ ok: true, removed: 2 });
  });

  it("scopes a Threads-signed request to Threads rows only", async () => {
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "th-user" }, "threads-secret"),
      ),
    );
    expect(res.status).toBe(200);
    const where = mockDb.creatorSocialAccount.deleteMany.mock.calls[0][0].where;
    /* Exactly the match Threads had before the grantor work: its callback
       sends the Threads user id, which IS the stored platformUserId. */
    expect(where).toEqual({ platformUserId: "th-user", platform: "THREADS" });
    expect(mockGrantor).not.toHaveBeenCalled();
    expect(mockDb.platformCredential.findMany).not.toHaveBeenCalled();
  });

  it("verifies an Instagram Login request with that app's own secret and forgets only Instagram Login rows", async () => {
    process.env.INSTAGRAM_LOGIN_CLIENT_ID = "igl-id";
    process.env.INSTAGRAM_LOGIN_CLIENT_SECRET = "igl-secret";
    mockGrantor.mockResolvedValue(["sa-igl"]);
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "ig-scoped-1" }, "igl-secret"),
      ),
    );
    expect(res.status).toBe(200);
    const where = mockDb.creatorSocialAccount.deleteMany.mock.calls[0][0].where;
    expect(where).toEqual({
      platform: "INSTAGRAM",
      origin: "oauth_instagram_login",
      OR: [{ platformUserId: "ig-scoped-1" }, { id: { in: ["sa-igl"] } }],
    });
  });

  it("still rejects an Instagram Login request when that secret is not configured", async () => {
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "ig-scoped-1" }, "igl-secret"),
      ),
    );
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a bad signature and deletes nothing", async () => {
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ user_id: "u" }, "not-our-secret"),
      ),
    );
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a request with no signed_request at all", async () => {
    const res = await deauthorize(
      new NextRequest("https://campaign.madeboring.com/api/webhooks/meta/deauthorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a verified payload that names no user", async () => {
    const res = await deauthorize(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/deauthorize",
        signRequest({ issued_at: 1 }, "meta-secret"),
      ),
    );
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("accepts the JSON body form too", async () => {
    const res = await deauthorize(
      new NextRequest("https://campaign.madeboring.com/api/webhooks/meta/deauthorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signed_request: signRequest({ user_id: "u" }, "meta-secret") }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/webhooks/meta/data-deletion", () => {
  it("deletes synchronously and answers with a status URL and confirmation code", async () => {
    const res = await dataDeletion(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/data-deletion",
        signRequest({ user_id: "12345" }, "meta-secret"),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmation_code).toMatch(/^12345-d-[0-9a-f]{16}$/);
    // A page a person can read, not the JSON API.
    expect(body.url).toBe(
      `https://campaign.madeboring.com/data-deletion?code=${encodeURIComponent(body.confirmation_code)}`,
    );
    expect(mockDb.creatorSocialAccount.deleteMany).toHaveBeenCalledTimes(1);

    // The JSON status API still answers for that code.
    const status = await deletionStatus(statusRequest(body.url));
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.status).toBe("complete");
    expect(statusBody.deleted).toBe(true);
  });

  it("does not report a deletion when no row matched", async () => {
    mockDb.creatorSocialAccount.deleteMany.mockResolvedValue({ count: 0 });
    const res = await dataDeletion(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/data-deletion",
        signRequest({ user_id: "12345" }, "meta-secret"),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmation_code).toMatch(/^12345-n-[0-9a-f]{16}$/);

    const status = await deletionStatus(statusRequest(body.url));
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.deleted).toBe(false);
    expect(statusBody.detail).not.toMatch(/were deleted/);
    expect(statusBody.detail).toMatch(/nothing to delete/);
  });

  it("refuses a 'nothing held' code edited to claim a deletion", async () => {
    const none = deletionConfirmationCode("12345", "meta-secret", "none");
    const forged = none.replace("-n-", "-d-");
    const res = await deletionStatus(
      new NextRequest(`https://campaign.madeboring.com/api/webhooks/meta/data-deletion?code=${forged}`),
    );
    expect(res.status).toBe(404);
  });

  it("still answers for a code issued before codes recorded their outcome, without claiming a deletion", async () => {
    const legacy = deletionConfirmationCode("12345", "meta-secret");
    expect(legacy).toMatch(/^12345-[0-9a-f]{16}$/);
    const res = await deletionStatus(
      new NextRequest(`https://campaign.madeboring.com/api/webhooks/meta/data-deletion?code=${legacy}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.deleted).toBeUndefined();
  });

  it("rejects a bad signature and deletes nothing", async () => {
    const res = await dataDeletion(
      formPost(
        "https://campaign.madeboring.com/api/webhooks/meta/data-deletion",
        signRequest({ user_id: "u" }, "wrong"),
      ),
    );
    expect(res.status).toBe(400);
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/webhooks/meta/data-deletion", () => {
  it("404s a code it never issued", async () => {
    const res = await deletionStatus(
      new NextRequest("https://campaign.madeboring.com/api/webhooks/meta/data-deletion?code=12345-deadbeefdeadbeef"),
    );
    expect(res.status).toBe(404);
  });

  it("404s when no code is given", async () => {
    const res = await deletionStatus(
      new NextRequest("https://campaign.madeboring.com/api/webhooks/meta/data-deletion"),
    );
    expect(res.status).toBe(404);
  });
});
