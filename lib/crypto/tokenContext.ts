// Which AAD sealed a CreatorSocialAccount's tokens.
//
// lib/crypto/encrypt.ts builds the AAD as `enc:v1:<context>` and does NOT store
// it in the envelope, so a reader has to reproduce the context string
// independently. Every row written before this module passed the owning org's
// id. Once a connection is owned by the global CreatorUser instead of a
// per-org Creator there is no orgId to reproduce — and an open-signup creator
// no agency has rostered has no Creator row at all, so there is no org to seal
// against in the first place.
//
// New rows are therefore sealed with the row's own cuid. A cuid never changes
// and never depends on ownership, so it survives every re-parenting; the
// binding is still real, because a ciphertext lifted into another row will not
// decrypt. Every read site already selects `id`, so the context costs nothing.
//
// Why a stored marker rather than trying one AAD and falling back to the other:
// AES-GCM reports exactly one failure, "tag mismatch". A genuinely corrupt
// ciphertext is indistinguishable from a correct one opened with the wrong AAD,
// so a silent fallback would hide a backfill that missed rows — and every
// caller of decrypt() here swallows the throw (the four *Token.ts helpers
// return undefined, which surfaces as needsReconnect; the sync cron
// `continue`s). With the scheme recorded on the row, a decrypt failure is a
// real error worth alerting on.

/** Sealed with the row's own id. What every new row uses. */
export const TOKEN_AAD_ROW = "row";

/**
 * Sealed with the owning org's id, reachable via creatorId -> Creator.orgId and
 * captured on the row as legacyAadOrgId by the backfill.
 *
 * NULL means the same thing: it is what rows carried before the column existed.
 */
export const TOKEN_AAD_ORG = "org";

/**
 * The three columns any read path must select to be able to decrypt.
 *
 * Exported as a Prisma `select` fragment so a call site cannot select the
 * ciphertext without also selecting what opens it — the failure mode otherwise
 * is a row that reads as "token unusable" for the rest of its life.
 */
export const TOKEN_AAD_SELECT = {
  id: true,
  tokenAad: true,
  legacyAadOrgId: true,
} as const;

export type TokenAadRow = {
  id: string;
  tokenAad: string | null;
  legacyAadOrgId: string | null;
};

export class TokenAadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenAadError";
  }
}

/**
 * The AAD context for this row's accessToken and refreshToken.
 *
 * Throws rather than guessing. An undecidable row is a bug in the backfill or
 * in a `select`, and returning some plausible-looking context would turn that
 * bug into a permanently dead credential discovered weeks later.
 */
export function tokenAadFor(row: TokenAadRow): string {
  const marker = row.tokenAad;

  if (marker === TOKEN_AAD_ROW) {
    if (!row.id) {
      throw new TokenAadError(
        `Row is sealed with "${TOKEN_AAD_ROW}" but carries no id.`,
      );
    }
    return row.id;
  }

  if (marker === null || marker === TOKEN_AAD_ORG) {
    if (!row.legacyAadOrgId) {
      throw new TokenAadError(
        `Row ${row.id} is sealed with the legacy org AAD but carries no legacyAadOrgId. ` +
          `Either the backfill has not reached it or the read path did not select the column.`,
      );
    }
    return row.legacyAadOrgId;
  }

  throw new TokenAadError(
    `Row ${row.id} carries an unknown tokenAad ${JSON.stringify(marker)}; ` +
      `expected "${TOKEN_AAD_ROW}", "${TOKEN_AAD_ORG}" or null.`,
  );
}

/** Whether this row still needs the re-encryption pass. */
export function needsReseal(row: Pick<TokenAadRow, "tokenAad">): boolean {
  return row.tokenAad !== TOKEN_AAD_ROW;
}
