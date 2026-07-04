import type { NegotiationAdvisor } from "./types";
import { RuleBasedAdvisor } from "./ruleBased";
import { ClaudeAdvisor } from "./claude";

export function getAdvisor(): NegotiationAdvisor {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return new ClaudeAdvisor(key);
  }
  return new RuleBasedAdvisor();
}
