/**
 * @jest-environment node
 *
 * A theme row is untrusted data that gets assembled into a <style> element, so
 * these are the tests that keep that from being an injection surface. They are
 * written as "no input survives" rather than "these strings are blocked": a
 * blocklist only ever knows the attacks somebody already thought of.
 */
import { emitThemeCss } from "@/lib/sdui/theme/emit";
import { canonicalise, storedThemeSchema, TOKEN_NAMES } from "@/lib/sdui/theme/contract";
import { resolveOrgTheme } from "@/lib/sdui/theme/resolve";

jest.mock("@/lib/db", () => ({ db: {} }));

const HOSTILE = [
  "#fff}</style><script>alert(1)</script>",
  "40px;background:url(https://evil.test/x)",
  "expression(alert(1))",
  "15%}@import url(//evil.test/a.css);{",
  "calc(100% - 10px)",
  "var(--anything)",
  "700;}*{display:none}",
  "10px !important",
  String.raw`\75 rl(evil)`,
  "#fff ",
  "attr(href)",
  "-moz-binding:url(x)",
];

describe("theme token contract", () => {
  it("never emits a character that could end or open a declaration", () => {
    for (const token of TOKEN_NAMES) {
      for (const value of HOSTILE) {
        const { css } = emitThemeCss({ light: { [token]: value } });
        // The only legal braces are the ones emit.ts writes around the block.
        const inner = css.replace(/^:root\.light\{/, "").replace(/\}$/, "");
        expect(inner).not.toMatch(/[<>{};]\s*[a-zA-Z@]/);
        expect(inner.toLowerCase()).not.toContain("url(");
        expect(inner.toLowerCase()).not.toContain("@import");
        expect(inner.toLowerCase()).not.toContain("script");
        expect(inner.toLowerCase()).not.toContain("expression");
        expect(inner).not.toContain("\\");
      }
    }
  });

  it("drops any token name that is not in the contract", () => {
    const { css, rejected } = emitThemeCss({
      light: { "--evil": "#000", "--cc-primary ": "#000", content: "x" },
    });
    expect(css).toBe("");
    expect(rejected).toHaveLength(3);
  });

  it("re-serialises rather than echoing, so casing and shorthand normalise", () => {
    expect(canonicalise("--cc-text", "#ABC")).toBe("#aabbcc");
    expect(canonicalise("--cc-text", "#ABCDEF")).toBe("#abcdef");
    expect(canonicalise("--ui-r-md", "10px")).toBe("10px");
    // An uppercase unit is not a known unit. Strict on purpose: the set of
    // values we accept is the set we can re-emit exactly.
    expect(canonicalise("--ui-r-md", "10PX")).toBeNull();
  });

  it("enforces numeric bounds so a density cannot blow up the whole ramp", () => {
    expect(canonicalise("--cc-density", 1.25)).toBe("1.25");
    expect(canonicalise("--cc-density", 99999)).toBeNull();
    expect(canonicalise("--cc-fw-page-title", 700)).toBe("700");
    expect(canonicalise("--cc-fw-page-title", 9000)).toBeNull();
  });

  it("emits breakpoint layers ascending, so the wider one wins on source order", () => {
    const { css } = emitThemeCss({}, [
      { minWidth: 1280, modes: { light: { "--cc-rail-card-w": "16%" } } },
      { minWidth: 1024, modes: { light: { "--cc-rail-card-w": "15%" } } },
    ]);
    expect(css.indexOf("min-width:1024px")).toBeLessThan(css.indexOf("min-width:1280px"));
  });

  describe("a row saved while the CreatorCore theme existed", () => {
    const legacy = {
      version: 3,
      modes: {
        light: { "--cc-text": "#111111" },
        creatorcore: { "--cc-sidebar-w": "15.31%", "--cc-action-h": "40px" },
      },
      responsive: [
        {
          minWidth: 1024,
          modes: { dark: { "--cc-rail-card-w": "15%" }, creatorcore: { "--cc-rail-card-w": "15%" } },
        },
      ],
    };

    it("still parses, with the creatorcore mode stripped and the rest kept", () => {
      const parsed = storedThemeSchema.safeParse(legacy);
      expect(parsed.success).toBe(true);
      expect(parsed.data!.version).toBe(3);
      expect(parsed.data!.modes).toEqual({ light: { "--cc-text": "#111111" } });
      expect(parsed.data!.responsive).toEqual([{ minWidth: 1024, modes: { dark: { "--cc-rail-card-w": "15%" } } }]);
    });

    it("resolves without degrading and emits no .creatorcore CSS", async () => {
      const theme = await resolveOrgTheme("org-legacy", { theme: legacy });
      expect(theme.degraded).toBe(false);
      expect(theme.version).toBe(3);
      expect(theme.rejected).toEqual([]);
      expect(theme.css).not.toContain("creatorcore");
      expect(theme.css).toBe(":root.light{--cc-text:#111111}@media (min-width:1024px){:root.dark{--cc-rail-card-w:15%}}");
    });
  });
});
