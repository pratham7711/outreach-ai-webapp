import { db } from "../lib/db";
import { mediaUrl } from "../lib/postMedia";

/** Can Next's built-in optimiser re-encode a HEIC avatar into something a browser shows? */
async function main() {
  const p = await db.post.findFirst({
    where: { authorProfilePic: { not: null } },
    select: { authorProfilePic: true },
  });
  const raw = mediaUrl(p?.authorProfilePic);
  if (!raw) {
    console.log("no profile pic found");
    return;
  }
  console.log(`  upstream length: ${raw.length}`);

  const direct = await fetch(raw, { signal: AbortSignal.timeout(15_000) });
  console.log(`  upstream direct:   HTTP ${direct.status} ${direct.headers.get("content-type")}`);

  const opt = `http://localhost:3047/_next/image?url=${encodeURIComponent(raw)}&w=64&q=75`;
  const res = await fetch(opt, { signal: AbortSignal.timeout(30_000) });
  const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
  console.log(`  via optimiser:     HTTP ${res.status} ${res.headers.get("content-type")} bytes=${buf.byteLength}`);
  if (!res.ok) {
    console.log(`  body: ${Buffer.from(buf).toString("utf8").slice(0, 200)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
