/* The notification settings screens offer the payout events exactly while
   payouts are switched on (lib/payouts/switch.ts). The catalog itself keeps
   them either way, so stored preferences survive the switch. */
type Catalog = typeof import("@/lib/notificationCatalog");

function loadCatalog(payoutsOn: boolean): Catalog {
  let catalog: Catalog | undefined;
  jest.isolateModules(() => {
    jest.doMock("@/lib/payouts/switch", () => ({ PAYOUTS_ENABLED: payoutsOn }));
    catalog = require("@/lib/notificationCatalog");
  });
  return catalog!;
}

const PAYOUT_KEYS = ["payout.create", "payout.status_changed", "payout_request.create"];
const keys = (c: Catalog) => c.SETTINGS_NOTIFICATION_EVENTS.map((e) => e.key);

describe("notification settings and the payouts switch", () => {
  it("does not offer the payout events while payouts are off", () => {
    const off = loadCatalog(false);
    for (const key of PAYOUT_KEYS) expect(keys(off)).not.toContain(key);
    expect(keys(off)).toContain("post.create");
  });

  it("offers them again once payouts are back on", () => {
    const on = loadCatalog(true);
    for (const key of PAYOUT_KEYS) expect(keys(on)).toContain(key);
  });

  it("keeps deposits parked either way: they are not behind the payouts switch", () => {
    expect(keys(loadCatalog(false))).not.toContain("deposit.create");
    expect(keys(loadCatalog(true))).not.toContain("deposit.create");
  });

  it("keeps the payout events in the catalog either way, so stored preferences survive", () => {
    for (const payoutsOn of [false, true]) {
      const c = loadCatalog(payoutsOn);
      for (const key of PAYOUT_KEYS) expect(c.isNotifiableAction(key)).toBe(true);
    }
  });
});
