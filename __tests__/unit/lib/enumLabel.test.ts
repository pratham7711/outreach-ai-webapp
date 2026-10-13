import { enumLabel } from "@/lib/ui/enumLabel";

describe("enumLabel", () => {
  it("writes a stored enum in sentence case", () => {
    expect(enumLabel("PENDING_REVIEW")).toBe("Pending review");
    expect(enumLabel("IN_PROGRESS")).toBe("In progress");
    expect(enumLabel("APPROVED")).toBe("Approved");
  });

  it("keeps acronyms upper case", () => {
    expect(enumLabel("UGC_PAID")).toBe("UGC paid");
    expect(enumLabel("API_KEY")).toBe("API key");
  });

  it("returns an empty string for nothing", () => {
    expect(enumLabel(null)).toBe("");
    expect(enumLabel(undefined)).toBe("");
    expect(enumLabel("")).toBe("");
  });
});
