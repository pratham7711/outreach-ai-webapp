import { clientCredentialsFor } from "@/lib/oauth/providers";
import { graphGet, InstagramAuthError } from "./instagram";

/**
 * What Meta says about a user or Page token, from debug_token.
 *
 * expiresAt: null means Meta reported expires_at 0 (the token does not
 * expire). dataAccessExpiresAt: null means none reported or 0. Both are only
 * meaningful when `valid` is true; a token Meta calls invalid is simply dead.
 */
export type MetaTokenFacts = {
  valid: boolean;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
};

function epochToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

/**
 * Reads debug_token for one token with the app's own credentials. Returns null
 * when the answer could not be obtained (no app credentials, Meta unreachable,
 * an unrecognisable reply), which callers must treat as "unknown, check again",
 * never as "fine".
 */
export async function debugMetaToken(token: string, signal?: AbortSignal): Promise<MetaTokenFacts | null> {
  const creds = clientCredentialsFor("instagram") ?? clientCredentialsFor("facebook");
  if (!creds) return null;
  let data: { data?: { is_valid?: unknown; expires_at?: unknown; data_access_expires_at?: unknown } } | null;
  try {
    data = await graphGet(
      "debug_token",
      { input_token: token, access_token: `${creds.clientId}|${creds.clientSecret}` },
      signal,
    );
  } catch (err) {
    if (err instanceof InstagramAuthError) return null;
    throw err;
  }
  const d = data?.data;
  if (!d || typeof d.is_valid !== "boolean") return null;
  return {
    valid: d.is_valid,
    expiresAt: epochToDate(d.expires_at),
    dataAccessExpiresAt: epochToDate(d.data_access_expires_at),
  };
}
