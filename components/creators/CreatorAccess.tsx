"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Skeleton } from "@pratham7711/ui";
import { formatDateAbs, platformLabel } from "@/lib/format";
import type { AccessEntry, AccessStatus } from "@/lib/creators/grantAccess";

/**
 * "Access": what this agency may read for one creator, per platform (plan K4).
 *
 * One line per grant: when it was given, what it covers, and whether it still
 * stands. It is the agency's own record — another agency's grant for the same
 * person is never shown here and never read through. Wraps to one column at
 * phone width; colours come from the Badge variants and the --cc-* tokens.
 */

const STATUS: Record<AccessStatus, { label: string; variant: "success" | "warning" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  reconnect_needed: { label: "Reconnect needed", variant: "warning" },
  revoked: { label: "Revoked", variant: "danger" },
};

const REASONS: Record<string, string> = {
  disconnect: "The creator disconnected",
  agency_removed: "Removed by your team",
  meta_deauthorize: "Removed in Meta's settings",
  meta_data_deletion: "Data deletion requested via Meta",
  tiktok_authorization_removed: "Removed in TikTok's settings",
  invalid_grant: "Google ended the authorisation",
  account_deleted: "The creator deleted their login",
  superseded: "Replaced by a newer consent",
  connection_removed: "The connection no longer exists",
};

const SOURCES: Record<string, string> = {
  "connect-link": "via your connect link",
  portal: "in the creator app",
  dev: "dev connect",
  backfill: "recorded from an earlier connection",
};

export default function CreatorAccess({ creatorId }: { creatorId: string }) {
  const [entries, setEntries] = useState<AccessEntry[] | null>(null);
  const [tracked, setTracked] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/creators/${creatorId}/grants`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { tracked: boolean; entries: AccessEntry[] }) => {
        if (!live) return;
        setTracked(body.tracked);
        setEntries(body.entries);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [creatorId]);

  return (
    <section aria-labelledby="creator-access-heading" style={{ marginTop: 32 }}>
      <h2
        id="creator-access-heading"
        style={{ fontWeight: "var(--cc-fw-strong)", fontSize: "var(--cc-t-16)", color: "var(--cc-text)", marginBottom: 4 }}
      >
        Access
      </h2>
      <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginBottom: 12 }}>
        What this creator has allowed your workspace to read from their own accounts.
      </p>

      {failed ? (
        <p role="status" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
          Access could not be loaded. Reload to try again.
        </p>
      ) : entries === null ? (
        <Skeleton height="64px" borderRadius="12px" />
      ) : !tracked ? (
        <p role="status" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
          Consent records are not switched on for this workspace yet.
        </p>
      ) : entries.length === 0 ? (
        <p role="status" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
          No access granted. Send the creator a connect link to ask for it.
        </p>
      ) : (
        <Card variant="outlined" style={{ padding: 0, overflow: "hidden" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {entries.map((e, i) => (
              <AccessRow key={e.id} entry={e} first={i === 0} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function AccessRow({ entry, first }: { entry: AccessEntry; first: boolean }) {
  const status = STATUS[entry.status];
  const reason = entry.revokeReason ? REASONS[entry.revokeReason] ?? entry.revokeReason : null;
  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
        padding: "12px 16px",
        borderTop: first ? "none" : "1px solid var(--cc-border)",
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
        <div style={{ fontWeight: "var(--cc-fw-strong)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>
          {platformLabel(entry.platform)}
        </div>
        <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 2 }}>
          Granted {formatDateAbs(entry.grantedAt)}
          {SOURCES[entry.source] ? ` ${SOURCES[entry.source]}` : ""}
          {entry.revokedAt ? ` · ended ${formatDateAbs(entry.revokedAt)}` : ""}
          {reason ? ` · ${reason}` : ""}
        </div>
        <Scopes entry={entry} />
      </div>
      <Badge variant={status.variant} size="sm">
        {status.label}
      </Badge>
    </li>
  );
}

function Scopes({ entry }: { entry: AccessEntry }) {
  if (entry.scopes.length === 0) {
    return (
      <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", marginTop: 6 }}>
        Scopes not recorded
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      <ul
        aria-label={entry.scopesSource === "requested" ? "Scopes requested" : "Scopes granted"}
        style={{ display: "flex", flexWrap: "wrap", gap: 4, listStyle: "none", margin: 0, padding: 0 }}
      >
        {entry.scopes.map((s) => (
          <li
            key={s}
            style={{
              fontSize: "var(--cc-t-11)",
              color: "var(--cc-text-muted)",
              border: "1px solid var(--cc-border)",
              borderRadius: "var(--cc-r-pill)",
              padding: "1px 8px",
              maxWidth: "100%",
              overflowWrap: "anywhere",
            }}
          >
            {s}
          </li>
        ))}
      </ul>
      {entry.scopesSource === "requested" && (
        <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)", marginTop: 4 }}>
          As requested; this platform does not report which were granted.
        </div>
      )}
    </div>
  );
}
