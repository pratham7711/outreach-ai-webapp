"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8">
      <h2>Something went wrong</h2>
      <p style={{ opacity: 0.6, marginTop: 8 }}>
        {error.digest ? `Error: ${error.digest}` : "An unexpected error occurred."}
      </p>
      <button onClick={reset} style={{ marginTop: 16 }}>
        Try again
      </button>
    </div>
  );
}
