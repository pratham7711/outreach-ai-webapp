"use client";

import { RotateCw } from "lucide-react";
import { Banner } from "./Banner";
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
 * the one action that might work. Drawn as the shared danger Banner (a tinted
 * ground and a hairline in the tone, the action at the right), not a card with
 * a thick coloured stripe down its left edge.
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
    <Banner
      tone="danger"
      role="alert"
      title={title}
      action={
        <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry} iconLeft={<RotateCw size={14} />}>
          Try again
        </Button>
      }
    >
      {description}
    </Banner>
  );
}
