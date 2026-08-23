"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * The card an error boundary shows.
 *
 * Deliberately the same shape as the share report's "Link unavailable" state:
 * someone who reaches either one is looking at the same kind of dead end, and
 * two different treatments for that would read as two different products.
 *
 * Inline styles and one icon package, nothing else. A boundary that imports the
 * component library cannot render the one time the library is what threw.
 */
export function ErrorCard({
  title,
  message,
  digest,
  onRetry,
  action,
}: {
  title: string;
  message: string;
  /** Next's error digest. Worth showing: it is the only handle on a server-side throw. */
  digest?: string;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--cc-bg)",
      }}
    >
      <div
        style={{
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 16,
          padding: "48px 32px",
          maxWidth: 420,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "rgba(220, 38, 38, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <AlertTriangle size={26} color="#DC2626" />
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>
          {title}
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
          {message}
        </p>

        {digest && (
          <p
            style={{
              fontSize: 12,
              color: "var(--cc-text-subtle)",
              fontFamily: "ui-monospace, monospace",
              margin: "16px 0 0",
            }}
          >
            Error ID: {digest}
          </p>
        )}

        {(onRetry || action) && (
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginTop: 24,
              flexWrap: "wrap",
            }}
          >
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--cc-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <RotateCcw size={15} />
                Try again
              </button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
