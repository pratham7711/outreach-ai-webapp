import { db } from "@/lib/db";
import { isMissingRulesTable } from "@/lib/campaigns/rulesDdl";

/**
 * A post's boost code, submission notes and exclusion reason (PostAnnotation).
 * Reads answer "none" and writes are skipped when the table does not exist yet
 * (lib/campaigns/rulesDdl.ts), so nothing that calls these can fail on a
 * database the DDL has not reached.
 */

export type PostAnnotationView = {
  boostCode: string | null;
  boostCodeExpiresAt: string | null;
  ruleNotes: string[];
  exclusionReason: string | null;
};

export const BOOST_CODE_MAX = 300;
export const EXCLUSION_REASON_MAX = 200;

const VIEW_SELECT = { postId: true, boostCode: true, boostCodeExpiresAt: true, ruleNotes: true, exclusionReason: true } as const;

async function readAnnotations(where: { orgId: string; postId?: { in: string[] }; post?: { campaignId: string } }) {
  try {
    const rows = await db.postAnnotation.findMany({ where, select: VIEW_SELECT });
    const out: Record<string, PostAnnotationView> = {};
    for (const r of rows) {
      out[r.postId] = {
        boostCode: r.boostCode,
        boostCodeExpiresAt: r.boostCodeExpiresAt?.toISOString() ?? null,
        ruleNotes: r.ruleNotes ?? [],
        exclusionReason: r.exclusionReason,
      };
    }
    return out;
  } catch (e) {
    if (isMissingRulesTable(e)) return {};
    throw e;
  }
}

/** Every annotated post of a campaign, keyed by post id; removed posts included. */
export function loadPostAnnotations(campaignId: string, orgId: string): Promise<Record<string, PostAnnotationView>> {
  return readAnnotations({ orgId, post: { campaignId } });
}

/** Annotations for the given posts only, keyed by post id. */
export async function loadAnnotationsForPosts(postIds: string[], orgId: string): Promise<Record<string, PostAnnotationView>> {
  if (postIds.length === 0) return {};
  return readAnnotations({ orgId, postId: { in: postIds } });
}

/** True when the write landed, false when the table is not there yet. */
async function guarded(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (e) {
    if (isMissingRulesTable(e)) return false;
    throw e;
  }
}

export function annotatePost(
  postId: string,
  orgId: string,
  patch: { boostCode?: string | null; boostCodeExpiresAt?: Date | null; ruleNotes?: string[]; exclusionReason?: string | null },
): Promise<boolean> {
  return guarded(() =>
    db.postAnnotation.upsert({ where: { postId }, create: { postId, orgId, ...patch }, update: patch }),
  );
}

/** Stamps (or, with null, clears) the reason on posts just removed or restored. */
export function setExclusionReason(postIds: string[], orgId: string, reason: string | null): Promise<boolean> {
  if (postIds.length === 0) return Promise.resolve(true);
  if (reason === null) {
    return guarded(() =>
      db.postAnnotation.updateMany({ where: { postId: { in: postIds }, orgId }, data: { exclusionReason: null } }),
    );
  }
  return guarded(() =>
    db.$transaction(
      postIds.map((postId) =>
        db.postAnnotation.upsert({
          where: { postId },
          create: { postId, orgId, exclusionReason: reason },
          update: { exclusionReason: reason },
        }),
      ),
    ),
  );
}

/** A boost code as typed: whitespace trimmed; empty is "none". */
export function cleanBoostCode(raw: unknown): { code: string | null; error?: string } {
  if (raw === undefined || raw === null) return { code: null };
  if (typeof raw !== "string") return { code: null, error: "Boost code must be text" };
  const code = raw.trim();
  if (!code) return { code: null };
  if (code.length > BOOST_CODE_MAX) return { code: null, error: `Boost code is longer than ${BOOST_CODE_MAX} characters` };
  return { code };
}

/** A YYYY-MM-DD (or ISO) expiry; empty is "not given". */
export function cleanExpiry(raw: unknown): { at: Date | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { at: null };
  const at = new Date(String(raw));
  if (Number.isNaN(at.getTime())) return { at: null, error: "Expiry is not a date" };
  return { at };
}
