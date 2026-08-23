"use client";

import Link from "next/link";
import { ErrorCard } from "@/components/ui/ErrorCard";

/** The creator portal's 13 pages had no boundary of their own. */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorCard
      title="This page didn't load"
      message="Something on our side failed while building it. Try again, or head back to your dashboard."
      digest={error.digest}
      onRetry={reset}
      action={
        <Link
          href="/portal/dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            background: "var(--cc-card)",
            color: "var(--cc-text)",
            border: "1px solid var(--cc-border)",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          My dashboard
        </Link>
      }
    />
  );
}
