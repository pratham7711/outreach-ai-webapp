/**
 * Where Plan B's worker is, if this deployment knows. Its own module, free of
 * the database, so the post readers can find the worker without pulling the
 * tracker switch (and Prisma) into every platform module.
 */
export function planBWorkerConfig(env: NodeJS.ProcessEnv = process.env): { baseUrl: string; token: string } | null {
  const baseUrl = env.TRACKER_PLAN_B_URL?.trim();
  const token = env.TRACKER_PLAN_B_TOKEN?.trim();
  if (!baseUrl || !token || !/^https?:\/\//.test(baseUrl)) return null;
  return { baseUrl, token };
}
