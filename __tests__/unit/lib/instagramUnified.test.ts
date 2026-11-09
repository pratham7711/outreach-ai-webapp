const KEY = "NEXT_PUBLIC_META_INSTAGRAM_LOGIN_CONFIG_ID";

function load<T>(mod: string, configId?: string): T {
  const saved = process.env[KEY];
  if (configId === undefined) delete process.env[KEY];
  else process.env[KEY] = configId;
  let out!: T;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = require(mod) as T;
  });
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
  return out;
}

describe("Instagram Unified login mode", () => {
  it("names the card by the Page path until a configuration is set", () => {
    const off = load<typeof import("@/lib/oauth/instagramUnified")>("@/lib/oauth/instagramUnified");
    expect(off.instagramCardLabel()).toBe("Instagram (via Facebook Page)");
    process.env[KEY] = "1789959975543946";
    expect(off.instagramCardLabel()).toBe("Instagram");
    expect(off.instagramCardNote()).toMatch(/No Facebook Page needed/);
    delete process.env[KEY];
  });

  it("lists no Page permission under What we read once Unified login is on", () => {
    const on = load<typeof import("@/lib/portal/whatWeRead")>("@/lib/portal/whatWeRead", "1789959975543946");
    expect(on.WHAT_WE_READ.instagram.map((l) => l.scope)).toEqual(["instagram_basic", "instagram_manage_insights"]);
    const off = load<typeof import("@/lib/portal/whatWeRead")>("@/lib/portal/whatWeRead");
    expect(off.WHAT_WE_READ.instagram.some((l) => l.scope.startsWith("pages_"))).toBe(true);
  });

  it("hides the legacy Instagram-login card while Unified login is on", () => {
    process.env[KEY] = "1789959975543946";
    const caps = load<typeof import("@/lib/capabilities")>("@/lib/capabilities", "1789959975543946");
    expect(caps.resolvePlatformCapability("instagram-login").connect).toBe("coming_soon");
    delete process.env[KEY];
    expect(caps.resolvePlatformCapability("instagram-login").connect).not.toBe("coming_soon");
  });
});
