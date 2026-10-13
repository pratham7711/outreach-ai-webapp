import { noun } from "@/lib/ui/noun";

describe("noun", () => {
  it("is singular for exactly one and plural for everything else", () => {
    expect(noun(1, "creator")).toBe("creator");
    expect(noun(0, "creator")).toBe("creators");
    expect(noun(2, "post")).toBe("posts");
    expect(noun(null, "post")).toBe("posts");
  });

  it("takes an irregular plural", () => {
    expect(noun(3, "reply", "replies")).toBe("replies");
    expect(noun(1, "reply", "replies")).toBe("reply");
  });
});
