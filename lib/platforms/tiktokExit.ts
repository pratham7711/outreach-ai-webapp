import { Sandbox } from "@vercel/sandbox";

/**
 * An exit: one network identity that can fetch a TikTok page for us.
 *
 * TikTok answers by address, not by request -- a page that this deployment's
 * own egress gets as a 1.4KB login shell comes back in full from a Vercel
 * Sandbox, or from a VM on a non-AWS network (measured 2026-10-01: Azure US and
 * Google SG, 100% full pages at one read per 1.8s). The reader's job is the
 * same either way; only where the request leaves from changes. So the lane
 * pool and the parser see this interface and nothing else, and Plan A
 * (Sandbox) and Plan B (our own worker) differ in one constructor.
 *
 * `fetchPage` resolves null when THIS EXIT failed -- it could not boot, the
 * worker was unreachable, the command timed out. That is never TikTok's
 * answer about the page, and callers must not record it as one.
 */
export type ExitPage = { status: number; body: string; ms: number };

export type TikTokExit = {
  /** Stable for the life of the exit, and different for a replacement, so a
   *  page that was walled on one address can be retried on its successor. */
  readonly id: string;
  readonly kind: "sandbox" | "worker";
  fetchPage: (url: string) => Promise<ExitPage | null>;
  close: () => Promise<void>;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Pages an exit will fetch. A worker that only ever reads tiktok.com cannot be
 *  turned into a general proxy if its token leaks, and the same check here keeps
 *  a caller from sending it anything else. */
export function isTikTokPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "www.tiktok.com" || u.hostname === "tiktok.com");
  } catch {
    return false;
  }
}

const META = "\n__EXIT_META__ ";

/** Splits the curl output written with `-w` back into page and status. */
export function splitCurlOutput(out: string): { body: string; status: number } {
  const i = out.lastIndexOf(META);
  if (i < 0) return { body: out, status: 0 };
  const status = Number(out.slice(i + META.length).trim().split(/\s+/)[0]);
  return { body: out.slice(0, i), status: Number.isFinite(status) ? status : 0 };
}

export type SandboxExitOptions = {
  region: string;
  /** One vCPU: the work is waiting on TikTok, and the default (2) bills twice. */
  vcpus?: number;
  /** Must outlive the run's deadline plus its grace, or a lane is killed
   *  mid-read (plan F8). The caller passes it; there is no safe default. */
  lifetimeMs: number;
  label: string;
  /** Local scripts only. Deployed code authenticates through OIDC. */
  credentials?: { token: string; teamId: string; projectId: string };
};

/**
 * Plan A: a Vercel Sandbox, booted on first use and deleted on close.
 *
 * persistent:false and deleteOrphanSnapshots are not optional. With
 * persistence on, stopping a sandbox snapshots its 642MB filesystem and bills
 * it for 30 days -- 238 sandboxes once cost $13.49 a month of storage against
 * $0.51 of compute.
 */
export function sandboxExit(options: SandboxExitOptions): TikTokExit {
  let sandbox: Promise<Sandbox> | null = null;
  const boot = () => {
    if (!sandbox) {
      sandbox = Sandbox.create({
        region: options.region as never,
        timeout: options.lifetimeMs,
        persistent: false,
        resources: { vcpus: options.vcpus ?? 1 },
        ...(options.credentials ?? {}),
      } as Parameters<typeof Sandbox.create>[0]);
      sandbox.catch(() => {
        sandbox = null;
      });
    }
    return sandbox;
  };

  return {
    id: options.label,
    kind: "sandbox",
    async fetchPage(url) {
      if (!isTikTokPageUrl(url)) return null;
      const started = Date.now();
      try {
        const sb = await boot();
        const result = await sb.runCommand(
          "curl",
          [
            "-sL",
            /* About half the transfer, and the reason the Sandbox bill halves
               along with vcpus: lanes spend their life waiting on bytes. */
            "--compressed",
            "--max-time",
            "20",
            "-A",
            UA,
            "-H",
            "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H",
            "accept-language: en-US,en;q=0.9",
            "-w",
            `${META}%{http_code}`,
            url,
          ],
          { timeoutMs: 30_000 }
        );
        const raw = result as unknown as { stdout: string | (() => Promise<string>) };
        const stdout = typeof raw.stdout === "function" ? await raw.stdout() : raw.stdout;
        if (!stdout) return null;
        const { body, status } = splitCurlOutput(stdout);
        if (status === 0) return null;
        return { status, body, ms: Date.now() - started };
      } catch {
        return null;
      }
    },
    async close() {
      const p = sandbox;
      sandbox = null;
      if (!p) return;
      await p.then((s) => s.delete({ deleteOrphanSnapshots: true })).catch(() => {});
    },
  };
}

export type WorkerExitOptions = {
  /** https://… of the Plan B fetch service, without a trailing path. */
  baseUrl: string;
  token: string;
  label: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Plan B: our own small fetch service on a non-AWS network
 * (scripts/creator-worker/fetch-server.mjs). It holds no database credentials
 * and paces itself; this side only asks it for pages.
 */
export function httpWorkerExit(options: WorkerExitOptions): TikTokExit {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/fetch`;
  return {
    id: options.label,
    kind: "worker",
    async fetchPage(url) {
      if (!isTikTokPageUrl(url)) return null;
      const started = Date.now();
      try {
        const res = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 40_000),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { status?: unknown; body?: unknown };
        const status = Number(data.status);
        if (!Number.isFinite(status) || status <= 0 || typeof data.body !== "string") return null;
        return { status, body: data.body, ms: Date.now() - started };
      } catch {
        return null;
      }
    },
    async close() {},
  };
}
