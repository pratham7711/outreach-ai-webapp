/**
 * One shape, two transports, for the campaign post list.
 *
 * The Posts tab is the campaign page's default view, so its fetch is the
 * heaviest thing the dashboard does: 492 posts on the largest campaign. That
 * response used to be 1,233.9 KB of JSON, and 39.5% of it was `__cc` -- the
 * importer's verbatim copy of the CreatorCore record, which is already stored
 * in the CcPost table (measured: 18,638 of 18,638 posts join to a CcPost row
 * whose `raw` is byte-identical) and which no runtime code has ever read. It
 * was being serialised and shipped to every browser for nothing.
 *
 * So the DTO below is the whole contract, and `__cc` is simply not in it.
 * `toPostDto` is the ONLY place the response shape is decided, which is what
 * keeps the two transports honest: JSON and protobuf serialise the same object,
 * so they cannot drift into disagreeing about what a post is.
 *
 * Measured on that campaign, brotli -- the figure that matters, since the raw
 * ratio flatters protobuf by counting key names gzip would have collapsed:
 *
 *     JSON as it shipped before        80.2 KB
 *     JSON, __cc dropped               54.7 KB
 *     protobuf, __cc dropped           37.4 KB
 *
 * The client pays 12.3 KB gzipped once (3.9 KB codec + 8.4 KB runtime) and
 * saves 17.3 KB on every list fetch, so it is ahead from the first load. Raw
 * bytes fall 742.4 -> 182.8 KB, which is the part a slow phone feels: that is
 * how much less there is to parse before the tab can paint.
 */
import { outreach } from "./postList.generated.js";

const PostListMessage = outreach.postlist.v1.PostList;

/** What `Accept` must carry to get protobuf back instead of JSON. */
export const POST_LIST_CONTENT_TYPE = "application/x-protobuf";

/**
 * Protobuf is opt-in, never sniffed.
 *
 * A caller that says nothing -- curl, a health check, an integration test, an
 * older tab still running the previous bundle -- keeps getting JSON. That is
 * what makes this deployable in one push rather than a coordinated flag day.
 */
export function wantsProtobuf(accept: string | null | undefined): boolean {
  return typeof accept === "string" && accept.includes(POST_LIST_CONTENT_TYPE);
}

export type CreatorDto = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
};

export type SnapshotDto = {
  id: string;
  viewsCount: number;
  recordedAt: string;
};

export type ComplianceFlagDto = {
  code: string;
  severity: string;
  message: string;
};

/**
 * The provenance half of the platformMetrics bag, rebuilt on the client so
 * `fieldMetricValue` and `lastFetchNote` keep reading the keys they already
 * read. The bag's other occupants stay server-side: `__cc` duplicates CcPost,
 * `__stat` is importer bookkeeping, and neither is rendered.
 */
export type PlatformMetricsDto = {
  __measured?: string[];
  __lastFetch?: { reason: string; at: string; via: string };
} | null;

export type PostDto = {
  id: string;
  platform: string;
  platformPostId: string;
  postUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  mediaType: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  downloadsCount: number;
  engagementRate: number;
  status: string;
  fetchState: string | null;
  rejectionReason: string | null;
  lastSyncedAt: string | null;
  authorProfilePic: string | null;
  createdAt: string | null;
  hasOpenFraudFlag: boolean;
  platformMetrics: PlatformMetricsDto;
  creator: CreatorDto | null;
  snapshots: SnapshotDto[];
  complianceFlags: ComplianceFlagDto[];
};

/** A post row as it arrives from Prisma, loosely typed so this file owns no query. */
type PostRow = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  /* protobufjs hands back a Long for int64 whenever the `long` package is
     installed -- which it is, as a transitive dependency -- so a decoded count
     is an object with low/high words, not a number. Reading `.toNumber()` off
     it here is what keeps that detail from leaking into every call site. */
  if (v && typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return 0;
};

const iso = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && v !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};

