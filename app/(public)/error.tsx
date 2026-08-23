"use client";

import { ErrorCard } from "@/components/ui/ErrorCard";

/**
 * The public group had no error boundary, which meant a throw anywhere in a
 * campaign share report -- the link a label sends its client -- rendered Next's
 * own error screen to that client.
 *
 * No route back into the app, unlike the dashboard's boundary: whoever is
 * reading this followed a link and has no account here, so "Go to Dashboard"
 * would be a dead end wearing a button.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorCard
      title="This page didn't load"
      message="Something on our side failed while building it. Reloading usually works — if it keeps failing, send the error ID below to whoever shared this link."
      digest={error.digest}
      onRetry={reset}
    />
  );
}
