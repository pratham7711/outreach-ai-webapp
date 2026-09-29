/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const queryRaw = jest.fn();
const executeRaw = jest.fn();
jest.mock("@/lib/db", () => ({ db: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a), $executeRawUnsafe: (...a: unknown[]) => executeRaw(...a) } }));

import { GET, POST } from "@/app/api/admin/migrate-platform-credentials/route";
import { PLATFORM_CREDENTIAL_DDL } from "@/lib/platforms/platformCredentialDdl";

const req = (method: string, auth?: string) =>
  new NextRequest("http://localhost/api/admin/migrate-platform-credentials", { method, headers: auth ? { authorization: auth } : {} });

const saved = process.env.ADMIN_MIGRATE_TOKEN;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_MIGRATE_TOKEN = "t0ken";
});
afterAll(() => {
  process.env.ADMIN_MIGRATE_TOKEN = saved;
});

describe("/api/admin/migrate-platform-credentials", () => {
  it("does not exist on a deployment without ADMIN_MIGRATE_TOKEN", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await POST(req("POST", "Bearer t0ken"))).status).toBe(404);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong token", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await POST(req("POST", "Bearer nope!"))).status).toBe(401);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("GET reports the missing table without writing", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const body = await (await GET(req("GET", "Bearer t0ken"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingTables: ["PlatformCredential"] });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("POST applies every statement once and reports before and after", async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "PlatformCredential" }]);
    const body = await (await POST(req("POST", "Bearer t0ken"))).json();
    expect(executeRaw.mock.calls.map((c) => c[0])).toEqual(PLATFORM_CREDENTIAL_DDL);
    expect(body).toEqual({ ok: true, before: { ready: false, missingTables: ["PlatformCredential"] }, after: { ready: true, missingTables: [] } });
  });

  it("every statement is safe to run twice", () => {
    for (const stmt of PLATFORM_CREDENTIAL_DDL) expect(stmt).toMatch(/IF NOT EXISTS/);
  });
});
