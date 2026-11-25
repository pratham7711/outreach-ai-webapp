/**
 * @jest-environment node
 *
 * Ad blockers hide elements by class name on every site, and their
 * cookie-notice lists target the cookieconsent library's cc- classes, the
 * same prefix as ours. Brave applies those lists by default: .cc-dialog-backdrop
 * and .cc-banner were hidden there, so every dialog opened invisible and every
 * notice strip vanished (measured 2026-11-25 on the Join link dialog).
 *
 * The names below are every generic single-class "##.cc-..." rule in
 * EasyList, EasyList Cookie, Fanboy Cookiemonster and Fanboy Annoyance, read
 * 2026-11-25. A class this app defines must not be one of them.
 */
import { readFileSync } from "fs";
import path from "path";

const HIDDEN_BY_FILTER_LISTS = [
  "cc-CookieWarning",
  "cc-advert",
  "cc-banner",
  "cc-banner-granular",
  "cc-banner-popup-wrap",
  "cc-banner-wrapper",
  "cc-blockingScreen",
  "cc-cookie-banner",
  "cc-cookie-consent-banner-modal",
  "cc-cookiecontainer",
  "cc-cookies-container",
  "cc-cookies-overlay",
  "cc-cookies-page",
  "cc-customdialog",
  "cc-dialog-backdrop",
  "cc-dialog-pane",
  "cc-dialog-wrapper",
  "cc-fixed-bottom",
  "cc-fullscreen-bg",
  "cc-message-bottom",
  "cc-notification",
  "cc-onconsent-analytics",
  "cc-onconsent-social",
  "cc-privacy-bottom-container",
  "cc-window-banner",
];

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const defined = new Set(Array.from(css.matchAll(/\.(cc-[A-Za-z0-9_-]+)/g), (m) => m[1]));

describe("class names that ad blockers hide", () => {
  it("lists the two that were hit, so the list cannot go stale silently", () => {
    expect(HIDDEN_BY_FILTER_LISTS).toEqual(expect.arrayContaining(["cc-banner", "cc-dialog-backdrop"]));
  });

  it.each(HIDDEN_BY_FILTER_LISTS)("globals.css does not define .%s", (name) => {
    expect(defined.has(name)).toBe(false);
  });

  it("Modal and Banner render the renamed classes", () => {
    const modal = readFileSync(path.join(process.cwd(), "components/ds/Modal.tsx"), "utf8");
    const banner = readFileSync(path.join(process.cwd(), "components/ds/Banner.tsx"), "utf8");
    expect(modal).toContain('className="cc-dlg-scrim"');
    expect(banner).toContain("cc-callout");
    for (const name of HIDDEN_BY_FILTER_LISTS) {
      expect(modal).not.toMatch(new RegExp(`["\`\\s]${name}["\`\\s$]`));
      expect(banner).not.toMatch(new RegExp(`["\`\\s]${name}["\`\\s$]`));
    }
  });
});
