/**
 * @jest-environment node
 *
 * TikTok signs its cover URLs: they carry an x-expires and stop resolving once
 * it passes. A stored cover therefore fails silently -- nothing errors, the
 * sound keeps taking readings, and a campaign report simply loses its artwork.
 * These are the rules for deciding a stored one is worth replacing.
 */
import { isCoverUrlStale, signedUrlExpiry } from "@/lib/sounds/coverUrl";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const at = (msFromNow: number) =>
  `https://p16-sign-sg.tiktokcdn.com/cover.jpeg?x-expires=${Math.floor(
    (NOW + msFromNow) / 1000,
  )}&x-signature=abc`;

it("reads the expiry out of a signed URL", () => {
  expect(signedUrlExpiry(at(0))).toBe(Math.floor(NOW / 1000) * 1000);
});

it("reports no expiry for a URL that carries none", () => {
  expect(signedUrlExpiry("https://p77-sg.tiktokcdn.com/cover.jpeg")).toBeNull();
});

/* Some stored covers are a Bubble CDN wrapper with the TikTok URL
   percent-encoded inside, so the separator arrives as %3D rather than =. 196 of
   the 288 signed thumbnails in this database are that shape. */
it("reads the expiry through a percent-encoded wrapper", () => {
  const wrapped =
    `https://cdn.bubble.io/f/x?src=https%3A%2F%2Ftiktokcdn.com%2Fc.jpeg` +
    `%3Fx-expires%3D${Math.floor(NOW / 1000)}%26x-signature%3Dabc`;
  expect(signedUrlExpiry(wrapped)).toBe(Math.floor(NOW / 1000) * 1000);
});

it("treats a missing cover as stale, which is the plain backfill", () => {
  expect(isCoverUrlStale(null, NOW)).toBe(true);
  expect(isCoverUrlStale("", NOW)).toBe(true);
});

it("leaves an unsigned cover alone", () => {
  // Somebody's own upload or a permanent link: it has no timer to run out.
  expect(isCoverUrlStale("https://p77-sg.tiktokcdn.com/cover.jpeg", NOW)).toBe(false);
});

it("leaves a signed cover alone while it has time left", () => {
  expect(isCoverUrlStale(at(48 * HOUR), NOW)).toBe(false);
});

it("replaces a signed cover that has already expired", () => {
  expect(isCoverUrlStale(at(-1 * HOUR), NOW)).toBe(true);
});

/* Renewed a cadence early rather than at the wire: the sweep gets several more
   chances before the image actually dies, and a nightly reader still gets one. */
it("replaces a signed cover inside the refresh margin", () => {
  expect(isCoverUrlStale(at(2 * HOUR), NOW)).toBe(true);
  expect(isCoverUrlStale(at(13 * HOUR), NOW)).toBe(false);
});
