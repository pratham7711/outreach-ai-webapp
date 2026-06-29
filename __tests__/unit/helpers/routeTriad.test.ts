import {
  runRouteTriad,
  type RouteHandler,
  type RouteResponseLike,
} from "../../helpers/routeTriad";

const mockAuth = jest.fn();

const RESOURCES = [
  { id: "a1", orgId: "org-a", name: "Alpha" },
  { id: "b1", orgId: "org-b", name: "Bravo" },
];

const mockDb = {
  creator: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const ORG_A_SESSION = { user: { id: "user-a", orgId: "org-a" } };
const ORG_B_SESSION = { user: { id: "user-b", orgId: "org-b" } };

interface FakeReq {
  url: string;
}

function req(path: string): FakeReq {
  return { url: `http://localhost${path}` };
}

function jsonRes(status: number, body: unknown): RouteResponseLike {
  return { status, json: async () => body };
}

function getOrgId(session: unknown): string | null {
  const orgId = (session as { user?: { orgId?: unknown } } | null)?.user?.orgId;
  return typeof orgId === "string" && orgId.length > 0 ? orgId : null;
}

function scopedListHandler(): RouteHandler<FakeReq> {
  return async () => {
    const orgId = getOrgId(await mockAuth());
    if (!orgId) return jsonRes(401, null);
    const rows = await mockDb.creator.findMany({ where: { orgId } });
    return jsonRes(200, { items: rows });
  };
}

function scopedDetailHandler(): RouteHandler<FakeReq> {
  return async (request) => {
    const orgId = getOrgId(await mockAuth());
    if (!orgId) return jsonRes(401, null);
    const id = new URL(request.url).searchParams.get("id");
    const row = await mockDb.creator.findFirst({ where: { id, orgId } });
    if (!row) return jsonRes(404, null);
    return jsonRes(200, row);
  };
}

function resetScenario() {
  jest.clearAllMocks();
  mockDb.creator.findMany.mockImplementation(
    ({ where }: { where?: { orgId?: string } }) =>
      RESOURCES.filter((r) => !where?.orgId || r.orgId === where.orgId),
  );
  mockDb.creator.findFirst.mockImplementation(
    ({ where }: { where?: { id?: string; orgId?: string } }) =>
      RESOURCES.find(
        (r) => r.id === where?.id && (!where?.orgId || r.orgId === where.orgId),
      ) ?? null,
  );
}

describe("runRouteTriad — passes correctly-scoped routes", () => {
  it("passes a scoped list route (401, cross-tenant filtered to 200/own-rows, happy path)", async () => {
    const result = await runRouteTriad<FakeReq>({
      handler: scopedListHandler(),
      authMock: mockAuth,
      authedSession: ORG_A_SESSION,
      dbMocks: [mockDb.creator.findMany, mockDb.creator.findFirst],
      resetBeforeScenario: resetScenario,
      unauthorized: { request: () => req("/api/creators") },
      crossTenant: {
        foreignSession: ORG_B_SESSION,
        request: () => req("/api/creators"),
        assertResponse: ({ status, body }) => {
          expect(status).toBe(200);
          const items = (body as { items: { orgId: string }[] }).items;
          for (const item of items) expect(item.orgId).toBe("org-b");
        },
      },
      happyPath: {
        request: () => req("/api/creators"),
        assertResponse: ({ body }) => {
          const items = (body as { items: { orgId: string }[] }).items;
          expect(items.length).toBeGreaterThan(0);
          for (const item of items) expect(item.orgId).toBe("org-a");
        },
      },
    });
    expect(result.unauthorized.status).toBe(401);
    expect(result.crossTenant?.status).toBe(200);
    expect(result.happyPath.status).toBe(200);
  });

  it("passes a scoped detail route (cross-tenant 404 by default)", async () => {
    const result = await runRouteTriad<FakeReq>({
      handler: scopedDetailHandler(),
      authMock: mockAuth,
      authedSession: ORG_A_SESSION,
      dbMocks: [mockDb.creator.findFirst],
      resetBeforeScenario: resetScenario,
      unauthorized: { request: () => req("/api/creators/detail?id=a1") },
      crossTenant: {
        foreignSession: ORG_B_SESSION,
        request: () => req("/api/creators/detail?id=a1"),
      },
      happyPath: {
        request: () => req("/api/creators/detail?id=a1"),
        assertResponse: ({ body }) => {
          expect((body as { id: string }).id).toBe("a1");
        },
      },
    });
    expect(result.crossTenant?.status).toBe(404);
  });
});

describe("runRouteTriad — catches insecure routes (teeth)", () => {
  it("catches a route missing its 401 guard", async () => {
    const noGuard: RouteHandler<FakeReq> = async () =>
      jsonRes(200, { items: RESOURCES });
    await expect(
      runRouteTriad<FakeReq>({
        handler: noGuard,
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators") },
        crossTenant: { skip: true, reason: "exercising the 401 leg only" },
        happyPath: { request: () => req("/api/creators") },
      }),
    ).rejects.toThrow();
  });

  it("catches a cross-tenant leak on a detail route that ignores orgId", async () => {
    const leaky: RouteHandler<FakeReq> = async (request) => {
      const orgId = getOrgId(await mockAuth());
      if (!orgId) return jsonRes(401, null);
      const id = new URL(request.url).searchParams.get("id");
      const row = await mockDb.creator.findFirst({ where: { id } });
      if (!row) return jsonRes(404, null);
      return jsonRes(200, row);
    };
    await expect(
      runRouteTriad<FakeReq>({
        handler: leaky,
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        dbMocks: [mockDb.creator.findFirst],
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators/detail?id=a1") },
        crossTenant: {
          foreignSession: ORG_B_SESSION,
          request: () => req("/api/creators/detail?id=a1"),
        },
        happyPath: { request: () => req("/api/creators/detail?id=a1") },
      }),
    ).rejects.toThrow();
  });

  it("catches a cross-tenant leak on a LIST route that ignores orgId (body assertion)", async () => {
    const leakyList: RouteHandler<FakeReq> = async () => {
      const orgId = getOrgId(await mockAuth());
      if (!orgId) return jsonRes(401, null);
      const rows = await mockDb.creator.findMany({ where: {} });
      return jsonRes(200, { items: rows });
    };
    await expect(
      runRouteTriad<FakeReq>({
        handler: leakyList,
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        dbMocks: [mockDb.creator.findMany],
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators") },
        crossTenant: {
          foreignSession: ORG_B_SESSION,
          request: () => req("/api/creators"),
          assertResponse: ({ body }) => {
            const items = (body as { items: { orgId: string }[] }).items;
            for (const item of items) expect(item.orgId).toBe("org-b");
          },
        },
        happyPath: { request: () => req("/api/creators") },
      }),
    ).rejects.toThrow();
  });

  it("rejects a default-path cross-tenant assertion whose deniedStatuses accepts a success status", async () => {
    const leaky: RouteHandler<FakeReq> = async (request) => {
      const orgId = getOrgId(await mockAuth());
      if (!orgId) return jsonRes(401, null);
      const id = new URL(request.url).searchParams.get("id");
      const row = await mockDb.creator.findFirst({ where: { id } });
      if (!row) return jsonRes(404, null);
      return jsonRes(200, row);
    };
    await expect(
      runRouteTriad<FakeReq>({
        handler: leaky,
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        dbMocks: [mockDb.creator.findFirst],
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators/detail?id=a1") },
        crossTenant: {
          foreignSession: ORG_B_SESSION,
          request: () => req("/api/creators/detail?id=a1"),
          deniedStatuses: [200, 403, 404],
        },
        happyPath: { request: () => req("/api/creators/detail?id=a1") },
      }),
    ).rejects.toThrow();
  });

  it("catches a route that touches the DB before checking auth (count)", async () => {
    const queriesBeforeAuth: RouteHandler<FakeReq> = async () => {
      await mockDb.creator.findMany({ where: {} });
      const orgId = getOrgId(await mockAuth());
      if (!orgId) return jsonRes(401, null);
      return jsonRes(200, { items: [] });
    };
    await expect(
      runRouteTriad<FakeReq>({
        handler: queriesBeforeAuth,
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        dbMocks: [mockDb.creator.findMany],
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators") },
        crossTenant: { skip: true, reason: "exercising the no-db-before-auth leg" },
        happyPath: { request: () => req("/api/creators") },
      }),
    ).rejects.toThrow();
  });

  it("catches a branch-masked early DB query via auth-before-DB ordering on the happy path", async () => {
    const conditionalEarlyQuery: RouteHandler<FakeReq> = async (request) => {
      const wantsList = new URL(request.url).searchParams.get("list") === "1";
      if (wantsList) {
        await mockDb.creator.findMany({ where: {} });
      }
      const orgId = getOrgId(await mockAuth());
      if (!orgId) return jsonRes(401, null);
      return jsonRes(200, { items: [] });
    };
    await expect(
      runRouteTriad<FakeReq>({
        handler: conditionalEarlyQuery,
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        dbMocks: [mockDb.creator.findMany],
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators") },
        crossTenant: { skip: true, reason: "ordering check is the focus" },
        happyPath: { request: () => req("/api/creators?list=1") },
      }),
    ).rejects.toThrow();
  });

  it("rejects a cross-tenant skip with an empty reason", async () => {
    await expect(
      runRouteTriad<FakeReq>({
        handler: scopedListHandler(),
        authMock: mockAuth,
        authedSession: ORG_A_SESSION,
        dbMocks: [mockDb.creator.findMany],
        resetBeforeScenario: resetScenario,
        unauthorized: { request: () => req("/api/creators") },
        crossTenant: { skip: true, reason: "   " },
        happyPath: { request: () => req("/api/creators") },
      }),
    ).rejects.toThrow();
  });
});

describe("runRouteTriad — session sentinels", () => {
  it("treats an explicit undefined session as unauthenticated", async () => {
    const result = await runRouteTriad<FakeReq>({
      handler: scopedListHandler(),
      authMock: mockAuth,
      authedSession: ORG_A_SESSION,
      dbMocks: [mockDb.creator.findMany],
      resetBeforeScenario: resetScenario,
      unauthorized: {
        request: () => req("/api/creators"),
        unauthenticatedValue: undefined,
      },
      crossTenant: { skip: true, reason: "session-sentinel check only" },
      happyPath: { request: () => req("/api/creators") },
    });
    expect(result.unauthorized.status).toBe(401);
    expect(result.crossTenant).toBeNull();
  });
});
