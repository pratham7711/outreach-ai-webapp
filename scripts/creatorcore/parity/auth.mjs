/**
 * One login, reused across every run and every viewport.
 *
 * The session is stored at ~/.config/creatorcore/state.json, mode 600, and
 * deliberately OUTSIDE the repo: a Bubble session cookie is bearer-equivalent
 * to the password, so it must not sit anywhere a `git add -A` could reach.
 *
 * Readiness is decided by the text "Campaigns & Reporting" -- the first nav
 * group label, guaranteed present once the app has rendered. `waitForURL`
 * alone is not enough here: this Bubble app rewrites the query string while
 * still showing a spinner, so the URL settles well before the DOM does.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadSecrets, maskEmail, refUrl } from "./secrets.mjs";

const STATE_DIR = path.join(homedir(), ".config", "creatorcore");
export const STATE_FILE = path.join(STATE_DIR, "state.json");

/** The nav group label that proves the dashboard shell has rendered. */
export const READY_TEXT = "Campaigns & Reporting";

/**
 * MEASURED (2026-09-13): /settings is a DIFFERENT SHELL. It has no sidebar rail
 * and never contains "Campaigns & Reporting", so waiting for that text timed out
 * on all 7 settings surfaces -- 45s each, 28 wasted timeouts across 4 viewports.
 *
 * So readiness is the generic signal both shells share: the document title is
 * set to "<Screen> | CreatorCore" only once the screen has resolved, and real
 * body text has arrived. The rail label stays as a fast path for dashboard
 * pages, never as a requirement.
 */
export async function waitForAppReady(page, timeout = 60_000) {
  const TITLE_OK = () => /CreatorCore/.test(document.title);

  try {
    await page.waitForFunction(
      () =>
        /CreatorCore/.test(document.title) &&
        (document.body?.innerText || "").trim().length > 200,
      null,
      { timeout: Math.min(timeout, 20_000) }
    );
    return "content";
  } catch {
    /* A NEARLY EMPTY SCREEN IS STILL A SCREEN. Measured: the campaign
       Documents tab has almost no text, so a content-length predicate timed
       out on it for all three fixtures and threw away a surface that the
       parity work specifically wants -- the empty case is the one the PRD
       calls "too quiet to spec from" and we keep it precisely AS the empty
       case. Fall back to the title alone rather than dropping the capture. */
  }

  await page.waitForFunction(TITLE_OK, null, { timeout: Math.min(timeout, 20_000) });
  return "title-only";
}

/**
 * Logs in with a throwaway context and writes the storage state. Only called
 * when there is no usable state file, so a normal run performs zero logins.
 */
export async function mintSession(browser) {
  const { baseUrl, email, password } = loadSecrets();
  console.log(`[auth] logging in as ${maskEmail(email)}`);

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(refUrl(baseUrl, "/auth"), { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Login" }).click();
    await waitForAppReady(page);

    mkdirSync(STATE_DIR, { recursive: true });
    const state = await context.storageState();
    writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
    chmodSync(STATE_FILE, 0o600);
    console.log(`[auth] session saved to ${STATE_FILE}`);
  } finally {
    await context.close();
  }
}

/**
 * Returns a storageState path for newContext(). Mints one first if needed.
 * `force` re-mints after an expired session.
 */
export async function ensureSession(browser, { force = false } = {}) {
  if (force || !existsSync(STATE_FILE)) {
    await mintSession(browser);
  } else {
    console.log("[auth] reusing saved session");
  }
  return STATE_FILE;
}

/**
 * Opens a page and proves it rendered. On failure it re-mints ONCE and retries,
 * which is what makes an expired cookie a non-event rather than a run of 90
 * blank screenshots -- the failure mode that is otherwise invisible, because a
 * logged-out Bubble page still screenshots perfectly well.
 */
export async function gotoReference(browser, contextRef, url, { retried = false } = {}) {
  const page = await contextRef.context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForAppReady(page, 45_000);
    return page;
  } catch (err) {
    await page.close();
    if (retried) throw err;
    console.log("[auth] page never became ready -- re-minting the session and retrying once");
    await page.context().close();
    await ensureSession(browser, { force: true });
    contextRef.context = await browser.newContext({
      ...contextRef.options,
      storageState: STATE_FILE,
    });
    return gotoReference(browser, contextRef, url, { retried: true });
  }
}
