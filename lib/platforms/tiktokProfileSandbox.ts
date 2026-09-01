import { Sandbox } from "@vercel/sandbox";
import { tikTokMusicEmbedUrl } from "./tiktokSoundEmbed";
import { parseTikTokProfileHtml } from "./tiktokProfile";
import { tikTokEmbedUrl } from "./tiktokTopPostsEmbed";
import type { CreatorReadResult } from "./creatorProfile";

/**
 * TikTok profile stats, fetched from an egress TikTok actually answers.
 *
 * The measured facts, all from 2026-09-01: TikTok's WAF serves this project's
 * function egress (sin1, and its Slardar wall does not care whether the client
 * is undici or headless Chromium) a 1.4KB login shell for profile pages. The
 * same plain curl from a Vercel *Sandbox* (iad1) returns the full
 * server-rendered page, every time. So the read runs where it works: the sweep
 * opens one sandbox, curls each profile inside it, and parses the HTML with
 * the same parser the direct fetch uses.
 *
 * One sandbox per sweep, created lazily -- creation costs a few seconds and is
 * billed by lifetime, so a sweep with no TikTok creators due never pays it.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Long enough for a full sweep; the sweep closes it long before this. */
const SANDBOX_LIFETIME_MS = 4 * 60 * 1000;

export type SandboxProfileFetcher = {
  read: (handle: string) => Promise<CreatorReadResult>;
  /** The creator's own video list, from TikTok's embed page. Shares the sweep's
   *  one sandbox, so a second read costs a curl rather than a boot. */
  readEmbedHtml: (handle: string) => Promise<string | null>;
  /** Raw music-embed HTML for a sound id. The use count is server-rendered in
   *  this page's embedInfo, which is why the audio tracker no longer needs a
   *  browser on a VPS — see tiktokSoundEmbed.ts. */
  readMusicEmbedHtml: (tiktokSoundId: string) => Promise<string | null>;
  close: () => Promise<void>;
};

export function openSandboxProfileFetcher(): SandboxProfileFetcher {
  let sandboxPromise: Promise<Sandbox> | null = null;

  const get = () => {
    if (!sandboxPromise) {
      sandboxPromise = Sandbox.create({
        // iad1 is where the successful reads were measured. Not the project
        // region, and deliberately so.
        region: "iad1",
        timeout: SANDBOX_LIFETIME_MS,
      });
      sandboxPromise.catch(() => {
        sandboxPromise = null;
      });
    }
    return sandboxPromise;
  };

  return {
    async read(handle) {
      const clean = handle.replace(/^@/, "").trim();
      if (!clean) return { ok: false, reason: "unreadable", detail: "empty handle" };

      try {
        const sandbox = await get();
        const result = await sandbox.runCommand(
          "curl",
          [
            "-sL",
            "--max-time",
            "20",
            "-A",
            UA,
            "-H",
            "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H",
            "accept-language: en-US,en;q=0.9",
            `https://www.tiktok.com/@${encodeURIComponent(clean)}`,
          ],
          { timeoutMs: 30_000 }
        );
        const stdout: string =
          typeof (result as any).stdout === "function"
            ? await (result as any).stdout()
            : (result as any).stdout;
        if (!stdout) {
          return { ok: false, reason: "unreadable", detail: "sandbox curl returned nothing" };
        }
        return parseTikTokProfileHtml(stdout);
      } catch (e) {
        return {
          ok: false,
          reason: "unreadable",
          detail: `sandbox: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
    async readEmbedHtml(handle) {
      const clean = handle.replace(/^@/, "").trim();
      if (!clean) return null;
      try {
        const sandbox = await get();
        const result = await sandbox.runCommand(
          "curl",
          [
            "-sL",
            "--max-time",
            "25",
            "-A",
            UA,
            "-H",
            "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H",
            "accept-language: en-US,en;q=0.9",
            tikTokEmbedUrl(clean),
          ],
          { timeoutMs: 35_000 }
        );
        const stdout: string =
          typeof (result as any).stdout === "function"
            ? await (result as any).stdout()
            : (result as any).stdout;
        return stdout || null;
      } catch {
        return null;
      }
    },

    async readMusicEmbedHtml(tiktokSoundId) {
      const clean = String(tiktokSoundId ?? "").trim();
      if (!clean) return null;
      try {
        const sandbox = await get();
        const result = await sandbox.runCommand(
          "curl",
          [
            "-sL",
            "--max-time",
            "25",
            "-A",
            UA,
            "-H",
            "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H",
            "accept-language: en-US,en;q=0.9",
            tikTokMusicEmbedUrl(clean),
          ],
          { timeoutMs: 35_000 }
        );
        const stdout: string =
          typeof (result as any).stdout === "function"
            ? await (result as any).stdout()
            : (result as any).stdout;
        return stdout || null;
      } catch {
        return null;
      }
    },

    async close() {
      const p = sandboxPromise;
      sandboxPromise = null;
      if (!p) return;
      await p.then((s) => s.stop()).catch(() => {});
    },
  };
}
