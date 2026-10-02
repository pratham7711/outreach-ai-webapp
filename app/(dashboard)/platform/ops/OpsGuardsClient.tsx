"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ds";
import type { OpsGuardsReport, OpsJob, OpsSwitch } from "@/lib/ops/opsReport";

type Pending = { kind: "kill-switch"; key: string; off: boolean; label: string } | { kind: "reset-breaker"; key: string; label: string };

const NUM = new Intl.NumberFormat("en-US");
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function every(minutes: number): string {
  if (minutes < 60) return `every ${minutes} min`;
  if (minutes < 1440) return `every ${minutes / 60} h`;
  return minutes === 1440 ? "daily" : minutes === 10080 ? "weekly" : `every ${Math.round(minutes / 1440)} days`;
}

type ToneKind = "good" | "bad" | "warn" | "muted";
const TONE_COLOR: Record<ToneKind, string> = {
  good: "var(--cc-success)",
  bad: "var(--cc-danger)",
  warn: "var(--cc-warning-ink)",
  muted: "var(--cc-text-muted)",
};

function Tone({ kind, children }: { kind: ToneKind; children: React.ReactNode }) {
  return <span style={{ color: TONE_COLOR[kind], fontWeight: "var(--cc-fw-strong)" }}>{children}</span>;
}

const HEALTH: Record<OpsJob["health"], { label: string; kind: ToneKind }> = {
  ok: { label: "on time", kind: "good" },
  running: { label: "running", kind: "muted" },
  failing: { label: "failing", kind: "bad" },
  stuck: { label: "never finished", kind: "bad" },
  overdue: { label: "overdue", kind: "bad" },
  "no-heartbeat": { label: "no heartbeat yet", kind: "muted" },
  killed: { label: "switched off", kind: "warn" },
};

const PHASE: Record<string, { label: string; kind: ToneKind }> = {
  closed: { label: "closed", kind: "good" },
  open: { label: "open", kind: "bad" },
  "half-open": { label: "half-open", kind: "warn" },
};

function SwitchButton({ sw, onAsk, disabled }: { sw: OpsSwitch; onAsk: (off: boolean) => void; disabled: boolean }) {
  return (
    <button type="button" className="cc-tracker-ops-secondary" disabled={disabled} onClick={() => onAsk(!sw.off)}>
      {sw.off ? "Turn on" : "Turn off"}
    </button>
  );
}

