export const MODELS = {
  orchestrator: "claude-opus-4-8",
  subagent: "claude-haiku-4-5",
  analyst: "claude-sonnet-4-6",
} as const;

export type ModelRole = keyof typeof MODELS;

export function modelFor(role: ModelRole): string {
  const id = MODELS[role];
  if (!id) {
    throw new Error(`Unknown model role: ${String(role)}`);
  }
  return id;
}

export const MODEL_METADATA = Object.freeze({
  orchestrator: Object.freeze({ contextWindow: 1_000_000 }),
  subagent: Object.freeze({ contextWindow: 200_000 }),
  analyst: Object.freeze({ contextWindow: 1_000_000 }),
}) as Readonly<Record<ModelRole, Readonly<{ contextWindow?: number }>>>;
