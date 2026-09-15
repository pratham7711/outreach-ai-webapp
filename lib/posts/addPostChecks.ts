/**
 * The two questions every pasted post link has to answer before it is saved:
 * whose post is this, and do we already have it.
 *
 * Both used to be asked only inside the POST handler, one link at a time, which
 * meant an operator pasting twenty links learned about the eleventh one's
 * problem after ten had already been created. The rules live here so the same
 * answers can be shown in the dialog before anything is submitted -- one
 * implementation, so the preview cannot promise something the save then refuses.
 */
import { db } from "@/lib/db";
import { creatorHandleVariants } from "@/lib/creator-auth";
import { resolveAuthorFromPlatform } from "@/lib/platforms/postAuthor";
import { detectPlatform } from "@/lib/platforms/fetchPostMetrics";
import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import type { Platform, Prisma } from "@/lib/generated/prisma/client";

/**
 * The creator a URL's handle names, or null if the roster has nobody by that
 * name.
 *
 * Two places are consulted, not one. `Creator.handle` is the roster's own
 * spelling, and `CreatorSocialAccount.handle` is what each connected platform
 * calls them -- a creator whose roster entry reads "jane" but who connected
 * TikTok as "@jane.official" is the same person, and matching only the first
 * column reported them as missing. Case-insensitive and "@"-tolerant on both,
 * via the same creatorHandleVariants() the portal and the creators route use.
 *
 * Always scoped to the org: a pasted URL is untrusted input and must never
 * reach across a tenant.
 */
export async function findCreatorByHandle(
  orgId: string,
  handle: string,
  platform?: Platform,
): Promise<{ id: string; name: string; handle: string } | null> {
  const variants = creatorHandleVariants(handle);
  const handleClauses = variants.map((h) => ({ handle: { equals: h, mode: "insensitive" as const } }));

  const direct = await db.creator.findFirst({
    where: { orgId, deletedAt: null, OR: handleClauses },
    select: { id: true, name: true, handle: true },
  });
  if (direct) return direct;

  /* The linked-account spelling. Platform-narrowed when the URL said which one
     it is, so an Instagram "@jane" cannot be answered with the creator who
     happens to hold that name on YouTube. */
  const social = await db.creatorSocialAccount.findFirst({
    where: {
      ...(platform ? { platform } : {}),
      OR: handleClauses,
      creator: { orgId, deletedAt: null },
    },
    select: { creator: { select: { id: true, name: true, handle: true } } },
  });
  return social?.creator ?? null;
}

/**
 * The URL with only its fragment removed.
 *
 * Deliberately NOT the query string: a YouTube link carries its video id in
 * ?v=, so stripping the query leaves "https://www.youtube.com/watch", which as
 * a prefix matches every YouTube post in the org. Query strings are only
 * noise on platforms whose detector already extracts the id, and there the id
 * is what identity is taken from -- so nothing is gained by guessing which
 * parameters matter on a platform we have no detector for.
 */
