/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as deauthorize } from "@/app/api/webhooks/meta/deauthorize/route";
import { GET as deletionStatus, POST as dataDeletion } from "@/app/api/webhooks/meta/data-deletion/route";
import { signRequest } from "@/lib/oauth/metaSignedRequest";

jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      deleteMany: jest.fn(),
    },
  },
}));

import { db } from "@/lib/db";

const mockDb = db as unknown as { creatorSocialAccount: { deleteMany: jest.Mock } };

const ENV_KEYS = [
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "FACEBOOK_CLIENT_ID",
  "FACEBOOK_CLIENT_SECRET",
  "THREADS_CLIENT_ID",
  "THREADS_CLIENT_SECRET",
  "APP_URL",
  "NEXTAUTH_URL",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

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
});

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
    expect(where.platformUserId).toBe("17841400000000000");
    expect([...where.platform.in].sort()).toEqual(["FACEBOOK", "INSTAGRAM"]);
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
    expect(where.platform.in).toEqual(["THREADS"]);
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
    expect(body.confirmation_code).toMatch(/^12345-[0-9a-f]{16}$/);
    expect(body.url).toBe(
      `https://campaign.madeboring.com/api/webhooks/meta/data-deletion?code=${encodeURIComponent(body.confirmation_code)}`,
    );
    expect(mockDb.creatorSocialAccount.deleteMany).toHaveBeenCalledTimes(1);

    // The URL we handed back must answer for that code.
    const status = await deletionStatus(new NextRequest(body.url));
    expect(status.status).toBe(200);
    expect((await status.json()).status).toBe("complete");
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
