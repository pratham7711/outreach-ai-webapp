/**
 * @jest-environment node
 *
 * Serving a kept copy (lib/posts/thumbnailResponse). Copies are kept as AVIF
 * for sounds and campaigns and as WebP for posts; every one leaves as a WebP of
 * the box the page asked for, and a copy that cannot be resized is still
 * labelled as what it is.
 */
import sharp from "sharp";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { resizeImage } from "@/lib/media/loadImage";

const picture = () => sharp({ create: { width: 600, height: 600, channels: 3, background: "#3a6" } }).png().toBuffer();

it("turns a kept AVIF into a WebP of the asked box", async () => {
  const kept = await resizeImage(await picture(), false, 384, 384, "inside", "avif");
  expect((await sharp(kept).metadata()).compression).toBe("av1");

  const res = await serveThumbnail({ data: new Uint8Array(kept), fetchedAt: new Date(0) }, 128, 128, resizeImage);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/webp");
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["webp", 128, 128]);
});

it("labels a copy it could not resize by what the bytes are", async () => {
  const kept = await resizeImage(await picture(), false, 64, 64, "inside", "avif");
  const failing = async () => {
    throw new Error("resize failed");
  };
  const avif = await serveThumbnail({ data: new Uint8Array(kept), fetchedAt: null }, 32, 32, failing);
  expect(avif.headers.get("Content-Type")).toBe("image/avif");

  const webp = await resizeImage(await picture(), false, 64, 64);
  const asWebp = await serveThumbnail({ data: new Uint8Array(webp), fetchedAt: null }, 32, 32, failing);
  expect(asWebp.headers.get("Content-Type")).toBe("image/webp");
});
