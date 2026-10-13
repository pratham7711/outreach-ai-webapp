import { z } from "zod";

/**
 * What a Feedback button press may send, and how it is cleaned before it is
 * stored. Nothing here trusts the browser: the screenshot must decode to a real
 * image of a bounded size, and the context is cut down to the fields the inbox
 * shows, each one length-capped, so a page cannot fill a row with whatever it
 * likes.
 */

/* The limits live in a zod-free module so the Feedback button -- which is in
   every dashboard, portal and share page -- can read them without shipping zod
   and its locale tables to the browser. Re-exported for the server callers. */
import { FEEDBACK_SURFACES, MAX_MESSAGE_CHARS, MAX_SCREENSHOT_BYTES, type FeedbackSurface } from "@/lib/feedback/limits";
export { FEEDBACK_SURFACES, MAX_MESSAGE_CHARS, MAX_SCREENSHOT_BYTES, type FeedbackSurface };
const MAX_SIGNALS = 20;

export const feedbackBodySchema = z.object({
  surface: z.enum(FEEDBACK_SURFACES),
  linkToken: z.string().trim().min(1).max(200).optional(),
  message: z.string().max(MAX_MESSAGE_CHARS).optional(),
  pageUrl: z.string().trim().min(1).max(2000),
  pageTitle: z.string().max(300).optional(),
  /* A data URL; base64 is 4/3 of the bytes, so this bounds the string before
     it is decoded and checked properly. */
  screenshot: z.string().max(Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 64).optional(),
  screenshotError: z.string().max(300).optional(),
  context: z.unknown().optional(),
});

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function looksLike(type: string, bytes: Buffer): boolean {
  if (type === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP";
  return false;
}

/**
 * The screenshot as bytes, or why it was refused. Only JPEG, PNG and WebP data
 * URLs whose bytes actually start like that format, and no larger than
 * MAX_SCREENSHOT_BYTES.
 */
export function decodeScreenshot(dataUrl: string): { bytes: Buffer; type: string } | { error: string } {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) return { error: "not an image data URL" };
  const type = m[1];
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) return { error: `unsupported type ${type}` };
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { error: "empty image" };
  if (bytes.length > MAX_SCREENSHOT_BYTES) return { error: "image too large" };
  if (!looksLike(type, bytes)) return { error: "bytes are not the declared image type" };
  return { bytes, type };
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;

function signals<T>(v: unknown, pick: (row: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .slice(-MAX_SIGNALS)
    .map(pick);
}

export type FeedbackContext = {
  viewport?: { w?: number; h?: number; dpr?: number };
  screen?: { w?: number; h?: number };
  userAgent?: string;
  language?: string;
  timeZone?: string;
  theme?: string;
  online?: boolean;
  errors: { at?: string; kind?: string; message?: string }[];
  failedRequests: { at?: string; path?: string; status?: number; durationMs?: number }[];
};

/** The browser's context, cut to the fields the inbox shows. */
export function cleanContext(raw: unknown): FeedbackContext {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const vp = c.viewport && typeof c.viewport === "object" ? (c.viewport as Record<string, unknown>) : {};
  const sc = c.screen && typeof c.screen === "object" ? (c.screen as Record<string, unknown>) : {};
  return {
    viewport: { w: num(vp.w), h: num(vp.h), dpr: num(vp.dpr) },
    screen: { w: num(sc.w), h: num(sc.h) },
    userAgent: str(c.userAgent, 400),
    language: str(c.language, 40),
    timeZone: str(c.timeZone, 60),
    theme: str(c.theme, 40),
    online: typeof c.online === "boolean" ? c.online : undefined,
    errors: signals(c.errors, (r) => ({ at: str(r.at, 40), kind: str(r.kind, 20), message: str(r.message, 500) })),
    failedRequests: signals(c.failedRequests, (r) => ({
      at: str(r.at, 40),
      path: str(r.path, 300),
      status: num(r.status),
      durationMs: num(r.durationMs),
    })),
  };
}

/**
 * The page address as stored: absolute http(s) only, with the fragment dropped.
 * A share or list link keeps its token in the path -- the token is the client's
 * own link, already held in the database, and the inbox needs it to open the
 * page they were on.
 */
export function cleanPageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}
