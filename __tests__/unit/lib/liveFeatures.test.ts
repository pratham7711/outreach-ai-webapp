import { partitionLiveFeatures, isLiveFeature } from "@/lib/features";
import { PLANS } from "@/lib/plans";

describe("partitionLiveFeatures", () => {
  it("keeps the keys the app actually gates on", () => {
    const { live } = partitionLiveFeatures([
      "media_kits",
      "api_access",
      "audit_log",
      "advanced_reports",
      "basic_reports",
    ]);
    expect(live).toEqual([
      "media_kits",
      "api_access",
      "audit_log",
      "advanced_reports",
      "basic_reports",
    ]);
  });

  it("separates the enterprise names nothing in the product reads", () => {
    const { live, notBuilt } = partitionLiveFeatures([...PLANS.enterprise.features]);

    for (const key of ["custom_domain", "sso", "dedicated_support"]) {
      expect(notBuilt).toContain(key);
      expect(live).not.toContain(key);
      expect(isLiveFeature(key)).toBe(false);
    }
    expect(live).toContain("audit_log");
    expect(live).toContain("api_access");
  });

  it("loses nothing — every input lands in exactly one bucket", () => {
    const input = [...PLANS.enterprise.features];
    const { live, notBuilt } = partitionLiveFeatures(input);
    expect([...live, ...notBuilt].sort()).toEqual([...input].sort());
  });
});
