"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ds";
import type { TrackerOpsReport, PlanDay } from "@/lib/trackers/opsReport";

type Position = "legacy" | "A" | "B";

const POSITIONS: { key: Position; label: string; detail: string }[] = [
  { key: "legacy", label: "Legacy", detail: "Today's sweep, every 2 hours" },
  { key: "A", label: "Plan A", detail: "Reader v2 on Vercel Sandbox lanes, hourly" },
  { key: "B", label: "Plan B", detail: "Reader v2 through our own worker, hourly" },
];

const NUM = new Intl.NumberFormat("en-US");
const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 1000) / 10}%` : "—");

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function Tone({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const color = ok === null ? "var(--cc-text-muted)" : ok ? "var(--cc-success)" : "var(--cc-danger)";
  return <span style={{ color, fontWeight: "var(--cc-fw-strong)" }}>{children}</span>;
}

function PlanCard({ title, day, extra }: { title: string; day: PlanDay; extra?: React.ReactNode }) {
  return (
    <div className="cc-tracker-ops-card">
      <div className="cc-tracker-ops-label">{title} · last 24 h</div>
      <div className="cc-tracker-ops-metric">{pct(day.proper, day.reads)}</div>
      <div className="cc-tracker-ops-sub">
        answered properly · {NUM.format(day.reads)} reads in {day.runs} run{day.runs === 1 ? "" : "s"} · {NUM.format(day.walls)} walls ·{" "}
        {NUM.format(day.failures)} exit failures
      </div>
      <div className="cc-tracker-ops-sub">
        Last run {ago(day.lastRunAt)}{" "}
        {day.lastOk !== null && <Tone ok={day.lastOk}>{day.lastOk ? "passed" : "below 97%"}</Tone>}
      </div>
      {extra}
    </div>
  );
}

export default function TrackerOpsClient({ initial }: { initial: TrackerOpsReport }) {
  const [report, setReport] = useState(initial);
  const [target, setTarget] = useState<Position>(initial.plan.position as Position);
  const [scope, setScope] = useState<string[]>(initial.plan.scopeOrgIds);
  const [percent, setPercent] = useState<number>(initial.plan.percent);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = report.plan;
  const b = report.planB;
  const unchanged =
    target === live.position &&
    percent === live.percent &&
    scope.length === live.scopeOrgIds.length &&
    scope.every((id) => live.scopeOrgIds.includes(id));
  const bBlocked = target === "B" && (!b.ready || !b.configured);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/tracker-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: target, scopeOrgIds: target === "legacy" ? [] : scope, percent: target === "legacy" ? 100 : percent, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReport(data.report);
      setConfirming(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch");
    } finally {
      setBusy(false);
    }
  }

  const orgName = (id: string) => report.orgs.find((o) => o.id === id)?.name ?? id;

  return (
    <div className="rsp-page cc-tracker-ops">
      <PageHeader
        title="Tracker reader"
        subtitle="Which reader reads creator trackers, how Plan A and Plan B are doing, and the switch between them."
      />

      {!report.tablesReady && (
        <div className="cc-tracker-ops-banner" role="status">
          The switch tables are not applied on this database, so the tracker runs on the legacy sweep. Apply them with POST
          /api/admin/migrate-tracker-sources.
        </div>
      )}

      <section className="cc-tracker-ops-section" aria-labelledby="live-heading">
        <h2 id="live-heading" className="cc-tracker-ops-h2">Live now</h2>
        <p className="cc-tracker-ops-sub">
          <b>{POSITIONS.find((p) => p.key === live.effective)?.label}</b>
          {live.effective !== "legacy" &&
            ` · ${live.scopeOrgIds.length ? live.scopeOrgIds.map(orgName).join(", ") : "every agency"} · ${live.percent}% of their creators`}
          {live.reason && <> · <Tone ok={false}>{live.reason}</Tone></>}
          {live.changedAt && ` · switched ${ago(live.changedAt as unknown as string)} by ${live.changedBy ?? "unknown"}`}
        </p>
      </section>

      <div className="cc-tracker-ops-grid">
        <PlanCard title="Plan A" day={report.day.A} />
        <PlanCard
          title="Plan B"
          day={report.day.B}
          extra={
            <div className="cc-tracker-ops-sub">
              Daily check:{" "}
              {b.lastCheck ? (
                <>
                  <Tone ok={b.lastCheck.ok}>{b.lastCheck.ok ? "passed" : "failed"}</Tone> {ago(b.lastCheck.at as unknown as string)}
                </>
              ) : (
                "none on record"
              )}
              {" · "}
              {b.configured ? "worker configured" : <Tone ok={false}>worker not configured here</Tone>}
            </div>
          }
        />
        <div className="cc-tracker-ops-card">
          <div className="cc-tracker-ops-label">Validation gate · last 24 h</div>
          <div className="cc-tracker-ops-metric">{NUM.format(report.quarantine.held + report.quarantine.rejected)}</div>
          <div className="cc-tracker-ops-sub">
            readings kept off the record · {report.quarantine.held} held for a second read · {report.quarantine.rejected} rejected
          </div>
        </div>
      </div>

      <section className="cc-tracker-ops-section" aria-labelledby="switch-heading">
        <h2 id="switch-heading" className="cc-tracker-ops-h2">Switch</h2>
        <p className="cc-tracker-ops-sub">
          The next run uses the new position; nothing is redeployed. Back to Legacy or Plan A is always allowed. Plan B is refused unless its
          last daily check passed within 36 hours. Switch to B when A fails for our reasons (a Sandbox outage, an AWS-range wall, a spend
          spike) — never to get around a deliberate block by TikTok.
        </p>
        <div role="radiogroup" aria-label="Reader" className="cc-tracker-ops-positions">
          {POSITIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={target === p.key}
              className="cc-tracker-ops-position"
              onClick={() => {
                setTarget(p.key);
                setConfirming(false);
              }}
            >
              <span className="cc-tracker-ops-position-label">{p.label}</span>
              <span className="cc-tracker-ops-sub">{p.detail}</span>
            </button>
          ))}
        </div>

        {target !== "legacy" && (
          <div className="cc-tracker-ops-rollout">
            <fieldset className="cc-tracker-ops-fieldset">
              <legend className="cc-tracker-ops-label">Agencies on the new reader (none ticked = every agency)</legend>
              {report.orgs.map((o) => (
                <label key={o.id} className="cc-tracker-ops-check">
                  <input
                    type="checkbox"
                    checked={scope.includes(o.id)}
                    onChange={(e) => setScope((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))}
                  />
                  {o.name} <span className="cc-tracker-ops-sub">· {NUM.format(o.tracked)} tracked</span>
                </label>
              ))}
            </fieldset>
            <label className="cc-tracker-ops-check">
              Share of their creators
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={percent}
                onChange={(e) => setPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="cc-tracker-ops-input"
                aria-label="Share of creators, percent"
              />
              %
            </label>
          </div>
        )}

        <label className="cc-tracker-ops-check cc-tracker-ops-note">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} className="cc-tracker-ops-input" placeholder="Why (kept in the log)" />
        </label>

        {!confirming ? (
          <button type="button" className="cc-tracker-ops-primary" disabled={unchanged || busy} onClick={() => setConfirming(true)}>
            Review switch
          </button>
        ) : (
          <div className="cc-tracker-ops-confirm" role="alertdialog" aria-label="Confirm switch">
            <p>
              Switch creator tracker reads to <b>{POSITIONS.find((p) => p.key === target)?.label}</b>
              {target !== "legacy" && ` for ${scope.length ? scope.map(orgName).join(", ") : "every agency"} at ${percent}%`}?
            </p>
            {target === "B" && (
              <p className="cc-tracker-ops-sub">
                B&rsquo;s last daily check:{" "}
                {b.lastCheck ? (
                  <>
                    <Tone ok={b.lastCheck.ok}>{b.lastCheck.ok ? "passed" : "failed"}</Tone> {ago(b.lastCheck.at as unknown as string)}
                  </>
                ) : (
                  "none on record"
                )}
                {bBlocked && <> · <Tone ok={false}>{b.reason ?? "worker not configured here"}</Tone></>}
              </p>
            )}
            <div className="cc-tracker-ops-actions">
              <button type="button" className="cc-tracker-ops-secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="cc-tracker-ops-primary" onClick={apply} disabled={busy || bBlocked}>
                {busy ? "Switching…" : "Confirm switch"}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="cc-tracker-ops-error">
            {error}
          </p>
        )}
      </section>

      <section className="cc-tracker-ops-section" aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="cc-tracker-ops-h2">Recent runs and checks</h2>
        <div className="cc-tracker-ops-table-wrap" tabIndex={0} role="region" aria-labelledby="runs-heading">
          <table className="cc-tracker-ops-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Plan</th>
                <th scope="col">Kind</th>
                <th scope="col">Reads</th>
                <th scope="col">Answered</th>
                <th scope="col">Walls</th>
                <th scope="col">Median</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.recent.length === 0 ? (
                <tr>
                  <td colSpan={8} className="cc-tracker-ops-sub">
                    No runs yet. Reader v2 runs hourly once the switch says A or B; Plan B&rsquo;s worker reports its daily check here.
                  </td>
                </tr>
              ) : (
                report.recent.map((r, i) => (
                  <tr key={`${r.startedAt}-${i}`}>
                    <td>{ago(r.startedAt)}</td>
                    <td>{r.plan}</td>
                    <td>{r.kind}</td>
                    <td>{NUM.format(r.reads)}</td>
                    <td>{pct(r.proper, r.reads)}</td>
                    <td>{NUM.format(r.walls)}</td>
                    <td>{r.medianMs === null ? "—" : `${(r.medianMs / 1000).toFixed(2)} s`}</td>
                    <td>
                      <Tone ok={r.ok}>{r.ok ? "ok" : "below bar"}</Tone>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cc-tracker-ops-section" aria-labelledby="log-heading">
        <h2 id="log-heading" className="cc-tracker-ops-h2">Switch log</h2>
        {report.switchLog.length === 0 ? (
          <p className="cc-tracker-ops-sub">The switch has never moved. It ships on Legacy.</p>
        ) : (
          <ul className="cc-tracker-ops-log">
            {report.switchLog.map((l, i) => (
              <li key={`${l.changedAt}-${i}`}>
                {ago(l.changedAt)} · {l.fromPosition ?? "—"} → <b>{l.toPosition}</b>
                {l.toPosition !== "legacy" && ` (${l.scopeOrgIds.length ? l.scopeOrgIds.map(orgName).join(", ") : "every agency"}, ${l.percent}%)`} ·{" "}
                {l.changedBy ?? "unknown"}
                {l.note && ` · ${l.note}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
