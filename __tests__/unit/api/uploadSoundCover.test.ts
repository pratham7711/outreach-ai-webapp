/**
 * @jest-environment node
 *
 * The admin hand-in for a cover the app cannot download from where it runs
 * (app/api/admin/upload-sound-cover). Pinned: the token gate, that only a real
 * picture is kept and only as the same bounded AVIF every other copy is, that
 * it is filed under the sound's own org, and that the link it came from is kept
 * so later readings recognise the picture.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";

jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findUnique: jest.fn() },
    soundCover: { upsert: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { POST } from "@/app/api/admin/upload-sound-cover/route";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const SOURCE = "https://p16-common.tiktokcdn-us.com/tos-alisg-v-2774/owg99~tplv-obj.jpeg";
const post = (body: Buffer | string, { token = "t0ken", soundId = "sound-1", source = SOURCE, headers = {} as Record<string, string> } = {}) =>
  POST(
    new NextRequest(
      `http://localhost/api/admin/upload-sound-cover?soundId=${encodeURIComponent(soundId)}&source=${encodeURIComponent(source)}`,
      { method: "POST", body: typeof body === "string" ? body : new Uint8Array(body), headers: { authorization: `Bearer ${token}`, ...headers } }
    )
  );
const png = (px: number) => sharp({ create: { width: px, height: px, channels: 3, background: "#c33" } }).png().toBuffer();

beforeEach(() => {
  jest.resetAllMocks();
  process.env.ADMIN_MIGRATE_TOKEN = "t0ken";
  mdb.tikTokSound.findUnique.mockResolvedValue({ orgId: "org-9" });
  mdb.soundCover.upsert.mockResolvedValue({});
});
afterAll(() => {
  delete process.env.ADMIN_MIGRATE_TOKEN;
});

it("is closed without the token", async () => {
  expect((await post(await png(10), { token: "nope" })).status).toBe(401);
  delete process.env.ADMIN_MIGRATE_TOKEN;
  expect((await post(await png(10))).status).toBe(404);
  expect(mdb.soundCover.upsert).not.toHaveBeenCalled();
});

it("keeps the picture as a bounded AVIF under the sound's own org, against its source link", async () => {
  const res = await post(await png(1200));
  expect(res.status).toBe(200);
  expect(mdb.tikTokSound.findUnique).toHaveBeenCalledWith({ where: { id: "sound-1" }, select: { orgId: true } });
  const write = mdb.soundCover.upsert.mock.calls[0][0];
  expect(write.where).toEqual({ soundId: "sound-1" });
  expect(write.create).toMatchObject({ soundId: "sound-1", orgId: "org-9", sourceUrl: SOURCE });
  expect(write.update).toMatchObject({ sourceUrl: SOURCE, failedAt: null, failure: null });
  const meta = await sharp(Buffer.from(write.create.data)).metadata();
  expect(meta.format).toBe("heif");
  expect(meta.compression).toBe("av1");
  expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(384);
});

it("refuses what is not a picture, an unknown sound, and an oversized body", async () => {
  expect((await post("<html>not a picture</html>")).status).toBe(422);
  mdb.tikTokSound.findUnique.mockResolvedValueOnce(null);
  expect((await post(await png(10))).status).toBe(404);
  expect((await post(await png(10), { headers: { "content-length": String(6 * 1024 * 1024) } })).status).toBe(413);
  expect(mdb.soundCover.upsert).not.toHaveBeenCalled();
});

it("needs a sound and an https source link", async () => {
  expect((await post(await png(10), { soundId: "" })).status).toBe(400);
  expect((await post(await png(10), { source: "" })).status).toBe(400);
  expect((await post(await png(10), { source: "http://example.com/a.jpg" })).status).toBe(400);
  expect(mdb.soundCover.upsert).not.toHaveBeenCalled();
});