const ms = (v: unknown): number | null => {
  const s = iso(v);
  return s === null ? null : Date.parse(s);
};

const msToIso = (v: unknown): string | null => {
  const n = num(v);
  return n === 0 ? null : new Date(n).toISOString();
};

/** Keep only the two keys the browser renders; drop `__cc` and `__stat`. */
function provenanceFrom(platformMetrics: unknown): PlatformMetricsDto {
  if (typeof platformMetrics !== "object" || platformMetrics === null) return null;
  const bag = platformMetrics as Record<string, unknown>;
  const out: NonNullable<PlatformMetricsDto> = {};

  const measured = bag.__measured;
  if (Array.isArray(measured)) {
    const fields = measured.filter((f): f is string => typeof f === "string");
    if (fields.length) out.__measured = fields;
  }

  const note = bag.__lastFetch;
  if (typeof note === "object" && note !== null) {
    const n = note as Record<string, unknown>;
    if (typeof n.reason === "string") {
      out.__lastFetch = { reason: n.reason, at: str(n.at), via: str(n.via) };
    }
  }

  return Object.keys(out).length ? out : null;
}

/**
 * The single definition of what one post looks like on the wire.
 *
 * Both transports go through here, so the protobuf path can never carry a
 * different set of fields from the JSON path -- the failure mode that makes
 * content negotiation worth avoiding when it is bolted on per-encoder.
 */
export function toPostDto(row: PostRow, hasOpenFraudFlag: boolean, complianceFlags: ComplianceFlagDto[]): PostDto {
  const creator = row.creator as Record<string, unknown> | null | undefined;
  const snapshots = Array.isArray(row.snapshots) ? (row.snapshots as Record<string, unknown>[]) : [];

  return {
    id: str(row.id),
    platform: str(row.platform),
    platformPostId: str(row.platformPostId),
    postUrl: str(row.postUrl),
    thumbnailUrl: strOrNull(row.thumbnailUrl),
    caption: strOrNull(row.caption),
    mediaType: strOrNull(row.mediaType),
    postedAt: iso(row.postedAt) ?? "",
    viewsCount: num(row.viewsCount),
    likesCount: num(row.likesCount),
    commentsCount: num(row.commentsCount),
    sharesCount: num(row.sharesCount),
    savesCount: num(row.savesCount),
    downloadsCount: num(row.downloadsCount),
    engagementRate: typeof row.engagementRate === "number" ? row.engagementRate : 0,
    status: str(row.status),
    fetchState: strOrNull(row.fetchState),
    rejectionReason: strOrNull(row.rejectionReason),
    lastSyncedAt: iso(row.lastSyncedAt),
    authorProfilePic: strOrNull(row.authorProfilePic),
    createdAt: iso(row.createdAt),
    hasOpenFraudFlag,
    platformMetrics: provenanceFrom(row.platformMetrics),
    creator: creator
      ? {
          id: str(creator.id),
          name: str(creator.name),
          handle: str(creator.handle),
          avatarUrl: strOrNull(creator.avatarUrl),
        }
      : null,
    snapshots: snapshots.map((s) => ({
      id: str(s.id),
      viewsCount: num(s.viewsCount),
      recordedAt: iso(s.recordedAt) ?? "",
    })),
    complianceFlags,
  };
}

