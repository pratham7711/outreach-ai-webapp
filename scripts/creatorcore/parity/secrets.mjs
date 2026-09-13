/**
 * Credentials for the CreatorCore reference account.
 *
 * The older cc-*.mjs scripts read CC_EMAIL / CC_PASSWORD out of a `.env` that
 * does not exist in this checkout, so they throw ENOENT before they reach the
 * login. The real file is ~/.config/creatorcore/secrets.env, mode 600, kept
 * outside the repo on purpose -- it is not in ~/brain either, because that
 * syncs to GitHub.
 *
 * Two things that file does which a naive parser gets wrong, and both have
 * already broken a script here:
 *   - every value is double-quoted, so an unstripped read produces
 *     `""https://app.creatorcore.co"/auth"` and the navigation fails;
 *   - a password may legitimately contain `=`, so the split is on the FIRST
 *     `=` only.
 *
 * The reference org is READ-ONLY. Nothing in this directory may click a
 * control that writes.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SECRETS_FILE = path.join(homedir(), ".config", "creatorcore", "secrets.env");

/** Strips one matched pair of surrounding quotes. Leaves inner quotes alone. */
function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  return v;
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = unquote(trimmed.slice(eq + 1));
  }
  return out;
}

/** `a***@example.com` -- enough to tell which account ran, never the address. */
export function maskEmail(email) {
  const [user = "", domain = ""] = String(email).split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

/**
 * Accepts both name families: the CREATORCORE_* names the real file uses, and
 * the CC_* names the older scripts expect, so this module can back them too.
 * Environment variables win over the file, which is what lets CI inject them.
 */
export function loadSecrets() {
  let fromFile = {};
  try {
    fromFile = parseEnvFile(readFileSync(SECRETS_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const pick = (...names) => {
    for (const n of names) {
      if (process.env[n]) return process.env[n];
      if (fromFile[n]) return fromFile[n];
    }
    return undefined;
  };

  const baseUrl = pick("CREATORCORE_URL", "CC_URL") ?? "https://app.creatorcore.co";
  const email = pick("CREATORCORE_EMAIL", "CC_EMAIL");
  const password = pick("CREATORCORE_PASSWORD", "CC_PASSWORD");

  if (!email || !password) {
    throw new Error(
      `No CreatorCore credentials. Expected CREATORCORE_EMAIL / CREATORCORE_PASSWORD in ${SECRETS_FILE} (mode 600) or in the environment.`
    );
  }

  return { baseUrl, email, password };
}

/**
 * Always build reference URLs through this. String concatenation against a
 * base that still carries its quotes is the exact bug that broke cc-login.
 */
export function refUrl(baseUrl, pathOrQuery) {
  return new URL(pathOrQuery, baseUrl).toString();
}
