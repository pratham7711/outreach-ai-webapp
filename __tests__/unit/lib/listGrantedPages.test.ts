/**
 * @jest-environment node
 *
 * me/accounts can answer [] for a grant that names its Pages (measured
 * 2026-10-25), so an empty listing falls back to the Pages the grant names.
 */
import { listGrantedPages } from "@/lib/platforms/instagram";
import { fetchInstagramAccount } from "@/lib/platforms/instagramAccount";

type Seen = { path: string; params: URLSearchParams };

function graph(routes: { accounts: unknown[]; scopes?: unknown; nodes?: Record<string, unknown> }) {
  const seen: Seen[] = [];
  global.fetch = jest.fn(async (input: string) => {
    const u = new URL(input);
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
    seen.push({ path, params: u.searchParams });
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
    if (path === "me/accounts") return ok({ data: routes.accounts });
    if (path === "debug_token") return ok({ data: { granular_scopes: routes.scopes } });
    if (routes.nodes && path in routes.nodes) return ok(routes.nodes[path]);
    return { ok: false, status: 400, json: async () => ({ error: { code: 100 } }), headers: { get: () => null } };
  }) as unknown as typeof fetch;
  return seen;
}

const PAGE = { id: "100000000000001", instagram_business_account: { id: "17840000000000009", username: "creator.handle" } };
const NAMED = [
  { scope: "pages_show_list", target_ids: ["100000000000001"] },
  { scope: "pages_read_engagement", target_ids: ["100000000000001"] },
  { scope: "instagram_basic", target_ids: ["17840000000000009"] },
];

describe("listGrantedPages", () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  beforeEach(() => {
    process.env.INSTAGRAM_CLIENT_ID = "app-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "app-secret";
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...env };
  });

  it("returns me/accounts as it is when it lists Pages, without asking debug_token", async () => {
    const seen = graph({ accounts: [PAGE], scopes: NAMED });
    await expect(listGrantedPages("user-token", "instagram_business_account{id}")).resolves.toEqual([PAGE]);
    expect(seen.map((s) => s.path)).toEqual(["me/accounts"]);
  });

  it("reads the Pages the grant names when me/accounts is empty, once each and never an Instagram id", async () => {
    const seen = graph({ accounts: [], scopes: NAMED, nodes: { "100000000000001": PAGE } });
    await expect(listGrantedPages("user-token", "instagram_business_account{id}")).resolves.toEqual([PAGE]);
    expect(seen.map((s) => s.path)).toEqual(["me/accounts", "debug_token", "100000000000001"]);
    const debug = seen[1].params;
    expect(debug.get("input_token")).toBe("user-token");
    expect(debug.get("access_token")).toBe("app-id|app-secret");
    expect(seen[2].params.get("fields")).toBe("instagram_business_account{id}");
    expect(seen[2].params.get("access_token")).toBe("user-token");
  });

  it("stays empty for a grant that names no Page (opted in to all current and future Pages)", async () => {
    const seen = graph({ accounts: [], scopes: [{ scope: "pages_show_list" }, { scope: "instagram_basic" }] });
    await expect(listGrantedPages("user-token", "id")).resolves.toEqual([]);
    expect(seen.map((s) => s.path)).toEqual(["me/accounts", "debug_token"]);
  });

  it("does not ask debug_token without the app's credentials", async () => {
    delete process.env.INSTAGRAM_CLIENT_ID;
    delete process.env.INSTAGRAM_CLIENT_SECRET;
    const seen = graph({ accounts: [], scopes: NAMED });
    await expect(listGrantedPages("user-token", "id")).resolves.toEqual([]);
    expect(seen.map((s) => s.path)).toEqual(["me/accounts"]);
  });

  it("skips a named Page Meta will not return", async () => {
    graph({ accounts: [], scopes: [{ scope: "pages_show_list", target_ids: ["111", "100000000000001"] }], nodes: { "100000000000001": PAGE } });
    await expect(listGrantedPages("user-token", "id")).resolves.toEqual([PAGE]);
  });

  it("lets the creator connect through it: the identity comes from the named Page", async () => {
    graph({
      accounts: [],
      scopes: NAMED,
      nodes: {
        "100000000000001": PAGE,
        "17840000000000009": { id: "17840000000000009", media_count: 11 },
      },
    });
    const account = await fetchInstagramAccount("user-token");
    expect(account?.igUserId).toBe("17840000000000009");
    expect(account?.username).toBe("creator.handle");
    expect(account?.mediaCount).toBe(11);
  });
});
