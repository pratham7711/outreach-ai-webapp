import { ApiError, apiFetch, apiPost, redirectToSignIn } from "@/lib/api/client";
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

  /* Eight routes answer with a machine code in `error` and the sentence a
     person should read in `message`. Reading `error` first put the code in the
     toast: an Instagram original-audio link was refused with the literal text
     "instagram_audio_no_count" while the explanation sat unread in the same
     body. */
  it("prefers the human message over the machine code when a route sends both", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        { error: "instagram_audio_no_count", message: "Instagram doesn't publish a use count for that audio." },
        400,
      ),
    ) as unknown as typeof fetch;

    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      status: 400,
      message: "Instagram doesn't publish a use count for that audio.",
    });
  });

  it("still reads `error` when it is the only thing the route sent", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: "A folder name is required" }, 400)) as unknown as typeof fetch;

    await expect(apiFetch("/api/x")).rejects.toMatchObject({ message: "A folder name is required" });
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

describe("redirectToSignIn", () => {
  it("sends a creator to the portal sign-in and everyone else to the app one", () => {
    expect(redirectToSignIn("/portal/proposals")).toBe("/portal/login");
    expect(redirectToSignIn("/campaigns")).toBe("/login");
    expect(redirectToSignIn("/")).toBe("/login");
  });

  it("does not redirect a sign-in page to itself", () => {
    expect(redirectToSignIn("/login")).toBeNull();
    expect(redirectToSignIn("/portal/login")).toBeNull();
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
