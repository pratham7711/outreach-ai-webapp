"use client";

import { Card, Button } from "@pratham7711/ui";
import { motion } from "framer-motion";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: 24,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{ width: "100%", maxWidth: 480 }}
      >
        <Card variant="solid" style={{ padding: 40, textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "rgba(239, 68, 68, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <AlertTriangle size={28} style={{ color: "#DC2626" }} />
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--cc-text)",
              marginBottom: 8,
              letterSpacing: "-0.01em",
            }}
          >
            Something went wrong
          </h2>

          <p
            style={{
              fontSize: 14,
              color: "var(--cc-text-muted)",
              lineHeight: 1.6,
              marginBottom: 8,
            }}
          >
            An unexpected error occurred while loading this page.
          </p>

          {error.digest && (
            <p
              style={{
                fontSize: 12,
                color: "var(--cc-text-subtle)",
                fontFamily: "monospace",
                marginBottom: 24,
              }}
            >
              Error ID: {error.digest}
            </p>
          )}

          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <Button
              variant="primary"
              iconLeft={<RotateCcw size={15} />}
              onClick={reset}
            >
              Try again
            </Button>
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <Button variant="secondary" iconLeft={<Home size={15} />}>
                Go to Dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
