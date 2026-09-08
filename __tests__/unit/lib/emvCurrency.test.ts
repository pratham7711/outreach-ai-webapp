import { EMV_CURRENCY, emvLabel } from "@/lib/metrics/emv";

/**
 * EMV_RATES is a USD rate card and nothing converts it, so the label has to say
 * so wherever the campaign is not itself in dollars. Rendering $23,211 of
 * earned media behind a rupee sign understated it by roughly 83x.
 */
describe("emvLabel", () => {
  it("is USD", () => {
    expect(EMV_CURRENCY).toBe("USD");
  });

  it("stays plain for a USD campaign", () => {
    expect(emvLabel("USD")).toBe("EMV");
    expect(emvLabel("usd")).toBe("EMV");
  });

  it("names the unit for any other currency", () => {
    expect(emvLabel("INR")).toBe("EMV (USD)");
    expect(emvLabel("GBP")).toBe("EMV (USD)");
  });

  it("treats an absent currency as the default USD", () => {
    expect(emvLabel(null)).toBe("EMV");
    expect(emvLabel(undefined)).toBe("EMV");
  });

  it("carries a caller's own base label", () => {
    expect(emvLabel("EUR", "Total EMV")).toBe("Total EMV (USD)");
    expect(emvLabel("USD", "Total EMV")).toBe("Total EMV");
  });
});
