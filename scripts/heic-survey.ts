import { db } from "../lib/db";
import { mediaUrl } from "../lib/postMedia";

/**
 * No browser decodes HEIC, so any avatar served as image/heic renders as
 * initials no matter what we do in the markup. CreatorCore carries a
 * "heicConvert" flag on every post, which is the same problem solved upstream.
 * Sample each source to see how much of it is undecodable.
 */
async function head(url: string | null): Promise<string> {
  if (!url) return "none";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    return `${res.status} ${res.headers.get("content-type") ?? "?"}`;
  } catch {
    return "failed";
  }
}

async function survey(label: string, urls: (string | null)[]) {
  const counts: Record<string, number> = {};
  for (const u of urls) {
    const k = await head(mediaUrl(u));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log(`\n  ${label} (n=${urls.length})`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(3)}  ${k}`);
  }
}

async function main() {
  const pics = await db.post.findMany({
    where: { authorProfilePic: { not: null } },
    select: { authorProfilePic: true },
    take: 12,
  });
  await survey("Post.authorProfilePic", pics.map((p) => p.authorProfilePic));

  const avs = await db.creator.findMany({
    where: { avatarUrl: { not: null } },
    select: { avatarUrl: true },
    take: 12,
  });
  await survey("Creator.avatarUrl", avs.map((c) => c.avatarUrl));

  const thumbs = await db.post.findMany({
    where: { thumbnailUrl: { not: null } },
    select: { thumbnailUrl: true },
    take: 8,
  });
  await survey("Post.thumbnailUrl", thumbs.map((p) => p.thumbnailUrl));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
