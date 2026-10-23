/**
 * @jest-environment node
 *
 * The campaign picture formats a browser cannot draw, through the real decoders
 * (sharp, and libheif for HEIC). The form now sends these unshrunk
 * (components/campaigns/ThumbnailDrop), so the server is the only thing that
 * reads them: an SVG logo, a TIFF, and an iPhone HEIC saved as .jpg, which
 * arrives declared image/jpeg. Each must be kept as our own 384px AVIF.
 *
 * One the browser can neither shrink nor send under the 4 MB request cap comes
 * gzipped (X-Picture-Encoding: gzip), and the route unpacks it up to 64 MB.
 */
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: {
      updateMany: jest.fn(),
      findFirst: jest.fn(async () => ({ id: "camp-1", orgId: "org-1", title: "Camp", thumbnailUrl: null, createdById: "u1" })),
    },
    campaignThumbnail: { upsert: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));
jest.mock("@/lib/authz", () => ({
  requirePermission: jest.fn(async () => ({
    ok: true,
    auth: { orgId: "org-1", userId: "u1", actorEmail: "a@b.c", actorType: "user", role: "OWNER", campaignScope: "ALL" },
  })),
}));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn(), getAuditActor: () => ({ userId: "u1" }) }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { db } from "@/lib/db";
import { storeCampaignThumbnailUpload } from "@/lib/campaigns/thumbnailCopy";
import { PUT } from "@/app/api/campaigns/[id]/thumbnail/route";

const mdb = db as unknown as { campaignThumbnail: { upsert: jest.Mock }; campaign: { findFirst: jest.Mock } };
const MB = 1024 * 1024;

function put(body: Buffer, headers: Record<string, string>): Promise<NextResponse> {
  const req = new NextRequest("http://localhost/api/campaigns/camp-1/thumbnail", {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "content-length": String(body.byteLength), ...headers },
  });
  return PUT(req, { params: Promise.resolve({ id: "camp-1" }) }) as Promise<NextResponse>;
}
const campaign = { id: "camp-1", orgId: "org-1" };
const ORIGIN = "https://campaign.example.com";

async function storedPicture() {
  const data = mdb.campaignThumbnail.upsert.mock.calls.at(-1)?.[0]?.create?.data as Uint8Array;
  return sharp(Buffer.from(data)).metadata();
}

beforeEach(() => {
  mdb.campaignThumbnail.upsert.mockClear();
});

describe("pictures the browser cannot decode, read by the server", () => {
  it("keeps an SVG logo as a raster AVIF", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#5b5bd6"/></svg>',
    );
    const result = await storeCampaignThumbnailUpload(campaign, svg, ORIGIN, false);
    expect(result.stored).toBe(true);
    const meta = await storedPicture();
    expect(meta.format).toBe("heif");
    expect(meta.compression).toBe("av1");
    expect([meta.width, meta.height]).toEqual([384, 192]);
  });

  it("keeps a TIFF", async () => {
    const tiff = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ff0000" } }).tiff().toBuffer();
    expect((await storeCampaignThumbnailUpload(campaign, tiff, ORIGIN, false)).stored).toBe(true);
    expect([(await storedPicture()).width, (await storedPicture()).height]).toEqual([384, 384]);
  });

  it("keeps an iPhone HEIC that was saved as .jpg and declared image/jpeg", async () => {
    const heic = readFileSync(path.join(__dirname, "../fixtures/heic-saved-as.jpg"));
    const result = await storeCampaignThumbnailUpload(campaign, heic, ORIGIN, false);
    expect(result.stored).toBe(true);
    const meta = await storedPicture();
    expect(meta.compression).toBe("av1");
    expect([meta.width, meta.height]).toEqual([384, 288]);
  });

  it("still refuses bytes that are no picture, writing nothing", async () => {
    const result = await storeCampaignThumbnailUpload(campaign, Buffer.from("%PDF-1.7 not a picture"), ORIGIN, false);
    expect(result).toEqual({ stored: false, status: 422, failure: "not an image" });
    expect(mdb.campaignThumbnail.upsert).not.toHaveBeenCalled();
  });
});

describe("a picture sent gzipped, because the browser could not shrink it under 4 MB", () => {
  it("is unpacked and kept, though it is over 4 MB as a file", async () => {
    const tiff = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#22aa66" } }).tiff({ compression: "none" }).toBuffer();
    expect(tiff.byteLength).toBeGreaterThan(4 * MB);
    const packed = gzipSync(tiff);
    expect(packed.byteLength).toBeLessThan(4 * MB);

    const res = await put(packed, { "content-type": "image/tiff", "x-picture-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect((await storedPicture()).compression).toBe("av1");
    expect([(await storedPicture()).width, (await storedPicture()).height]).toEqual([384, 288]);
  });

  it("stops unpacking at 64 MB, so a small body cannot inflate without end", async () => {
    const bomb = gzipSync(Buffer.alloc(65 * MB));
    expect(bomb.byteLength).toBeLessThan(1 * MB);
    const res = await put(bomb, { "content-type": "image/tiff", "x-picture-encoding": "gzip" });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "That picture is over 64 MB." });
    expect(mdb.campaignThumbnail.upsert).not.toHaveBeenCalled();
  });

  it("refuses a body that says gzip but is not, writing nothing", async () => {
    const res = await put(Buffer.from("not gzip at all"), { "content-type": "image/tiff", "x-picture-encoding": "gzip" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "That file could not be read as a picture." });
    expect(mdb.campaignThumbnail.upsert).not.toHaveBeenCalled();
  });

  it("still holds an unpacked body to 4 MB", async () => {
    const res = await put(Buffer.alloc(4 * MB + 1), { "content-type": "image/tiff" });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "That picture is over 4 MB." });
  });
});
