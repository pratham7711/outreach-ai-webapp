import { ApiError } from "@/lib/api/client";

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "You appear to be offline. Check your connection and try again.";
    if (error.isUnauthorized) return "Your session expired. Sign in again to continue.";
    if (error.status === 403) return "You do not have permission to do that.";
    if (error.isNotFound) return "That item no longer exists.";
    if (error.status === 429) return "Too many requests. Wait a moment and try again.";
    if (error.status >= 500) return "Something went wrong on our side. Try again shortly.";
    return error.message || fallback;
  }
  return fallback;
}
