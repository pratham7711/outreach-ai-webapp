import { z } from "zod";
import { contrastRatio, HEX_PATTERN, isValidHex } from "@/lib/color";

/* Re-exported so existing callers keep importing them from here. The
   implementations live in lib/color, which has no zod in it. */
export { contrastRatio, isValidHex };

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

const WHITE = "#FFFFFF";

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
