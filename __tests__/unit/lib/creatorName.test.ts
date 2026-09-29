import { creatorNameParts, creatorNameText } from "@/lib/creators/creatorName";

describe("creatorNameParts", () => {
  it("shows the name with the handle under it", () => {
    expect(creatorNameParts("Maria Santos", "@mariasantos")).toEqual({ name: "Maria Santos", handle: "@mariasantos" });
    expect(creatorNameParts("Maria Santos", "mariasantos")).toEqual({ name: "Maria Santos", handle: "@mariasantos" });
  });

  it("never doubles the @, however the handle was stored", () => {
    expect(creatorNameParts("Maria", "@@maria_s").handle).toBe("@maria_s");
  });

  it("says the handle once when the name is only the handle", () => {
    expect(creatorNameParts("synthpage18", "@synthpage18")).toEqual({ name: "@synthpage18", handle: null });
    expect(creatorNameParts("@SynthPage18", "synthpage18")).toEqual({ name: "@synthpage18", handle: null });
    expect(creatorNameParts("  ", "@synthpage18")).toEqual({ name: "@synthpage18", handle: null });
    expect(creatorNameParts(null, "synthpage18")).toEqual({ name: "@synthpage18", handle: null });
  });

  it("falls back to the name, then to a placeholder, when there is no handle", () => {
    expect(creatorNameParts("Maria Santos", "")).toEqual({ name: "Maria Santos", handle: null });
    expect(creatorNameParts("Maria Santos", null)).toEqual({ name: "Maria Santos", handle: null });
    expect(creatorNameParts("", "@")).toEqual({ name: "Unknown creator", handle: null });
  });
});

describe("creatorNameText", () => {
  it("puts the handle in brackets after the name", () => {
    expect(creatorNameText("Maria Santos", "@mariasantos")).toBe("Maria Santos (@mariasantos)");
  });

  it("is just the handle when the name adds nothing", () => {
    expect(creatorNameText("mariasantos", "mariasantos")).toBe("@mariasantos");
  });

  it("is just the name when there is no handle", () => {
    expect(creatorNameText("Maria Santos", undefined)).toBe("Maria Santos");
  });
});
