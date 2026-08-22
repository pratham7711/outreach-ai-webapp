/**
 * Turn the machine's VPN on and off from code.
 *
 * Why this is needed at all: TikTok is DNS-blackholed on Indian ISPs, so no
 * TikTok metric can be fetched from here without a tunnel. But through the
 * tunnel our Neon database becomes unreachable -- TCP to port 5432 connects and
 * then the TLS write is reset, while port 443 passes fine -- so the two halves
 * of a sync cannot share a network. Anything that fetches TikTok and then stores
 * it has to move the tunnel underneath itself, which is what this module is for.
 *
 * macOS only, and deliberately not AppleScript: driving the ProtonVPN app that
 * way needs assistive-access permission that a terminal process does not have.
 * The VPN is also configured as a system network service, and `scutil` speaks to
 * that directly with no GUI and no sudo.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The name as it appears in `scutil --nc list`. */
export const VPN_SERVICE = process.env.VPN_SERVICE ?? "ProtonVPN";

export async function vpnStatus(service = VPN_SERVICE) {
  try {
    const { stdout } = await run("/usr/sbin/scutil", ["--nc", "status", service]);
    return stdout.split("\n")[0].trim(); // Connected | Disconnected | Connecting
  } catch {
    return "Unavailable";
  }
}

async function settle(service, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await vpnStatus(service)) === want) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function vpnUp({ service = VPN_SERVICE, timeoutMs = 45_000 } = {}) {
  if ((await vpnStatus(service)) === "Connected") return true;
  await run("/usr/sbin/scutil", ["--nc", "start", service]);
  return settle(service, "Connected", timeoutMs);
}

export async function vpnDown({ service = VPN_SERVICE, timeoutMs = 30_000 } = {}) {
  if ((await vpnStatus(service)) === "Disconnected") return true;
  await run("/usr/sbin/scutil", ["--nc", "stop", service]);
  return settle(service, "Disconnected", timeoutMs);
}

/** Where the traffic actually comes out, which is the only thing TikTok cares about. */
export async function egress() {
  try {
    const res = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    return [d.ip, d.country, d.org].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

/**
 * Whether TikTok answers. Checked before every fetch phase, because a run from a
 * blocked network returns empty metrics for every post, and empty metrics
 * written over real ones is worse than not running.
 */
export async function tiktokReachable() {
  try {
    const res = await fetch("https://www.tiktok.com/@nba", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    return res.ok || res.status === 302;
  } catch {
    return false;
  }
}

/** Whether our own database answers, which is what the tunnel breaks. */
export async function dbReachable(host, port = 5432) {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(6000);
    // A completed TLS handshake is the real test, but the tunnel's failure mode
    // is a reset immediately after connect, so a clean connect plus a moment of
    // silence is enough to tell the two networks apart.
    sock.once("connect", () => setTimeout(() => done(sock.destroyed === false), 1200));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
  });
}

/** Run `fn` with the tunnel up, and put the tunnel back however it was found. */
export async function withVpn(fn, opts = {}) {
  const was = await vpnStatus(opts.service ?? VPN_SERVICE);
  const raised = await vpnUp(opts);
  if (!raised) throw new Error(`VPN "${opts.service ?? VPN_SERVICE}" did not connect`);
  try {
    return await fn();
  } finally {
    if (was !== "Connected") await vpnDown(opts);
  }
}