export function canonicalPostUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`.replace(/\/+$/, "");
  } catch {
    return url;
  }
}

export type ExistingPost = {
  id: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  creatorHandle: string;
};

/**
 * Every post already on record that is the *same post* as this URL, across the
 * whole org.
 *
 * Identity is the platform's own post id wherever we have it. The raw URL is
 * not a reliable key: TikTok's share sheet appends is_from_webapp,
 * sender_device and a per-browser web_id, so the same video copied from two
 * browsers gives two strings that an equality check reads as two posts. Rows
 * whose first metrics read failed store the URL in platformPostId instead (see
 * the POST handler), which is why both columns are searched, and why postUrl is
 * matched on its canonical prefix rather than in full.
 *
 * Scoped by campaign.orgId -- Post has no orgId of its own.
 */
export async function findExistingPosts(orgId: string, postUrl: string): Promise<ExistingPost[]> {
  const detected = detectPlatform(postUrl);
  const canonical = canonicalPostUrl(postUrl);

  const identity: Prisma.PostWhereInput[] = [];
  if (detected) {
    /* Narrowed to the platform every time. The id alone is a bare number on
       TikTok and eleven characters on YouTube, and `contains` is what reaches
       rows that stored the whole URL -- both in platformPostId, which is where
       a post whose first metrics read failed keeps it, and in postUrl, where
       the stored copy carries whichever tracking parameters that paste had. */
    identity.push({ platform: detected.platform, platformPostId: detected.id });
    identity.push({ platform: detected.platform, platformPostId: { contains: detected.id } });
    identity.push({ platform: detected.platform, postUrl: { contains: detected.id } });
  } else {
    /* No detector claims this link, so the URL is the only identity there is
       and it is compared whole. Guessing which of its query parameters are
       tracking would merge two genuinely different posts. */
    identity.push({ postUrl: { in: [postUrl, canonical] } });
    identity.push({ platformPostId: { in: [postUrl, canonical] } });
  }

  const rows = await db.post.findMany({
    where: { campaign: { orgId, deletedAt: null }, OR: identity },
    select: {
      id: true,
      campaignId: true,
      campaign: { select: { title: true } },
      creator: { select: { id: true, name: true, handle: true } },
    },
    // A link can legitimately sit in a handful of campaigns; nobody needs to
    // read a list of forty, and the count is what the warning actually says.
    take: 10,
  });

  return rows.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    campaignName: r.campaign.title,
    creatorId: r.creator.id,
    creatorName: r.creator.name,
    creatorHandle: r.creator.handle,
  }));
}

export type PostPrecheck = {
  url: string;
  platform: Platform | null;
  mediaType: string | null;
  /** The handle, without its "@". Absent only when nobody could name one. */
  handle: string | null;
  /**
   * Where that handle came from. "url" is the handle written in the link;
   * "platform" is the one the platform answered with for a link that carries
   * none, and "record" is the creator the org already files this exact post
   * under in another campaign. Null when there is no handle at all.
   */
  handleSource: "url" | "platform" | "record" | null;
  /** The platform's display name for that author, when it gave one. */
  authorName: string | null;
  creator: { id: string; name: string; handle: string } | null;
  /** No creator matched, but the link names one and this seat may add them. */
  creatorWillBeAdded: boolean;
  /** The same post already in the campaign being added to. */
  inThisCampaign: ExistingPost | null;
  /** The same post in other campaigns in this org. */
  inOtherCampaigns: ExistingPost[];
};

/**
 * Everything the Add Post dialog needs to colour a row before submission: what
 * the link is, whether a creator can be resolved for it, and where the post
 * already lives.
 */
export async function precheckPostUrl(
  orgId: string,
  campaignId: string,
  url: string,
  /** Whether this seat holds creators:create -- what decides between "we will
   *  add them" and "pick somebody, you cannot add one". */
  mayCreateCreator: boolean,
): Promise<PostPrecheck> {
  const detected = detectPlatform(url);
  const urlHandle = detected?.handle?.replace(/^@/, "") ?? null;

  /* Only when the link itself names nobody. A YouTube watch URL carries no
     channel and an operator was being asked to supply one the platform will
     hand over for free -- see resolveAuthorFromPlatform for what each platform
     actually answers. Runs alongside the row reads rather than before them,
     because it is a network call and the rest of this is indexed lookups. */
  const [fromPlatform, existing] = await Promise.all([
    urlHandle ? Promise.resolve(null) : resolveAuthorFromPlatform(url, detected?.platform),
    findExistingPosts(orgId, url),
  ]);
  const handle = urlHandle ?? fromPlatform?.handle ?? null;
  const byHandle = handle ? await findCreatorByHandle(orgId, handle, detected?.platform) : null;

  /* Last, and only when nothing named anybody: the org's own copy of this exact
     post. A link the platform will not talk about -- a deleted Instagram reel,
     a private video -- is still a post somebody already filed against a
     creator here, and asking again for an answer we hold is friction over
     nothing. It is the same post by platform post id, inside the same org, so
     the creator is not a guess.

     Only when NOTHING named anybody, not merely when the roster has no match:
     a link that names @jane belongs to @jane even if an older copy of the post
     was filed against somebody else, and quietly preferring the older filing
     would spread one wrong attribution to every later paste of that link. */
  const fromRecord = !handle && existing.length > 0 ? existing[0] : null;
  const creator =
    byHandle ??
    (fromRecord
      ? { id: fromRecord.creatorId, name: fromRecord.creatorName, handle: fromRecord.creatorHandle }
      : null);

  return {
    url,
    platform: detected?.platform ?? null,
    mediaType: detected?.mediaType ?? null,
    handle: handle ?? fromRecord?.creatorHandle.replace(/^@/, "") ?? null,
    handleSource: handle ? (urlHandle ? "url" : "platform") : fromRecord ? "record" : null,
    authorName: fromPlatform?.name ?? null,
    creator,
    creatorWillBeAdded: Boolean(handle) && !creator && mayCreateCreator,
    inThisCampaign: existing.find((e) => e.campaignId === campaignId) ?? null,
    inOtherCampaigns: existing.filter((e) => e.campaignId !== campaignId),
  };
}

/**
 * The creator a link names, creating the roster entry if we do not have one.
 *
 * A client sends the week's links; some of them are from creators nobody has
 * typed into the roster yet. Refusing those was the wrong end of the trade --
 * the link already names the account, so the roster entry is derivable, and
 * making an operator leave the dialog, add a creator by hand and paste the
 * batch again is work the app can do itself.
 *
 * Nothing is invented. The handle comes from the URL, and the figures come from
 * the platform's own profile page. That read is best effort: TikTok answers
 * some regions with a login wall, and a creator with a zero follower count that
 * the next tracker sweep fills in is far better than a refused post.
 */
export async function ensureCreatorForHandle(
  orgId: string,
  handle: string,
  platform: Platform,
): Promise<{ creator: { id: string; name: string; handle: string }; created: boolean }> {
  const existing = await findCreatorByHandle(orgId, handle, platform);
  if (existing) return { creator: existing, created: false };

  let followersCount = 0;
  let averageViews = 0;
  try {
    const read = await readCreatorProfile(platform, handle);
    if (read.ok) {
      followersCount = read.profile.followersCount;
      // Only a mean actually taken over posts. sampledPosts 0 means the reader
      // saw no posts, and writing its 0 would claim we measured one.
      averageViews = read.profile.sampledPosts > 0 ? read.profile.avgViews : 0;
    }
  } catch {
    /* Unreachable platform, throttle, WAF. The row is still worth creating. */
  }

  /* Raced two ways: two links from the same new creator in one batch are
     submitted back to back, and the whole batch runs sequentially against a
     pooled connection. Re-checking inside the create's failure path is cheaper
     than a unique constraint the schema deliberately does not have -- 23
     handles imported from CreatorCore are already duplicated, so the column
     cannot be made unique without deciding which of those rows is real. */
  try {
    const created = await db.creator.create({
      data: {
        orgId,
        // The handle is the only name the link gives. A real display name
        // arrives with the first tracker sweep rather than being guessed here.
        name: handle,
        handle,
        platform,
        followersCount,
        averageViews,
      },
      select: { id: true, name: true, handle: true },
    });
    return { creator: created, created: true };
  } catch (e) {
    const again = await findCreatorByHandle(orgId, handle, platform);
    if (again) return { creator: again, created: false };
    throw e;
  }
}
