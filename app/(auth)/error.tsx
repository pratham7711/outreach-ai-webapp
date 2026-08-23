"use client";

import Link from "next/link";
import { ErrorCard } from "@/components/ui/ErrorCard";

/**
 * Sign-in, sign-up and both password pages. A throw here used to leave someone
 * who cannot get into the app with no way to try again either.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorCard
      title="Sign-in isn't available right now"
      message="Something on our side failed. Try again in a moment — your account is unaffected."
      digest={error.digest}
      onRetry={reset}
      action={
        <Link
          href="/login"
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
          Back to sign in
        </Link>
      }
    />
  );
}
