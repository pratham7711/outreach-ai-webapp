import Anthropic from "@anthropic-ai/sdk";
import type { NegotiationAdvisor, ProposeCounterInput, ProposeCounterResult } from "./types";
import { RuleBasedAdvisor } from "./ruleBased";

const MODEL = "claude-opus-4-8";

function clampToBand(value: number, offeredRate: number, creatorCounterRate: number): number {
  const bounded = Math.min(value, creatorCounterRate);
  const floored = Math.max(bounded, offeredRate);
  return Math.round(floored);
}

export class ClaudeAdvisor implements NegotiationAdvisor {
  private client: Anthropic;
  private fallback: RuleBasedAdvisor;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.fallback = new RuleBasedAdvisor();
  }

  async proposeCounter(input: ProposeCounterInput): Promise<ProposeCounterResult> {
    try {
      const { offeredRate, creatorCounterRate, creatorProfile, campaignBrief, currency } = input;

      const system =
        "You are a professional talent-negotiation assistant for a brand or agency. " +
        "You draft ONE counter-offer to a creator who countered the brand's rate. " +
        "You never confirm or accept a deal — every message must stay non-binding and note it is subject to brand approval. " +
        `Your proposed counterRate MUST be a number within the closed range [${offeredRate}, ${creatorCounterRate}] ` +
        "(never below the brand's original offer, never above the creator's counter). " +
        'Respond ONLY with strict minified JSON of the exact shape {"counterRate": number, "message": string} and nothing else. ' +
        "The message is a professional 2-3 sentence direct message referencing the specific numbers.";

      const user =
        `Currency: ${currency}\n` +
        `Brand's original offer: ${offeredRate}\n` +
        `Creator's counter: ${creatorCounterRate}\n` +
        `Creator followers: ${creatorProfile.followersCount}\n` +
        (creatorProfile.avgViews != null ? `Creator average views: ${creatorProfile.avgViews}\n` : "") +
        (creatorProfile.rate != null ? `Creator listed rate: ${creatorProfile.rate}\n` : "") +
        (campaignBrief ? `Campaign brief: ${campaignBrief}\n` : "") +
        `Propose a single counter within [${offeredRate}, ${creatorCounterRate}].`;

      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 500,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: user }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
        throw new Error("No JSON object in advisor response");
      }

      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Advisor JSON is not an object");
      }
      const record = parsed as Record<string, unknown>;
      const rawRate = record.counterRate;
      const rawMessage = record.message;

      if (typeof rawRate !== "number" || !Number.isFinite(rawRate)) {
        throw new Error("Advisor counterRate is not a number");
      }
      if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
        throw new Error("Advisor message is empty");
      }

      return {
        counterRate: clampToBand(rawRate, offeredRate, creatorCounterRate),
        message: rawMessage.trim(),
      };
    } catch {
      return this.fallback.proposeCounter(input);
    }
  }
}
