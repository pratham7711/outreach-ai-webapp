import { usableIconHref } from "@/lib/brandingDefaults";

describe("usableIconHref", () => {
  it("returns null for nothing to point at, so the file-convention icon wins", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(usableIconHref(v)).toBeNull();
    }
  });

  it("accepts an absolute http(s) URL", () => {
    expect(usableIconHref("https://cdn.example.com/fav.png")).toBe("https://cdn.example.com/fav.png");
    expect(usableIconHref("  http://example.com/fav.ico  ")).toBe("http://example.com/fav.ico");
  });

  it("accepts a site-relative path unchanged", () => {
    expect(usableIconHref("/brand/fav.png")).toBe("/brand/fav.png");
  });

  it("refuses schemes that are not http(s), and protocol-relative URLs", () => {
    for (const v of ["javascript:alert(1)", "data:image/png;base64,AAA", "//evil.example/f.png", "ftp://x/y.ico"]) {
      expect(usableIconHref(v)).toBeNull();
    }
  });

  it("refuses a bare hostname rather than guessing a scheme", () => {
    expect(usableIconHref("example.com/fav.png")).toBeNull();
  });
});
