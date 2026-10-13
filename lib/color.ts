/**
 * Pure colour arithmetic, with no dependencies.
 *
 * Split out of lib/ai/whitelabel/theme.ts, which validates brand overrides with
 * zod: lib/statusColors needed only these two functions, and importing them from
 * there put zod (and its locale tables) into every route that renders a status
 * tab -- the login page among them. theme.ts re-exports both, so its callers
 * are unchanged.
 */

const WORST_CONTRAST = 1;
const BEST_CONTRAST = 21;

export const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHex(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return HEX_PATTERN.test(value);
}

function expandHex(value: string): string {
  const body = value.slice(1);
  if (body.length === 3) {
    return body
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return body;
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(value: string): number {
  const body = expandHex(value);
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function contrastRatio(hexA: string, hexB: string): number {
  if (!isValidHex(hexA) || !isValidHex(hexB)) {
    return WORST_CONTRAST;
  }
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  if (!Number.isFinite(lumA) || !Number.isFinite(lumB)) {
    return WORST_CONTRAST;
  }
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  if (!Number.isFinite(ratio)) {
    return WORST_CONTRAST;
  }
  const clamped = Math.min(BEST_CONTRAST, Math.max(WORST_CONTRAST, ratio));
  return roundTo(clamped, 4);
}
