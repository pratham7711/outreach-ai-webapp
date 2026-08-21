/**
 * @jest-environment node
 *
 * The image proxy, and specifically the ways it is allowed to fail.
 *
 * Every avatar and thumbnail on every page is a request to this route, so a
 * throw here is not one broken picture — it is a 500 in the logs for each one,
 * and enough of them to hide a real fault. The rule the route has to keep is
 * that no input, and no upstream behaviour, produces an unhandled throw.
 *
 * It is also an open door if the allowlist slips: /api is excluded from
 * proxy.ts, so the session check and the host check are the only things
 * standing between this and an SSRF proxy anyone can drive.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "@/app/api/img/route";

const mockAuth = auth as unknown as jest.Mock;

const BUBBLE = "https://ea59c5ca94140c8b04f98dbfd0c628da.cdn.bubble.io/d283/x/y.png";

function req(u: string, extra = "") {
  return new NextRequest(`http://localhost:3009/api/img?u=${encodeURIComponent(u)}${extra}`);
}

/* A real PNG, encoded by the same library that will decode it, rather than a
   base64 literal — the first attempt at this used a well-travelled "1x1 PNG"
   string whose header parsed and whose pixels did not, which fails as a
   corrupt-input fixture rather than a valid one. */
let PIXEL_PNG: Buffer;
beforeAll(async () => {
  PIXEL_PNG = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 90, g: 91, b: 214 } },
  })
    .png()
    .toBuffer();
});

/* Stands in for a fetch Response. Only the four members the route touches are
   real, and arrayBuffer takes a thunk so a test can make the body fail on its
   own — which is the whole point of half of these. */
function upstream(body: Buffer | (() => never), init: ResponseInit & { length?: number | null } = {}) {
  const headers = new Headers(init.headers ?? { "content-type": "image/png" });
  if (init.length !== null) headers.set("content-length", String(init.length ?? PIXEL_PNG.byteLength));
  const res = {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers,
    arrayBuffer:
      typeof body === "function"
        ? async () => body()
        : async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
  return res as unknown as Response;
}

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
  global.fetch = jest.fn(async () => upstream(PIXEL_PNG)) as any;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("GET /api/img — the door", () => {
  it("refuses an unauthenticated caller before it fetches anything", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(req(BUBBLE));
    expect(res.status).toBe(401);
    // The point of the check: our bandwidth is not spent on their behalf.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("only fetches hosts we actually store URLs for", async () => {
    for (const host of [
      "https://evil.example.com/a.png",
      "https://cdn.bubble.io.evil.com/a.png", // suffix match, not substring
      "https://169.254.169.254/latest/meta-data/",
    ]) {
      const res = await GET(req(host));
      expect(res.status).toBe(403);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-https target and a malformed one without throwing", async () => {
    expect((await GET(req("http://ea59c5ca94140c8b04f98dbfd0c628da.cdn.bubble.io/a.png"))).status).toBe(400);
    expect((await GET(req("not-a-url"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost:3009/api/img"))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/img — upstream misbehaviour is a 502, never a 500", () => {
  it("survives a connection that never opens", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ETIMEDOUT");
    }) as any;
    const res = await GET(req(BUBBLE));
    expect(res.status).toBe(502);
  });

  it("survives a connection dropped mid-body", async () => {
    // Headers arrived, bytes did not. This threw outside any try/catch and
    // surfaced as a 500 — the failure mode this test exists for.
    global.fetch = jest.fn(async () =>
      upstream(() => {
        throw new TypeError("terminated");
      })
    ) as any;
    const res = await GET(req(BUBBLE));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("upstream failed");
  });

  it("passes an upstream error status through as a 502", async () => {
    global.fetch = jest.fn(async () => upstream(PIXEL_PNG, { status: 404 })) as any;
    expect((await GET(req(BUBBLE))).status).toBe(502);
  });

  it("refuses an oversize image on its declared length, before reading it", async () => {
    const arrayBuffer = jest.fn(async () => new ArrayBuffer(0));
    global.fetch = jest.fn(async () => {
      const res: any = upstream(PIXEL_PNG, { length: 50 * 1024 * 1024 });
      res.arrayBuffer = arrayBuffer;
      return res;
    }) as any;
    const res = await GET(req(BUBBLE));
    expect(res.status).toBe(413);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("still reads a body when the CDN declares no length at all", async () => {
    global.fetch = jest.fn(async () => upstream(PIXEL_PNG, { length: null })) as any;
    const res = await GET(req(BUBBLE));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/img — what it gives back", () => {
  it("re-encodes to webp at the size asked for, cached immutably", async () => {
    const res = await GET(req(BUBBLE, "&w=112&h=112"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("hands back a browser-readable source it cannot decode rather than failing the request", async () => {
    global.fetch = jest.fn(async () =>
      upstream(Buffer.from("<html>not an image</html>"), { headers: { "content-type": "image/png" } })
    ) as any;
    const res = await GET(req(BUBBLE));
    // Degraded, not broken: the browser gets bytes and shows its own placeholder,
    // and the page does not report an error for a decorative thumbnail.
    expect(res.status).toBe(200);
  });

  it("reports a HEIC it cannot decode, since passing those bytes on is useless", async () => {
    global.fetch = jest.fn(async () =>
      upstream(Buffer.from("not heic"), { headers: { "content-type": "image/heic" } })
    ) as any;
    const res = await GET(req(BUBBLE));
    expect(res.status).toBe(415);
  });

  it("clamps a hostile size instead of transcoding at it", async () => {
    // w=99999 would be a 10-gigapixel allocation per request.
    const res = await GET(req(BUBBLE, "&w=99999&h=-5"));
    expect(res.status).toBe(200);
  });
});