export default function OpsGuardsClient({ initial }: { initial: OpsGuardsReport }) {
  const [report, setReport] = useState(initial);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchOf = (key: string) => report.switches.find((s) => s.key === key);
  const ask = (p: Pending) => {
    setPending(p);
    setReason("");
    setError(null);
  };

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        pending.kind === "kill-switch"
          ? { action: "kill-switch", key: pending.key, off: pending.off, reason }
          : { action: "reset-breaker", key: pending.key };
      const res = await fetch("/api/platform/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReport(data.report);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  /* The confirm step, shown under the section the action came from. */
  const confirmPanel = (keys: string[]) =>
    pending && keys.includes(pending.key) ? (
      <div className="cc-tracker-ops-confirm" role="alertdialog" aria-label="Confirm change" style={{ marginTop: 12 }}>
        {pending.kind === "kill-switch" ? (
          <>
            <p style={{ margin: 0 }}>
              {pending.off ? "Turn off" : "Turn back on"} <b>{pending.label}</b>?{" "}
              {pending.off
                ? pending.key.startsWith("source:")
                  ? "The creator and post readers leave this platform out from their next run, for every agency."
                  : "Its next scheduled run answers “skipped” without doing any work, for every agency."
                : "It runs again on its next schedule."}
            </p>
            <label className="cc-tracker-ops-check cc-tracker-ops-note" style={{ marginTop: 10 }}>
              Reason
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="cc-tracker-ops-input" placeholder="Why (kept in the log)" />
            </label>
          </>
        ) : (
          <p style={{ margin: 0 }}>
            Close the <b>{pending.label}</b> breaker by hand? Reads of this source resume on the next run; if it is still failing the breaker
            opens again after the same run of failures.
          </p>
        )}
        <div className="cc-tracker-ops-actions">
          <button type="button" className="cc-tracker-ops-secondary" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="cc-tracker-ops-primary" onClick={confirm} disabled={busy}>
            {busy ? "Saving…" : "Confirm"}
          </button>
        </div>
        {error && (
          <p role="alert" className="cc-tracker-ops-error">
            {error}
          </p>
        )}
      </div>
    ) : null;

  const attention = report.jobs.filter((j) => j.health === "overdue" || j.health === "stuck" || j.health === "failing").length;
  const sb = report.sandbox;
  const sbShare = sb.cap > 0 ? sb.used / sb.cap : 0;
  const sources = report.switches.filter((s) => s.kind === "source");
  const cronKeys = report.jobs.map((j) => `cron:${j.job}`);

  return (
    <div className="cc-tracker-ops">
      <PageHeader
        title="Ops guards"
        subtitle="Cron heartbeats, kill switches, source breakers, today's Sandbox use and last week's spend against the model."
      />
      <p className="cc-tracker-ops-sub">
        The tracker reader&rsquo;s own switch (legacy, A, B) is on{" "}
        <Link href="/platform/trackers" style={{ color: "var(--cc-primary)" }}>
          Tracker reader
        </Link>
        .
      </p>

      {!report.tablesReady && (
        <div className="cc-tracker-ops-banner" role="status">
          The ops tables are not applied on this database, so nothing is switched off, every breaker is closed, no Sandbox is refused and
          no heartbeat or meter is recorded. Apply them with POST /api/admin/migrate-ops-guards.
        </div>
      )}

      <div className="cc-tracker-ops-grid">
        <div className="cc-tracker-ops-card">
          <div className="cc-tracker-ops-label">Scheduled jobs</div>
          <div className="cc-tracker-ops-metric">{attention === 0 ? "All on time" : `${attention} need attention`}</div>
          <div className="cc-tracker-ops-sub">
            {report.jobs.length} jobs · {report.jobs.filter((j) => j.health === "killed").length} switched off · overdue means no start in two of its
            intervals
          </div>
        </div>
        <div className="cc-tracker-ops-card">
          <div className="cc-tracker-ops-label">Sandboxes today ({sb.day}, UTC)</div>
          <div className="cc-tracker-ops-metric">
            <Tone kind={sb.used >= sb.cap ? "bad" : sbShare >= 0.8 ? "warn" : "muted"}>{NUM.format(sb.used)}</Tone> of {NUM.format(sb.cap)}
          </div>
          <div className="cc-tracker-ops-sub">
            created against the daily cap{sb.capFromEnv ? " (SANDBOX_DAILY_CAP)" : " (default)"} · {NUM.format(sb.refused)} refused
          </div>
        </div>
        {report.meters.map((m) => (
          <div key={m.meter} className="cc-tracker-ops-card">
            <div className="cc-tracker-ops-label">
              {m.label} · {m.weekStart ? `week of ${m.weekStart}` : "no week read yet"}
            </div>
            <div className="cc-tracker-ops-metric">{m.costUsd === null ? "—" : USD.format(m.costUsd)}</div>
            <div className="cc-tracker-ops-sub">
              model {USD.format(m.weeklyLowUsd)}–{USD.format(m.weeklyHighUsd)} a week at 4k ·{" "}
              {m.status === "over" ? (
                <Tone kind="bad">{Math.round((m.ratio ?? 0) * 100)}% of the upper bound</Tone>
              ) : m.status === "ok" ? (
                <Tone kind="good">{Math.round((m.ratio ?? 0) * 100)}% of the upper bound</Tone>
              ) : m.status === "error" ? (
                <Tone kind="bad">could not be read</Tone>
              ) : m.meter === "neon-compute" && !report.neonConfigured ? (
                "NEON_API_KEY / NEON_ORG_ID not set"
              ) : (
                "not configured"
              )}
            </div>
            {m.value !== null && (
              <div className="cc-tracker-ops-sub">
                {m.value.toFixed(1)} {m.unit}
              </div>
            )}
          </div>
        ))}
      </div>

      <section className="cc-tracker-ops-section" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="cc-tracker-ops-h2">Scheduled jobs</h2>
        <p className="cc-tracker-ops-sub">
          Turning a job off makes its next run answer “skipped” without working; nothing is redeployed. The canary checks every job hourly.
        </p>
        <div className="cc-tracker-ops-table-wrap">
          <table className="cc-tracker-ops-table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Status</th>
                <th scope="col">Runs</th>
                <th scope="col">Last started</th>
                <th scope="col">Took</th>
                <th scope="col">Last result</th>
                <th scope="col">Switch</th>
              </tr>
            </thead>
            <tbody>
              {report.jobs.map((j) => {
                const sw = switchOf(`cron:${j.job}`);
                const h = HEALTH[j.health];
                return (
                  <tr key={j.job}>
                    <td>
                      <div>{j.label}</div>
                      <div className="cc-tracker-ops-sub">{j.job}</div>
                    </td>
                    <td>
                      <Tone kind={h.kind}>{h.label}</Tone>
                    </td>
                    <td>{every(j.cadenceMinutes)}</td>
                    <td>{ago(j.lastStartedAt)}</td>
                    <td>{j.durationMs === null ? "—" : `${(j.durationMs / 1000).toFixed(1)} s`}</td>
                    <td>
                      {j.lastOk === null ? (
                        <span className="cc-tracker-ops-sub">—</span>
                      ) : j.lastOk ? (
                        <Tone kind="good">ok</Tone>
                      ) : (
                        <span title={j.lastError ?? undefined}>
                          <Tone kind="bad">failed{j.consecutiveFailures > 1 ? ` ×${j.consecutiveFailures}` : ""}</Tone>
                        </span>
                      )}
                    </td>
                    <td>
                      {sw && (
                        <SwitchButton
                          sw={sw}
                          disabled={busy || !report.tablesReady}
                          onAsk={(off) => ask({ kind: "kill-switch", key: sw.key, off, label: j.label })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {confirmPanel(cronKeys)}
      </section>

      <section className="cc-tracker-ops-section" aria-labelledby="sources-heading">
        <h2 id="sources-heading" className="cc-tracker-ops-h2">Read sources</h2>
        <p className="cc-tracker-ops-sub">
          A source switched off is left out by the creator readers (legacy and v2) and the post sync until it is turned back on.
        </p>
        <div className="cc-tracker-ops-grid">
          {sources.map((s) => {
            const name = s.key.replace("source:", "");
            return (
              <div key={s.key} className="cc-tracker-ops-card">
                <div className="cc-tracker-ops-label">{name}</div>
                <div className="cc-tracker-ops-sub">
                  {s.off ? <Tone kind="warn">switched off</Tone> : <Tone kind="good">reading</Tone>}
                  {s.off && s.updatedAt && ` · ${ago(s.updatedAt)} by ${s.updatedBy ?? "unknown"}`}
                  {s.off && s.reason && ` · ${s.reason}`}
                </div>
                <div>
                  <SwitchButton
                    sw={s}
                    disabled={busy || !report.tablesReady}
                    onAsk={(off) => ask({ kind: "kill-switch", key: s.key, off, label: `${name} reads` })}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {confirmPanel(sources.map((s) => s.key))}
      </section>

      <section className="cc-tracker-ops-section" aria-labelledby="breakers-heading">
        <h2 id="breakers-heading" className="cc-tracker-ops-h2">Source breakers</h2>
        <p className="cc-tracker-ops-sub">
          Reader v2 and the post sync stop reading a source after 25 failures in a row, try a few reads after 2 hours, and resume on any
          success. The legacy sweep has no breaker.
        </p>
        <div className="cc-tracker-ops-table-wrap">
          <table className="cc-tracker-ops-table">
            <thead>
              <tr>
                <th scope="col">Breaker</th>
                <th scope="col">State</th>
                <th scope="col">Failures in a row</th>
                <th scope="col">Opened</th>
                <th scope="col">Last reason</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {report.breakers.map((b) => {
                const p = PHASE[b.phase] ?? PHASE.closed;
                return (
                  <tr key={b.key}>
                    <td>{b.key}</td>
                    <td>
                      <Tone kind={p.kind}>{p.label}</Tone>
                    </td>
                    <td>{NUM.format(b.consecutiveFailures)}</td>
                    <td>{b.phase === "closed" ? "—" : ago(b.openedAt)}</td>
                    <td>{b.lastReason ?? "—"}</td>
                    <td>
                      {b.phase !== "closed" && (
                        <button
                          type="button"
                          className="cc-tracker-ops-secondary"
                          disabled={busy || !report.tablesReady}
                          onClick={() => ask({ kind: "reset-breaker", key: b.key, label: b.key })}
                        >
                          Close
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {confirmPanel(report.breakers.map((b) => b.key))}
      </section>

      <section className="cc-tracker-ops-section" aria-labelledby="sandbox-heading">
        <h2 id="sandbox-heading" className="cc-tracker-ops-h2">Sandboxes today by caller</h2>
        {sb.byCaller.length === 0 ? (
          <p className="cc-tracker-ops-sub">No sandbox has been created today (UTC), or the counter is not applied yet.</p>
        ) : (
          <div className="cc-tracker-ops-table-wrap">
            <table className="cc-tracker-ops-table">
              <thead>
                <tr>
                  <th scope="col">Caller</th>
                  <th scope="col">Created</th>
                  <th scope="col">Refused</th>
                  <th scope="col">Closed</th>
                  <th scope="col">Sandbox time</th>
                </tr>
              </thead>
              <tbody>
                {sb.byCaller.map((c) => (
                  <tr key={c.caller}>
                    <td>{c.caller}</td>
                    <td>{NUM.format(c.creations)}</td>
                    <td>{NUM.format(c.refused)}</td>
                    <td>{NUM.format(c.closed)}</td>
                    <td>{(c.seconds / 60).toFixed(1)} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cc-tracker-ops-section" aria-labelledby="log-heading">
        <h2 id="log-heading" className="cc-tracker-ops-h2">Switch log</h2>
        {report.switchLog.length === 0 ? (
          <p className="cc-tracker-ops-sub">No switch has been flipped.</p>
        ) : (
          <ul className="cc-tracker-ops-log">
            {report.switchLog.map((l, i) => (
              <li key={`${l.changedAt}-${i}`}>
                {ago(l.changedAt)} · <b>{l.key}</b> {l.off ? "off" : "on"} · {l.changedBy ?? "unknown"}
                {l.reason && ` · ${l.reason}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
