import type { NextRequest } from "next/server";
import { getRequestIp } from "@/lib/request";

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const MAX_BUCKETS = 10_000;

const buckets = new Map<string, number[]>();

function pruneBucket(timestamps: number[], windowStart: number): number[] {
  let cut = 0;
  while (cut < timestamps.length && timestamps[cut] <= windowStart) cut++;
  return cut === 0 ? timestamps : timestamps.slice(cut);
}

function evictIfNeeded(): void {
  if (buckets.size <= MAX_BUCKETS) return;
  const overflow = buckets.size - MAX_BUCKETS;
  let removed = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++removed >= overflow) break;
  }
}

export function rateLimit(options: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = options;
  const now = Date.now();
  const windowStart = now - windowMs;

  const existing = buckets.get(key) ?? [];
  const recent = pruneBucket(existing, windowStart);

  if (recent.length >= limit) {
    buckets.set(key, recent);
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  buckets.set(key, recent);
  evictIfNeeded();

  return { allowed: true, remaining: Math.max(0, limit - recent.length), retryAfterSeconds: 0 };
}

export function rateLimitKey(routeName: string, request: NextRequest): string {
  const ip = getRequestIp(request) ?? "unknown";
  return `${routeName}:${ip}`;
}
