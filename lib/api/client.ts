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
