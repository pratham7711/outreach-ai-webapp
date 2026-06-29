export interface RouteResponseLike {
  status: number;
  json?: () => Promise<unknown> | unknown;
  clone?: () => RouteResponseLike;
}

export type RouteHandler<TReq = unknown> = (
  req: TReq,
) => Promise<RouteResponseLike> | RouteResponseLike;

export interface CallMock {
  mockResolvedValue: (value: unknown) => unknown;
  mock: { calls: unknown[][]; invocationCallOrder: number[] };
}

export interface TriadScenarioResult {
  status: number;
  body: unknown;
}

export interface RouteTriadResult {
  unauthorized: TriadScenarioResult;
  crossTenant: TriadScenarioResult | null;
  happyPath: TriadScenarioResult;
}

export interface UnauthorizedSpec<TReq> {
  request: () => TReq;
  unauthenticatedValue?: unknown;
  expectedStatus?: number;
}

export interface CrossTenantSpec<TReq> {
  foreignSession: unknown;
  request: () => TReq;
  deniedStatuses?: number[];
  beforeScenario?: () => void;
  assertResponse?: (result: TriadScenarioResult) => void | Promise<void>;
}

export interface CrossTenantSkip {
  skip: true;
  reason: string;
}

export interface HappyPathSpec<TReq> {
  request: () => TReq;
  expectedStatuses?: number[];
  beforeScenario?: () => void;
  assertResponse?: (result: TriadScenarioResult) => void | Promise<void>;
}

export interface RouteTriadConfig<TReq = unknown> {
  handler: RouteHandler<TReq>;
  authMock: CallMock;
  authedSession: unknown;
  unauthorized: UnauthorizedSpec<TReq>;
  crossTenant: CrossTenantSpec<TReq> | CrossTenantSkip;
  happyPath: HappyPathSpec<TReq>;
  dbMocks?: CallMock[];
  resetBeforeScenario?: () => void;
}

const DEFAULT_DENIED_STATUSES = [403, 404];
const DEFAULT_HAPPY_STATUSES = [200, 201];

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isCrossTenantSkip<TReq>(
  spec: CrossTenantSpec<TReq> | CrossTenantSkip,
): spec is CrossTenantSkip {
  return (spec as CrossTenantSkip).skip === true;
}

async function readBodyStrict(res: RouteResponseLike): Promise<unknown> {
  if (typeof res.json !== "function") {
    throw new Error(
      "routeTriad: response exposes no json() but a body assertion was requested",
    );
  }
  const target = typeof res.clone === "function" ? res.clone() : res;
  return await (target.json as () => Promise<unknown>)();
}

async function readBodySafe(res: RouteResponseLike): Promise<unknown> {
  const target = typeof res.clone === "function" ? res.clone() : res;
  if (typeof target.json !== "function") return null;
  try {
    return await target.json();
  } catch {
    return null;
  }
}

async function invoke<TReq>(
  handler: RouteHandler<TReq>,
  request: () => TReq,
  requireBody: boolean,
): Promise<TriadScenarioResult> {
  const res = await handler(request());
  const body = requireBody ? await readBodyStrict(res) : await readBodySafe(res);
  return { status: res.status, body };
}

function totalCalls(mocks: CallMock[] | undefined): number {
  if (!mocks) return 0;
  return mocks.reduce((sum, m) => sum + m.mock.calls.length, 0);
}

function assertAuthBeforeDb(authMock: CallMock, dbMocks: CallMock[]): void {
  const authOrders = authMock.mock.invocationCallOrder;
  expect(authOrders.length).toBeGreaterThan(0);
  const firstAuth = Math.min(...authOrders);
  for (const m of dbMocks) {
    for (const order of m.mock.invocationCallOrder) {
      expect(order).toBeGreaterThan(firstAuth);
    }
  }
}

export async function runRouteTriad<TReq = unknown>(
  config: RouteTriadConfig<TReq>,
): Promise<RouteTriadResult> {
  const {
    handler,
    authMock,
    authedSession,
    unauthorized,
    crossTenant,
    happyPath,
    dbMocks,
    resetBeforeScenario,
  } = config;

  resetBeforeScenario?.();
  const unauthValue =
    "unauthenticatedValue" in unauthorized
      ? unauthorized.unauthenticatedValue
      : null;
  authMock.mockResolvedValue(unauthValue);
  const dbCallsBefore = totalCalls(dbMocks);
  const unauthorizedResult = await invoke(handler, unauthorized.request, false);
  expect(unauthorizedResult.status).toBe(unauthorized.expectedStatus ?? 401);
  expect(totalCalls(dbMocks)).toBe(dbCallsBefore);

  let crossTenantResult: TriadScenarioResult | null = null;
  if (isCrossTenantSkip(crossTenant)) {
    expect(typeof crossTenant.reason).toBe("string");
    expect(crossTenant.reason.trim().length).toBeGreaterThan(0);
  } else {
    resetBeforeScenario?.();
    crossTenant.beforeScenario?.();
    authMock.mockResolvedValue(crossTenant.foreignSession);
    crossTenantResult = await invoke(
      handler,
      crossTenant.request,
      Boolean(crossTenant.assertResponse),
    );
    if (crossTenant.assertResponse) {
      await crossTenant.assertResponse(crossTenantResult);
    } else {
      const denied = crossTenant.deniedStatuses ?? DEFAULT_DENIED_STATUSES;
      expect(denied.some(isSuccessStatus)).toBe(false);
      expect(denied).toContain(crossTenantResult.status);
    }
  }

  resetBeforeScenario?.();
  happyPath.beforeScenario?.();
  authMock.mockResolvedValue(authedSession);
  const happyPathResult = await invoke(
    handler,
    happyPath.request,
    Boolean(happyPath.assertResponse),
  );
  const happyStatuses = happyPath.expectedStatuses ?? DEFAULT_HAPPY_STATUSES;
  expect(happyStatuses).toContain(happyPathResult.status);
  if (dbMocks && dbMocks.length > 0) {
    assertAuthBeforeDb(authMock, dbMocks);
  }
  if (happyPath.assertResponse) {
    await happyPath.assertResponse(happyPathResult);
  }

  return {
    unauthorized: unauthorizedResult,
    crossTenant: crossTenantResult,
    happyPath: happyPathResult,
  };
}
