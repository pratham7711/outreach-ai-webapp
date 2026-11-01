"use client";

import { memo } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import type { PostAnnotationView } from "@/lib/posts/annotations";
import { formatDateAbs } from "@/lib/format";

/**
 * What the agency should know about a post beyond its numbers: rules that
 * could not be checked when the creator submitted it, the boost code the
 * creator gave (one click to copy, which is all it is for), and, under
 * Removed, why it was excluded. Nothing renders for a post with none.
 *
 * `nowMs` comes from the caller so the render stays pure.
 */
function PostAnnotationChipsImpl({
  annotation,
  removed,
  nowMs,
  tile = false,
}: {
  annotation: PostAnnotationView | undefined;
  removed: boolean;
  nowMs: number;
  tile?: boolean;
}) {
  if (!annotation) return null;
  const { boostCode, boostCodeExpiresAt, ruleNotes, exclusionReason } = annotation;
  const showReason = removed && !!exclusionReason;
  if (!boostCode && ruleNotes.length === 0 && !showReason) return null;

  const expiresMs = boostCodeExpiresAt ? new Date(boostCodeExpiresAt).getTime() : null;
  const expired = expiresMs !== null && expiresMs < nowMs;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(boostCode ?? "");
      toast.success("Boost code copied");
    } catch {
      toast.error(`Couldn't copy. The code is ${boostCode}`);
    }
  };

  return (
    <div className={tile ? "cc-post-notes cc-post-notes--tile" : "cc-post-notes"} data-testid="post-annotations">
      {showReason && (
        <span className="cc-post-note cc-post-note--reason" title={exclusionReason ?? undefined}>
          Excluded: {exclusionReason}
        </span>
      )}
      {ruleNotes.map((n) => (
        <span key={n} className="cc-post-note" title="Not checked when the creator submitted this post">
          {n}
        </span>
      ))}
      {boostCode && (
        <button
          type="button"
          className="cc-post-note cc-post-note--action"
          data-expired={expired ? "1" : undefined}
          onClick={copy}
          title={`Boost code: ${boostCode}`}
        >
          <Copy size={12} aria-hidden="true" />
          {expired
            ? `Boost code expired ${formatDateAbs(boostCodeExpiresAt)}`
            : boostCodeExpiresAt
              ? `Copy boost code · until ${formatDateAbs(boostCodeExpiresAt)}`
              : "Copy boost code"}
        </button>
      )}
    </div>
  );
}

export const PostAnnotationChips = memo(PostAnnotationChipsImpl);
