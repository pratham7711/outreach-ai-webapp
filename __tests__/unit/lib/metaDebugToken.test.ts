/**
 * @jest-environment node
 *
 * debug_token reading: expires_at 0 means "never", an unreadable answer is
 * null (unknown, check again) and never a healthy token.
 */
jest.mock("@/lib/oauth/providers", () => ({ clientCredentialsFor: jest.fn() }));
jest.mock("@/lib/platforms/instagram", () => {
  class InstagramAuthError extends Error {}
  return { graphGet: jest.fn(), InstagramAuthError };
});

import { clientCredentialsFor } from "@/lib/oauth/providers";
import { graphGet, InstagramAuthError } from "@/lib/platforms/instagram";
import { debugMetaToken } from "@/lib/platforms/metaDebugToken";

const authError = () => new (InstagramAuthError as unknown as new (m: string) => Error)("auth");
const mockCreds = clientCredentialsFor as jest.Mock;
const mockGraph = graphGet as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreds.mockReturnValue({ clientId: "id", clientSecret: "secret" });
});

describe("debugMetaToken", () => {
  it("reads expiry and data-access expiry as dates, and asks with the app token", async () => {
    mockGraph.mockResolvedValue({ data: { is_valid: true, expires_at: 1800000000, data_access_expires_at: 1790000000 } });
    const facts = await debugMetaToken("user-tok");
    expect(facts).toEqual({ valid: true, expiresAt: new Date(1800000000 * 1000), dataAccessExpiresAt: new Date(1790000000 * 1000) });
    expect(mockGraph).toHaveBeenCalledWith("debug_token", { input_token: "user-tok", access_token: "id|secret" }, undefined);
  });

  it("maps expires_at 0 to null (never expires) and a missing data-access date to null", async () => {
    mockGraph.mockResolvedValue({ data: { is_valid: true, expires_at: 0 } });
    expect(await debugMetaToken("t")).toEqual({ valid: true, expiresAt: null, dataAccessExpiresAt: null });
  });

  it("reports an invalid token as invalid", async () => {
    mockGraph.mockResolvedValue({ data: { is_valid: false } });
    expect((await debugMetaToken("t"))?.valid).toBe(false);
  });

  it("returns null, not a healthy token, when it cannot be read", async () => {
    mockGraph.mockResolvedValue(null);
    expect(await debugMetaToken("t")).toBeNull();
    mockGraph.mockResolvedValue({ data: {} });
    expect(await debugMetaToken("t")).toBeNull();
    mockGraph.mockRejectedValue(authError());
    expect(await debugMetaToken("t")).toBeNull();
    mockCreds.mockReturnValue(null);
    expect(await debugMetaToken("t")).toBeNull();
  });
});
