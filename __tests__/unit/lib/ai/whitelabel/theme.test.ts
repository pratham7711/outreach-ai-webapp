import {
  BASE_THEME,
  resolveBrandTheme,
  isValidHex,
  contrastRatio,
  auditThemeContrast,
} from "@/lib/ai/whitelabel/theme";

describe("isValidHex", () => {
  it("accepts #rgb, #rrggbb, and uppercase hex", () => {
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("#ffffff")).toBe(true);
    expect(isValidHex("#AABBCC")).toBe(true);
  });

  it("rejects named colors, bad chars, missing hash, and wrong length", () => {
    expect(isValidHex("red")).toBe(false);
    expect(isValidHex("#ggg")).toBe(false);
    expect(isValidHex("fff")).toBe(false);
    expect(isValidHex("#12345")).toBe(false);
  });
});

describe("resolveBrandTheme", () => {
  it("applies a valid override onto the base theme", () => {
    const { theme, rejected } = resolveBrandTheme({ "cc-primary": "#123456" });
    expect(theme["cc-primary"]).toBe("#123456");
    expect(theme["cc-bg"]).toBe(BASE_THEME["cc-bg"]);
    expect(rejected).toEqual([]);
  });

  it("rejects an unknown token and keeps the base theme untouched", () => {
    const { theme, rejected } = resolveBrandTheme({ "cc-unknown": "#123456" });
    expect(theme).toEqual(BASE_THEME);
    expect(rejected).toEqual([{ token: "cc-unknown", reason: "unknown_token" }]);
  });

  it("rejects an invalid hex value and keeps the base value for that token", () => {
    const { theme, rejected } = resolveBrandTheme({ "cc-primary": "notacolor" });
    expect(theme["cc-primary"]).toBe(BASE_THEME["cc-primary"]);
    expect(rejected).toEqual([{ token: "cc-primary", reason: "invalid_hex" }]);
  });

  it("fail-closes on a non-string malformed value", () => {
    const { theme, rejected } = resolveBrandTheme({
      "cc-text": 123 as unknown as string,
    });
    expect(theme["cc-text"]).toBe(BASE_THEME["cc-text"]);
    expect(rejected).toEqual([{ token: "cc-text", reason: "invalid_hex" }]);
  });

  it("restricts the overridable set via opts.allowTokens", () => {
    const { theme, rejected } = resolveBrandTheme(
      { "cc-primary": "#000000", "cc-bg": "#111111" },
      { allowTokens: ["cc-primary"] }
    );
    expect(theme["cc-primary"]).toBe("#000000");
    expect(theme["cc-bg"]).toBe(BASE_THEME["cc-bg"]);
    expect(rejected).toEqual([{ token: "cc-bg", reason: "unknown_token" }]);
  });

  it("is deterministic for the same input", () => {
    const input = { "cc-primary": "#abcabc", "cc-zzz": "#000" };
    const a = resolveBrandTheme(input);
    const b = resolveBrandTheme(input);
    expect(a).toEqual(b);
  });

  it("does not mutate BASE_THEME across calls", () => {
    resolveBrandTheme({ "cc-primary": "#000000" });
    expect(BASE_THEME["cc-primary"]).toBe("#5B5BD6");
  });
});

describe("contrastRatio", () => {
  it("returns ~21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("returns ~1 for the same color", () => {
    expect(contrastRatio("#5B5BD6", "#5B5BD6")).toBeCloseTo(1, 4);
  });

  it("fail-closes to 1 for invalid hex", () => {
    expect(contrastRatio("nope", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "bad")).toBe(1);
  });

  it("is symmetric regardless of argument order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(
      contrastRatio("#ffffff", "#000000")
    );
  });
});

describe("auditThemeContrast", () => {
  it("passes a high-contrast text-on-surface pair", () => {
    const audits = auditThemeContrast(BASE_THEME);
    const textOnBg = audits.find((a) => a.pair === "cc-text on cc-bg");
    expect(textOnBg).toBeDefined();
    expect(textOnBg!.passesAA).toBe(true);
    expect(textOnBg!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("flags a low-contrast pair as failing AA", () => {
    const { theme } = resolveBrandTheme({ "cc-bg": "#1d2147" });
    const audits = auditThemeContrast(theme);
    const textOnBg = audits.find((a) => a.pair === "cc-text on cc-bg");
    expect(textOnBg).toBeDefined();
    expect(textOnBg!.passesAA).toBe(false);
    expect(textOnBg!.ratio).toBeLessThan(4.5);
  });

  it("is deterministic for the same theme", () => {
    expect(auditThemeContrast(BASE_THEME)).toEqual(
      auditThemeContrast(BASE_THEME)
    );
  });
});
