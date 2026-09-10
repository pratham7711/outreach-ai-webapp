/**
 * What the app claims it can collect.
 *
 * This report drives user-facing copy: the onboarding step that names which
 * platforms refresh their own counts reads `metrics === "live"` off it. So a
 * wrong answer here is not an internal detail, it is a sentence a new user
 * reads on their first day.
 *
 * TikTok was the wrong answer for a long time, because the rule was "is
 * SOCIALKIT_API_KEY set" -- and SocialKit is the third rung of
 * fetchTikTokMetrics, behind a keyless read of the video page that works from
 * Vercel egress. Production had 422 cron-written TikTok snapshots with moving
 * counts while the onboarding told people TikTok would not update.
 */
import { resolvePlatformCapability, resolveCapabilities } from "@/lib/capabilities";

const KEYS = [
  "INSTAGRAM_BUSINESS_TOKEN",
  "YOUTUBE_API_KEY",
  "SOCIALKIT_API_KEY",
  "PLATFORM_CONNECT_STATUS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

it("reports TikTok metrics live with no credentials at all", () => {
  // The keyless rehydration read needs nothing provisioned.
  expect(resolvePlatformCapability("tiktok").metrics).toBe("live");
});

it("does not make TikTok metrics depend on the paid fallback key", () => {
  const without = resolvePlatformCapability("tiktok").metrics;
  process.env.SOCIALKIT_API_KEY = "sk-test";
  expect(resolvePlatformCapability("tiktok").metrics).toBe(without);
});

it("still gates Instagram and YouTube on their keys", () => {
  /* Not blanket optimism: these two genuinely cannot read a count without a
     credential, and saying otherwise would promise a refresh that never comes. */
  expect(resolvePlatformCapability("instagram").metrics).toBe("coming_soon");
  expect(resolvePlatformCapability("youtube").metrics).toBe("coming_soon");

  process.env.INSTAGRAM_BUSINESS_TOKEN = "ig-token";
  process.env.YOUTUBE_API_KEY = "yt-key";
  expect(resolvePlatformCapability("instagram").metrics).toBe("live");
  expect(resolvePlatformCapability("youtube").metrics).toBe("live");
});

it("says metrics are live overall even on an environment with nothing set", () => {
  /* The onboarding has a separate, bleaker branch for "no automatic collection
     at all". TikTok alone keeps that branch from firing, which is correct --
     it is the platform most posts are on. */
  expect(resolveCapabilities().anyMetricsLive).toBe(true);
});

it("gates TikTok sign-in on its credentials, and never hides the card", () => {
  /* Reading a post URL and signing an account in are still different
     capabilities -- metrics stay live above with nothing provisioned, while
     connect follows the credentials.

     What changed is that connect is no longer the hardcoded "coming_soon".
     That was the one status the settings screen reads as `comingSoon` and
     removes the card for outright, so there was no reachable Connect button
     and none of the four Login Kit scopes could be shown to a reviewer. Both
     ends are asserted here because "auto" is only honest if it actually
     answers gated when the keys are absent. */
  const TIKTOK_KEYS = [
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "TIKTOK_USE_SANDBOX",
    "TIKTOK_SANDBOX_CLIENT_KEY",
    "TIKTOK_SANDBOX_CLIENT_SECRET",
  ] as const;
  const before = Object.fromEntries(TIKTOK_KEYS.map((k) => [k, process.env[k]]));

  try {
    for (const k of TIKTOK_KEYS) delete process.env[k];
    expect(resolvePlatformCapability("tiktok").connect).toBe("gated");

    process.env.TIKTOK_CLIENT_KEY = "test-client-key";
    process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";
    expect(resolvePlatformCapability("tiktok").connect).toBe("live");
  } finally {
    for (const k of TIKTOK_KEYS) {
      const v = before[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

it("gates Instagram sign-in on its credentials the same way", () => {
  /* instagram was a hardcoded "gated", which renders the Connect button anyway
     and only changes the note beside it -- so the card said sign-in was
     unavailable next to a button that worked. */
  const IG_KEYS = ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"] as const;
  const before = Object.fromEntries(IG_KEYS.map((k) => [k, process.env[k]]));

  try {
    for (const k of IG_KEYS) delete process.env[k];
    expect(resolvePlatformCapability("instagram").connect).toBe("gated");

    process.env.INSTAGRAM_CLIENT_ID = "test-client-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "test-client-secret";
    expect(resolvePlatformCapability("instagram").connect).toBe("live");
  } finally {
    for (const k of IG_KEYS) {
      const v = before[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
