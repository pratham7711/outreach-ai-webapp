import { z } from "zod";

export const BASE_THEME: Record<string, string> = {
  "cc-bg": "#EFF0F8",
  "cc-card": "#FFFFFF",
  "cc-border": "#E4E6F0",
  "cc-primary": "#5B5BD6",
  "cc-text": "#1C2048",
  "cc-text-muted": "#9097B4",
  "cc-success": "#10B981",
  "cc-warning": "#F59E0B",
  "cc-danger": "#EF4444",
};

export const AA_THRESHOLD = 4.5;

const WORST_CONTRAST = 1;
const BEST_CONTRAST = 21;
const WHITE = "#FFFFFF";

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const hexValueSchema = z
  .string()
  .refine((value) => HEX_PATTERN.test(value), { message: "invalid_hex" });

const overridesSchema = z.record(z.string(), z.unknown());

const optsSchema = z
  .object({
    allowTokens: z.array(z.string()).optional(),
  })
  .optional();

export interface RejectedOverride {
  token: string;
  reason: "unknown_token" | "invalid_hex";
}

export interface ResolvedTheme {
  theme: Record<string, string>;
  rejected: RejectedOverride[];
}

export interface ContrastAudit {
  pair: string;
  ratio: number;
  passesAA: boolean;
}

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

function isKnownOrAllowed(token: string, allowed: Set<string>): boolean {
  return allowed.has(token);
}

export function resolveBrandTheme(
  overrides: Record<string, string>,
  opts?: { allowTokens?: string[] }
): ResolvedTheme {
  const theme: Record<string, string> = { ...BASE_THEME };
  const rejected: RejectedOverride[] = [];

  const parsedOverrides = overridesSchema.safeParse(overrides);
  if (!parsedOverrides.success) {
    return { theme, rejected };
  }

  const parsedOpts = optsSchema.safeParse(opts);
  const allowList = parsedOpts.success
    ? parsedOpts.data?.allowTokens
    : undefined;
  const allowed = new Set<string>(
    allowList && allowList.length > 0 ? allowList : Object.keys(BASE_THEME)
  );

  const tokens = Object.keys(parsedOverrides.data).sort();
  for (const token of tokens) {
    const rawValue = parsedOverrides.data[token];

    if (!isKnownOrAllowed(token, allowed)) {
      rejected.push({ token, reason: "unknown_token" });
      continue;
    }

    const parsedValue = hexValueSchema.safeParse(rawValue);
    if (!parsedValue.success) {
      rejected.push({ token, reason: "invalid_hex" });
      continue;
    }

    theme[token] = parsedValue.data;
  }

  return { theme, rejected };
}

export function auditThemeContrast(
  theme: Record<string, string>
): ContrastAudit[] {
  const safeTheme: Record<string, string> = { ...BASE_THEME, ...theme };
  const pairs: { pair: string; fg: string; bg: string }[] = [
    { pair: "cc-text on cc-bg", fg: safeTheme["cc-text"], bg: safeTheme["cc-bg"] },
    {
      pair: "cc-text on cc-card",
      fg: safeTheme["cc-text"],
      bg: safeTheme["cc-card"],
    },
    {
      pair: "cc-text-muted on cc-card",
      fg: safeTheme["cc-text-muted"],
      bg: safeTheme["cc-card"],
    },
    {
      pair: "white on cc-primary",
      fg: WHITE,
      bg: safeTheme["cc-primary"],
    },
  ];

  return pairs.map(({ pair, fg, bg }) => {
    const ratio = contrastRatio(fg, bg);
    return {
      pair,
      ratio,
      passesAA: ratio >= AA_THRESHOLD,
    };
  });
}

export const __schemas = { hexValueSchema, overridesSchema, optsSchema };
