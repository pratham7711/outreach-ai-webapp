import Anthropic from "@anthropic-ai/sdk";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { CREATOR_FINDER_AI_FEATURE } from "@/lib/featureKeys";

/**
 * Scout's AI, kept apart from the rest of the app's AI on purpose.
 *
 * It reads its own key, SCOUT_ANTHROPIC_API_KEY, never ANTHROPIC_API_KEY:
 * setting the shared key on production would also switch on AI briefing,
 * natural-language search, campaign outreach drafts and the negotiation
 * advisor for every company. And it has its own per-org switch
 * (creator_finder_ai), so the board works with the AI off.
 *
 * Instagram profile text is not sent until SCOUT_AI_INSTAGRAM=on: that waits
 * for Meta's review verdict and for the privacy policy to list Anthropic as a
 * processor.
 */

export const SCOUT_MODEL = "claude-opus-5-5";

export type ScoutAiClient = {
  messages: {
    create(args: unknown): Promise<{ content: { type: string; text?: string }[]; stop_reason?: string | null }>;
  };
};

export type ScoutAiState = {
  /** The key is set and this org has the switch on. */
  on: boolean;
  /** Instagram profiles may be sent too. */
  instagram: boolean;
  /** Why it is off: the org's switch, or the server has no key. */
  code: "ai_off" | "ai_not_configured" | null;
  /** The same, in words for the agency. */
  reason: string | null;
};

export function scoutAiKey(): string | null {
  const key = process.env.SCOUT_ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

export function scoutAiReadsInstagram(): boolean {
  return process.env.SCOUT_AI_INSTAGRAM === "on";
}

export async function scoutAiState(orgId: string): Promise<ScoutAiState> {
  const enabled = hasOrgFeature(await getOrgEntitlements(orgId), CREATOR_FINDER_AI_FEATURE);
  if (!enabled) return { on: false, instagram: false, code: "ai_off", reason: "Scout's AI isn't switched on for this workspace." };
  if (!scoutAiKey()) return { on: false, instagram: false, code: "ai_not_configured", reason: "Scout's AI key isn't set on this server." };
  return { on: true, instagram: scoutAiReadsInstagram(), code: null, reason: null };
}

export { INSTAGRAM_AI_WAITING } from "@/lib/creatorFinder/prospects";

/** Interactive calls: one retry, and a minute before giving up. */
export function scoutAiClient(): ScoutAiClient {
  const apiKey = scoutAiKey();
  if (!apiKey) throw new Error("SCOUT_ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }) as unknown as ScoutAiClient;
}

export function responseText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}
