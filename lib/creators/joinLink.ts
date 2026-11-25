import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { isMissingJoinLinkTable } from "./joinLinkDdl";

/**
 * Join links: /join/<code>, one per agency. The link sends a creator to sign
 * up (or sign in) on the creator portal; once they have, they are put on that
 * agency's roster (lib/portal/joinAgency.ts) and asked to connect accounts.
 */

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 12;
const CODE_PATTERN = /^[a-z0-9]{12}$/;

/** 12 characters from an alphabet without 0/o and 1/l, so it survives being read aloud: ~60 bits. */
export function newJoinCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function isWellFormedJoinCode(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && CODE_PATTERN.test(raw);
}

export function joinLinkPath(code: string): string {
  return `/join/${code}`;
}

export type JoinLinkRow = { id: string; orgId: string; code: string; createdAt: Date; joinedCount: number; lastJoinedAt: Date | null };

const SELECT = { id: true, orgId: true, code: true, createdAt: true, joinedCount: true, lastJoinedAt: true } as const;

/** The org's live join link, or null (none made, turned off, or the table is not there yet). */
export async function liveJoinLink(orgId: string): Promise<JoinLinkRow | null> {
  try {
    return await db.orgJoinLink.findFirst({ where: { orgId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: SELECT });
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return null;
    throw e;
  }
}

/**
 * True when the org has had a join link and none is live now: someone turned
 * it off on purpose, so opening the dialog must not quietly make a new one.
 */
export async function joinLinkTurnedOff(orgId: string): Promise<boolean> {
  try {
    const live = await db.orgJoinLink.findFirst({ where: { orgId, revokedAt: null }, select: { id: true } });
    if (live) return false;
    return (await db.orgJoinLink.count({ where: { orgId } })) > 0;
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return false;
    throw e;
  }
}

/** Turns off the live link and makes a new one: "make" and "make a new one" are the same act. */
export async function issueJoinLink(orgId: string, createdById: string | null): Promise<JoinLinkRow | null> {
  try {
    const [, created] = await db.$transaction([
      db.orgJoinLink.updateMany({ where: { orgId, revokedAt: null }, data: { revokedAt: new Date() } }),
      db.orgJoinLink.create({ data: { orgId, code: newJoinCode(), createdById }, select: SELECT }),
    ]);
    return created;
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return null;
    throw e;
  }
}

export async function turnOffJoinLink(orgId: string): Promise<number> {
  try {
    const { count } = await db.orgJoinLink.updateMany({ where: { orgId, revokedAt: null }, data: { revokedAt: new Date() } });
    return count;
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return 0;
    throw e;
  }
}

export type JoinBinding = { linkId: string; orgId: string; agency: string };

async function bindingWhere(where: { code: string }): Promise<JoinBinding | null> {
  try {
    const row = await db.orgJoinLink.findUnique({
      where,
      select: { id: true, orgId: true, revokedAt: true, organization: { select: { name: true } } },
    });
    if (!row || row.revokedAt) return null;
    return { linkId: row.id, orgId: row.orgId, agency: row.organization.name || "Your agency" };
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return null;
    throw e;
  }
}

/** The live link behind a /join/<code> URL, or null. */
export async function resolveJoinCode(code: string | null | undefined): Promise<JoinBinding | null> {
  if (!isWellFormedJoinCode(code)) return null;
  return bindingWhere({ code });
}

export async function recordJoin(linkId: string): Promise<void> {
  try {
    await db.orgJoinLink.update({ where: { id: linkId }, data: { joinedCount: { increment: 1 }, lastJoinedAt: new Date() } });
  } catch {
    /* Bookkeeping only; the creator is already on the roster. */
  }
}
