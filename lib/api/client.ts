export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  get isRetryable(): boolean {
    if (this.status === 0) return true;
    if (this.status === 408 || this.status === 429) return true;
    return this.status >= 500;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * A session can expire while a tab sits open. Middleware only runs on a
 * navigation, so every later fetch 401s and the page just stops filling in —
 * which reads as "the app is broken", not "you are signed out". The portal has
 * always redirected on 401; this does the same for every other surface.
 */
export function redirectToSignIn(pathname: string): string | null {
  const target = pathname.startsWith("/portal") ? "/portal/login" : "/login";
  if (pathname.startsWith(target)) return null;
  return target;
}

function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  const target = redirectToSignIn(window.location.pathname);
  if (target) window.location.href = target;
}

async function readError(res: Response): Promise<{ message: string; details: unknown }> {
  try {
    const body = await res.json();
    const message =
      typeof body?.error === "string"
        ? body.error
        : typeof body?.message === "string"
          ? body.message
          : res.statusText;
    return { message: message || `Request failed (${res.status})`, details: body };
  } catch {
    return { message: res.statusText || `Request failed (${res.status})`, details: null };
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : "Network request failed",
      0
    );
  }

  if (!res.ok) {
    const { message, details } = await readError(res);
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(message, res.status, details);
  }

  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("Response was not valid JSON", res.status);
  }
}

export function apiPost<T>(input: string, body: unknown): Promise<T> {
  return apiFetch<T>(input, { method: "POST", body: JSON.stringify(body) });
}

export function apiPatch<T>(input: string, body: unknown): Promise<T> {
  return apiFetch<T>(input, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiDelete<T>(input: string): Promise<T> {
  return apiFetch<T>(input, { method: "DELETE" });
}
