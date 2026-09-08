"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./Button";

/**
 * "We could not load this", as distinct from "there is nothing here".
 *
 * Three surfaces were collapsing the two: /discovery had no catch at all, so a
 * failed fetch left its skeletons spinning for ever; /calendar used `.finally`
 * with no `.catch`, so a failure printed "Nothing scheduled this month"; and
 * the audit log did `if (!res.ok) return`, which renders as an empty log. All
 * three are the same lie — an outage shown as a fact about the org's data —
 * and the person reading it has no reason to retry or report anything.
 *
 * So: says it failed, says nothing about how much data there is, and offers
 * the one action that might work.
 */
export function LoadError({
  title = "We couldn't load this",
  description = "Something went wrong on our side. Nothing here is missing — we just could not read it.",
  onRetry,
  retrying = false,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderLeft: "3px solid var(--cc-danger)",
        borderRadius: 12,
        padding: 24,
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <AlertTriangle size={20} color="var(--cc-danger)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)", margin: "0 0 4px" }}>{title}</p>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "0 0 14px" }}>{description}</p>
        <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry} iconLeft={<RotateCw size={14} />}>
          Try again
        </Button>
      </div>
    </div>
  );
}
