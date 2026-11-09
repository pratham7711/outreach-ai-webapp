import { briefBlocks } from "@/lib/portal/briefBlocks";

describe("briefBlocks", () => {
  it("turns editor HTML into paragraphs, list items and headings", () => {
    expect(
      briefBlocks("<p>Show the moment &amp; <b>smile</b></p><ul><li>One</li><li>Two<br>Three</li></ul><h2>Head</h2>tail"),
    ).toEqual([
      { kind: "p", text: "Show the moment & smile" },
      { kind: "li", text: "One" },
      { kind: "li", text: "Two" },
      { kind: "li", text: "Three" },
      { kind: "h", text: "Head" },
      { kind: "p", text: "tail" },
    ]);
  });

  it("keeps a plain-text brief as one paragraph per line, angle brackets included", () => {
    expect(briefBlocks("line one\n\nline two <3")).toEqual([
      { kind: "p", text: "line one" },
      { kind: "p", text: "line two <3" },
    ]);
  });

  it("never returns markup", () => {
    const out = briefBlocks('<p onclick="x()">ok</p><img src=x onerror=alert(1)><script>bad()</script>');
    expect(out).toEqual([{ kind: "p", text: "ok" }]);
  });

  it("is empty for empty input", () => {
    expect(briefBlocks(null)).toEqual([]);
    expect(briefBlocks("   ")).toEqual([]);
    expect(briefBlocks("<p></p>")).toEqual([]);
  });
});
