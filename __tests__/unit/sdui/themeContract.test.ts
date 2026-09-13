/**
 * @jest-environment node
 *
 * A theme row is untrusted data that gets assembled into a <style> element, so
 * these are the tests that keep that from being an injection surface. They are
 * written as "no input survives" rather than "these strings are blocked": a
 * blocklist only ever knows the attacks somebody already thought of.
 */
import { emitThemeCss } from "@/lib/sdui/theme/emit";
import { canonicalise, TOKEN_NAMES } from "@/lib/sdui/theme/contract";
import file from "@/lib/sdui/defaults/creatorcore.theme.json";

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
        const { css } = emitThemeCss({ creatorcore: { [token]: value } });
        // The only legal braces are the ones emit.ts writes around the block.
        const inner = css.replace(/^:root\.creatorcore\{/, "").replace(/\}$/, "");
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
      creatorcore: { "--evil": "#000", "--cc-primary ": "#000", content: "x" },
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
      { minWidth: 1280, modes: { creatorcore: { "--cc-rail-card-w": "16%" } } },
      { minWidth: 1024, modes: { creatorcore: { "--cc-rail-card-w": "15%" } } },
    ]);
    expect(css.indexOf("min-width:1024px")).toBeLessThan(css.indexOf("min-width:1280px"));
  });

  it("keeps the measured CreatorCore shell in the checked-in default", () => {
    // These four ratios are the parity result, not preferences: rail 15.00%,
    // inset 0.625%, reserved 15.31%, gutter 3.40% reproduce CreatorCore's
    // 240/216px rail and 291/262px content origin at 1600 and 1440 alike.
    // If someone edits them, that is a parity regression and this says so.
    const shell = file.responsive.find((r: { minWidth: number }) => r.minWidth === 1024);
    /* Asserted rather than optional-chained: if the 1024 layer is gone, that is
       the regression this test exists to catch, and `shell?.modes` would report
       it as an unhelpful "undefined is not an object". */
    expect(shell).toBeDefined();
    expect(shell!.modes.creatorcore).toMatchObject({
      "--cc-rail-card-w": "15%",
      "--cc-rail-inset-x": "0.625%",
      "--cc-sidebar-w": "15.31%",
      "--cc-page-pad-inline": "3.4%",
    });
    expect(file.modes.creatorcore["--cc-action-min-w"]).toBe("11.25rem");
    expect(file.modes.creatorcore["--cc-action-h"]).toBe("2.5rem");
  });
});
