import { ApiError, apiFetch, apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

describe("apiFetch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true })) as unknown as typeof fetch;
    await expect(apiFetch("/api/x")).resolves.toEqual({ ok: true });
  });

  it("raises an ApiError carrying the server's error string", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: "Song not found" }, 404)) as unknown as typeof fetch;

    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Song not found",
    });
  });

  it("treats a network failure as status 0 so it stays retryable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const error: unknown = await apiFetch("/api/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).isRetryable).toBe(true);
  });

  it("returns undefined for 204 rather than trying to parse a body", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("should not be called");
      },
    }) as unknown as typeof fetch;

    await expect(apiFetch("/api/x")).resolves.toBeUndefined();
  });

  it("sets a JSON content type only when there is a body", async () => {
    const spy = jest.fn().mockResolvedValue(jsonResponse({}));
    global.fetch = spy as unknown as typeof fetch;

    await apiPost("/api/x", { a: 1 });
    expect(spy.mock.calls[0][1].headers).toMatchObject({ "Content-Type": "application/json" });

    await apiFetch("/api/y");
    expect(spy.mock.calls[1][1].headers).not.toHaveProperty("Content-Type");
  });
});

describe("ApiError retryability", () => {
  it("retries transient classes only", () => {
    expect(new ApiError("", 0).isRetryable).toBe(true);
    expect(new ApiError("", 429).isRetryable).toBe(true);
    expect(new ApiError("", 503).isRetryable).toBe(true);
    expect(new ApiError("", 400).isRetryable).toBe(false);
    expect(new ApiError("", 404).isRetryable).toBe(false);
  });
});

describe("errorMessage", () => {
  it("explains the common failures in the user's terms", () => {
    expect(errorMessage(new ApiError("x", 0), "fallback")).toMatch(/offline/i);
    expect(errorMessage(new ApiError("x", 401), "fallback")).toMatch(/session expired/i);
    expect(errorMessage(new ApiError("x", 403), "fallback")).toMatch(/permission/i);
    expect(errorMessage(new ApiError("x", 500), "fallback")).toMatch(/our side/i);
  });

  it("prefers the server's own message for a plain 400", () => {
    expect(errorMessage(new ApiError("Sound id required", 400), "fallback")).toBe(
      "Sound id required"
    );
  });

  it("falls back for a non-ApiError", () => {
    expect(errorMessage(new Error("raw"), "fallback")).toBe("fallback");
  });
});
