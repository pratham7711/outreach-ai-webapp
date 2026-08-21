import sharp from "sharp";
import decodeHeic from "heic-decode";
import { db } from "../lib/db";
import { mediaUrl } from "../lib/postMedia";

/** Does the wasm decoder + sharp re-encode path actually produce a JPEG? */
async function main() {
  const posts = await db.post.findMany({
    where: { authorProfilePic: { not: null } },
    select: { authorProfilePic: true },
    take: 5,
  });
  for (const p of posts) {
    const url = mediaUrl(p.authorProfilePic);
    if (!url) continue;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type");
    try {
      const { width, height, data } = await decodeHeic({ buffer: buf });
      const out = await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
        .resize(96, 96, { fit: "cover", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const meta = await sharp(out).metadata();
      console.log(`  ${type} ${buf.byteLength}B -> decoded ${width}x${height} -> ${meta.format} ${meta.width}x${meta.height} ${out.byteLength}B`);
    } catch (e) {
      console.log(`  ${type} ${buf.byteLength}B -> FAILED: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