export function encodePostList(posts: PostDto[]): Uint8Array {
  return PostListMessage.encode({
    posts: posts.map((p) => ({
      id: p.id,
      platform: p.platform,
      platformPostId: p.platformPostId,
      postUrl: p.postUrl,
      thumbnailUrl: p.thumbnailUrl ?? undefined,
      caption: p.caption ?? undefined,
      mediaType: p.mediaType ?? undefined,
      postedAtMs: ms(p.postedAt) ?? undefined,
      viewsCount: p.viewsCount,
      likesCount: p.likesCount,
      commentsCount: p.commentsCount,
      sharesCount: p.sharesCount,
      savesCount: p.savesCount,
      downloadsCount: p.downloadsCount,
      engagementRate: p.engagementRate,
      status: p.status,
      fetchState: p.fetchState ?? undefined,
      rejectionReason: p.rejectionReason ?? undefined,
      lastSyncedAtMs: ms(p.lastSyncedAt) ?? undefined,
      authorProfilePic: p.authorProfilePic ?? undefined,
      createdAtMs: ms(p.createdAt) ?? undefined,
      hasOpenFraudFlag: p.hasOpenFraudFlag,
      creator: p.creator
        ? {
            id: p.creator.id,
            name: p.creator.name,
            handle: p.creator.handle,
            avatarUrl: p.creator.avatarUrl ?? undefined,
          }
        : undefined,
      snapshots: p.snapshots.map((s) => ({
        id: s.id,
        viewsCount: s.viewsCount,
        recordedAtMs: ms(s.recordedAt) ?? undefined,
      })),
      complianceFlags: p.complianceFlags.map((f) => ({
        code: f.code,
        severity: f.severity,
        message: f.message,
      })),
      provenance: p.platformMetrics
        ? {
            measured: p.platformMetrics.__measured ?? [],
            lastFetchReason: p.platformMetrics.__lastFetch?.reason,
            lastFetchAt: p.platformMetrics.__lastFetch?.at,
            lastFetchVia: p.platformMetrics.__lastFetch?.via,
          }
        : undefined,
    })),
  }).finish();
}

export function decodePostList(bytes: Uint8Array): PostDto[] {
  const decoded = PostListMessage.decode(bytes);
  const posts = decoded.posts ?? [];

  return posts.map((p): PostDto => {
    const prov = p.provenance;
    let platformMetrics: PlatformMetricsDto = null;
    if (prov) {
      const bag: NonNullable<PlatformMetricsDto> = {};
      if (prov.measured?.length) bag.__measured = prov.measured.slice();
      if (prov.lastFetchReason) {
        bag.__lastFetch = {
          reason: prov.lastFetchReason,
          at: prov.lastFetchAt ?? "",
          via: prov.lastFetchVia ?? "",
        };
      }
      if (Object.keys(bag).length) platformMetrics = bag;
    }

    return {
      id: p.id ?? "",
      platform: p.platform ?? "",
      platformPostId: p.platformPostId ?? "",
      postUrl: p.postUrl ?? "",
      thumbnailUrl: p.thumbnailUrl ?? null,
      caption: p.caption ?? null,
      mediaType: p.mediaType ?? null,
      postedAt: msToIso(p.postedAtMs) ?? "",
      viewsCount: num(p.viewsCount),
      likesCount: num(p.likesCount),
      commentsCount: num(p.commentsCount),
      sharesCount: num(p.sharesCount),
      savesCount: num(p.savesCount),
      downloadsCount: num(p.downloadsCount),
      engagementRate: p.engagementRate ?? 0,
      status: p.status ?? "",
      fetchState: p.fetchState ?? null,
      rejectionReason: p.rejectionReason ?? null,
      lastSyncedAt: msToIso(p.lastSyncedAtMs),
      authorProfilePic: p.authorProfilePic ?? null,
      createdAt: msToIso(p.createdAtMs),
      hasOpenFraudFlag: p.hasOpenFraudFlag ?? false,
      platformMetrics,
      creator: p.creator
        ? {
            id: p.creator.id ?? "",
            name: p.creator.name ?? "",
            handle: p.creator.handle ?? "",
            avatarUrl: p.creator.avatarUrl ?? null,
          }
        : null,
      snapshots: (p.snapshots ?? []).map((s) => ({
        id: s.id ?? "",
        viewsCount: num(s.viewsCount),
        recordedAt: msToIso(s.recordedAtMs) ?? "",
      })),
      complianceFlags: (p.complianceFlags ?? []).map((f) => ({
        code: f.code ?? "",
        severity: f.severity ?? "",
        message: f.message ?? "",
      })),
    };
  });
}
