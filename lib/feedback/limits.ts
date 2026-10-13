/**
 * What a Feedback submission may carry, without the zod schema that enforces it.
 *
 * Split out of lib/feedback/submission so the Feedback button, which renders on
 * every dashboard page, does not import zod into the client bundle for one
 * number. lib/feedback/submission re-exports all of it and stays the authority.
 */
export const FEEDBACK_SURFACES = ["dashboard", "portal", "share", "list"] as const;
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

/** Decoded. A viewport JPEG measured 0.1-0.6 MB; Vercel refuses bodies over ~4.5 MB. */
export const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 4000;
