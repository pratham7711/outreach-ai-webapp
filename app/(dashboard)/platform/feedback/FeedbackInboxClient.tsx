"use client";

import { useState } from "react";
import { Button, PageHeader, StatusTabs } from "@/components/ds";
import { formatDateAbs } from "@/lib/format";
import type { Inbox, InboxFilter, InboxRow } from "@/lib/feedback/inbox";
import type { FeedbackContext } from "@/lib/feedback/submission";

const SURFACE: Record<string, string> = {
  dashboard: "Agency app",
  portal: "Creator portal",
  share: "Client share link",
  list: "Client list link",
};

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function sender(row: InboxRow): string {
  if (row.creatorName || row.creatorEmail) {
    return `Creator ${[row.creatorName, row.creatorEmail && `(${row.creatorEmail})`].filter(Boolean).join(" ")}`;
  }
  if (row.userEmail) return `${row.userEmail}${row.orgName ? ` · ${row.orgName}` : ""}`;
  if (row.fromLink) return row.orgName ? `Someone with ${row.orgName}'s link` : "Someone with a shared link";
  return row.orgName ?? "Unknown sender";
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function Details({ context }: { context: unknown }) {
  const c = (context ?? {}) as Partial<FeedbackContext> & {
    build?: { deployment?: string | null; commit?: string | null };
    actingAs?: boolean;
  };
  const errors = c.errors ?? [];
  const failed = c.failedRequests ?? [];
  const facts = [
    c.viewport?.w ? `Window ${c.viewport.w}×${c.viewport.h} @${c.viewport.dpr}x` : null,
    c.screen?.w ? `Screen ${c.screen.w}×${c.screen.h}` : null,
    c.theme ? `Theme ${c.theme}` : null,
    c.timeZone ?? null,
    c.language ?? null,
    c.online === false ? "Offline" : null,
    c.actingAs ? "Operator acting as a user" : null,
    c.build?.commit ? `Build ${c.build.commit}` : null,
  ].filter(Boolean);
  return (
    <details className="cc-feedback-inbox-details">
      <summary>
        Details{errors.length ? ` · ${errors.length} page error${errors.length === 1 ? "" : "s"}` : ""}
        {failed.length ? ` · ${failed.length} failed request${failed.length === 1 ? "" : "s"}` : ""}
      </summary>
      <p>{facts.join(" · ")}</p>
      {c.userAgent && <p className="cc-feedback-inbox-mono">{c.userAgent}</p>}
      {errors.length > 0 && (
        <>
          <h4>Page errors</h4>
          <ul>
            {errors.map((e, i) => (
              <li key={i} className="cc-feedback-inbox-mono">
                {e.at ? new Date(e.at).toLocaleTimeString() : ""} [{e.kind}] {e.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {failed.length > 0 && (
        <>
          <h4>Failed requests</h4>
          <ul>
            {failed.map((r, i) => (
              <li key={i} className="cc-feedback-inbox-mono">
                {r.status} {r.path} ({r.durationMs} ms)
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

export default function FeedbackInboxClient({ initial }: { initial: Inbox }) {
  const [inbox, setInbox] = useState(initial);
  const [filter, setFilter] = useState<InboxFilter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(next: InboxFilter) {
    setFilter(next);
    setError(null);
    const res = await fetch(`/api/platform/feedback?status=${next}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Couldn't load feedback.");
      return;
    }
    setInbox(await res.json());
  }

  async function setResolved(row: InboxRow, resolved: boolean) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch("/api/platform/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, resolved }),
      });
      if (!res.ok) {
        setError("Couldn't update that feedback.");
        return;
      }
      await load(filter);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rsp-page cc-feedback-inbox">
      <PageHeader
        title="Feedback"
        subtitle="What clients, agency users and creators sent with the Feedback button, each with a screenshot of the page they were on."
      />

      <StatusTabs
        ariaLabel="Feedback status"
        active={filter}
        onChange={(k) => load(k as InboxFilter)}
        tabs={[
          { key: "open", label: "Open", count: inbox.open },
          { key: "resolved", label: "Resolved" },
          { key: "all", label: "All" },
        ]}
      />

      {error && (
        <p role="alert" className="cc-feedback-error" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {!inbox.ready ? (
        <p className="cc-feedback-inbox-empty">
          The feedback table does not exist on this database yet, so nothing can be received. Apply it with
          /api/admin/migrate-feedback.
        </p>
      ) : inbox.rows.length === 0 ? (
        <p className="cc-feedback-inbox-empty">
          {filter === "open" ? "No open feedback." : filter === "resolved" ? "Nothing resolved yet." : "No feedback yet."}
        </p>
      ) : (
        <ul className="cc-feedback-inbox-list">
          {inbox.rows.map((row) => (
            <li key={row.id} className="cc-feedback-inbox-item" data-testid="feedback-row">
              <div className="cc-feedback-inbox-thumb">
                {row.hasScreenshot ? (
                  <a href={`/api/platform/feedback/${row.id}/screenshot`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private, operator-only image */}
                    <img src={`/api/platform/feedback/${row.id}/screenshot`} alt="Screenshot sent with this feedback" loading="lazy" />
                  </a>
                ) : (
                  <span>No screenshot{row.screenshotError ? `: ${row.screenshotError}` : ""}</span>
                )}
              </div>
              <div className="cc-feedback-inbox-body">
                <div className="cc-feedback-inbox-meta">
                  <strong>{sender(row)}</strong>
                  <span title={formatDateAbs(row.createdAt)}>{ago(row.createdAt)}</span>
                  <span>{SURFACE[row.surface] ?? row.surface}</span>
                  {row.resolvedAt && (
                    <span>
                      Resolved {formatDateAbs(row.resolvedAt)}
                      {row.resolvedBy ? ` by ${row.resolvedBy}` : ""}
                    </span>
                  )}
                </div>
                <p className={row.message ? "cc-feedback-inbox-message" : "cc-feedback-inbox-message cc-feedback-inbox-muted"}>
                  {row.message ?? "No message — screenshot only."}
                </p>
                <a className="cc-feedback-inbox-page" href={row.pageUrl} target="_blank" rel="noreferrer">
                  {row.pageTitle ? `${row.pageTitle} — ` : ""}
                  {pagePath(row.pageUrl)}
                </a>
                <Details context={row.context} />
              </div>
              <div className="cc-feedback-inbox-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busyId === row.id}
                  onClick={() => setResolved(row, !row.resolvedAt)}
                >
                  {row.resolvedAt ? "Reopen" : "Mark resolved"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
