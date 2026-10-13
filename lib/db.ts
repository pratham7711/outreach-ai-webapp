import { PrismaClient } from "@/lib/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { explicitSslMode } from "@/lib/dbUrl";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * The pool's limits, named rather than left to pg's defaults.
 *
 * pg's defaults are max 10, idle 10 s and NO connection timeout. The first meant
 * a dashboard's burst of parallel reads queued in waves of ten (measured
 * 2026-10-13: 40 concurrent requests took 980 ms, in steps of ten); the last
 * meant a request that could not get a connection waited for as long as the
 * function was allowed to live, then died without saying why.
 *
 * - max 20: the URL is Neon's PgBouncer pooler, which multiplexes client
 *   connections onto its own small server pool, so twenty clients per instance
 *   cost the database nothing extra. Every fan-out in lib/ is capped at six or
 *   fewer, so this is headroom for concurrent requests, not for one job.
 * - idle 10 s: unchanged from pg's default on purpose. A longer idle hold saves
 *   a reconnect but keeps a connection open between requests, and the Neon
 *   compute's scale-to-zero is the cost this codebase watches.
 * - connect 5 s: fail a starved acquire loudly, in the same spirit as Prisma's
 *   own 2 s maxWait for an interactive transaction, rather than hang until the
 *   platform kills the function and its finally blocks never run.
 */
export const DB_POOL_OPTIONS = {
  max: 20,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
} as const;

function createPrismaClient() {
  /* A pool config rather than a pg.Pool instance: the adapter builds the pool
     from exactly these options (and attaches its idle-error listener), and an
     instance would have to satisfy the adapter's own nested, older @types/pg,
     which tsc refuses. Same pool at runtime either way. */
  const adapter = new PrismaPg({
    connectionString: explicitSslMode(process.env.DATABASE_URL)!,
    ...DB_POOL_OPTIONS,
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
