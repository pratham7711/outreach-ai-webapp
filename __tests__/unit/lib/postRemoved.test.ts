/**
 * @jest-environment node
 *
 * "Remove from campaign" is a soft remove (lib/posts/removed). These pin the
 * one where-fragment every campaign read spreads, and the DDL production gets
 * before the code that reads the columns is deployed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  NOT_REMOVED,
  ONLY_REMOVED,
  REMOVED_POST_REFUSAL,
  isRemovedFromCampaign,
  notRemovedSql,
} from "@/lib/posts/removed";
import { POST_REMOVED_DDL } from "@/lib/posts/removedSchemaDdl";

describe("the removed-post where-fragment", () => {
  it("is removedAt null for Prisma, and the exact opposite for the Removed view", () => {
    expect(NOT_REMOVED).toEqual({ removedAt: null });
    expect(ONLY_REMOVED).toEqual({ removedAt: { not: null } });
  });

  it("spreads into a where without disturbing the rest of it", () => {
    expect({ campaignId: "c1", status: "APPROVED", ...NOT_REMOVED }).toEqual({
      campaignId: "c1",
      status: "APPROVED",
      removedAt: null,
    });
  });

  it("says the same thing in raw SQL, aliased or not", () => {
    expect(notRemovedSql("p")).toBe(`p."removedAt" IS NULL`);
    expect(notRemovedSql()).toBe(`"removedAt" IS NULL`);
  });

  it("tells a removed post from a live one, whatever shape the row arrives in", () => {
    expect(isRemovedFromCampaign({ removedAt: new Date() })).toBe(true);
    expect(isRemovedFromCampaign({ removedAt: "2026-10-14T00:00:00.000Z" })).toBe(true);
    expect(isRemovedFromCampaign({ removedAt: null })).toBe(false);
    expect(isRemovedFromCampaign({})).toBe(false);
    expect(isRemovedFromCampaign(null)).toBe(false);
  });

  it("refuses a write on a removed post with a code and a sentence", () => {
    expect(REMOVED_POST_REFUSAL.error).toBe("post_removed");
    expect(REMOVED_POST_REFUSAL.message).toMatch(/Restore it/);
  });
});

describe("removed-post DDL", () => {
  it("runs every statement idempotently", () => {
    expect(POST_REMOVED_DDL).toHaveLength(3);
    for (const stmt of POST_REMOVED_DDL) {
      expect(stmt).toMatch(/^(ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS |CREATE INDEX IF NOT EXISTS )/);
      expect(stmt).not.toContain(";");
    }
  });

  it("only adds: nullable columns and an index, never a drop, rewrite or backfill", () => {
    for (const stmt of POST_REMOVED_DDL) {
      expect(stmt).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT|RENAME|NOT NULL|DEFAULT|TYPE)\b/i);
    }
  });

  it("keeps the tracked migration on the same DDL", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261014090000_post_removed/migration.sql"),
      "utf8",
    );
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of POST_REMOVED_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  /* Prisma's default names and types for these fields. If either side drifts,
     a `prisma db push` on a dev database would build a second index beside the
     one production has, or fight over the column type. */
  it("matches the Post model in schema.prisma", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const post = /model Post \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    expect(post).toMatch(/\n\s+removedAt\s+DateTime\?\s*\n/);
    expect(post).toMatch(/\n\s+removedById\s+String\?\s*\n/);
    expect(post).toContain("@@index([campaignId, removedAt])");

    const index = POST_REMOVED_DDL.find((s) => s.startsWith("CREATE INDEX"))!;
    expect(index).toContain(`"Post_campaignId_removedAt_idx" ON "Post"("campaignId", "removedAt")`);
    expect(POST_REMOVED_DDL).toContain(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3)`);
    expect(POST_REMOVED_DDL).toContain(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "removedById" TEXT`);
  });
});
