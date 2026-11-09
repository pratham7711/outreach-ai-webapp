"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Field } from "@/components/ds/Field";
import { AuthFrame } from "@/components/auth/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Could not send the reset link");
        return;
      }
      setSent(true);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="cc-auth__state"
            >
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "var(--cc-primary-light)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 0 16px",
              }}>
                <Mail size={24} color="var(--cc-primary)" strokeWidth={2} />
              </div>
              <h1 className="cc-auth__title">
                Check your email
              </h1>
              {/* The server answers the same for every address, registered or
                  not, and does not say whether it can send mail, so this states
                  only what is true in every case and who to ask otherwise. */}
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 32 }}>
                If an account exists for{" "}
                <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{email}</span>, a reset
                link is on its way and works for one hour. Nothing after a few minutes? Check
                spam, then ask whoever administers{" "}
                <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{BRAND.name}</span>{" "}
                for your workspace.
              </p>
              <Link
                href="/login"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  color: "var(--cc-primary)", fontSize: 14, fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                <ArrowLeft size={16} />
                Back to sign in
              </Link>
            </motion.div>
          ) : (
            <>
              <h1 className="cc-auth__title">Reset your password</h1>
              <p className="cc-auth__sub">
                Enter your email and we&apos;ll send you a reset link
              </p>

              <form
                onSubmit={requestReset}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <Field label="Email" required>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </Field>

                {error && (
                  <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: 0 }}>
                    {error}
                  </p>
                )}

                <Button type="submit" variant="primary" fullWidth disabled={busy} style={{ marginTop: 4 }}>
                  {busy ? "Sending…" : "Send reset link"}
                </Button>
              </form>

              <div style={{ marginTop: 24, textAlign: "center" }}>
                <Link
                  href="/login"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    color: "var(--cc-text-muted)", fontSize: 14, fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <ArrowLeft size={16} />
                  Back to sign in
                </Link>
              </div>
            </>
          )}
    </AuthFrame>
  );
}
