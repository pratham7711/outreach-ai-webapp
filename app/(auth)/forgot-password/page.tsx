"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Mail, MailWarning } from "lucide-react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  /* "unavailable" means the server has no email provider, so no link went out.
     Saying "check your email" in that case is worse than saying nothing. */
  const [delivery, setDelivery] = useState<"sent" | "unavailable">("sent");
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
      setDelivery(json?.delivery === "unavailable" ? "unavailable" : "sent");
      setSent(true);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
        background: "var(--cc-bg)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: 400 }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 40 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--cc-primary)" strokeWidth="2.5"/>
            <circle cx="12" cy="12" r="5.5" stroke="var(--cc-primary)" strokeWidth="2"/>
            <circle cx="12" cy="12" r="2" fill="var(--cc-primary)"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 20, color: "var(--cc-text)", letterSpacing: "-0.5px" }}>
            {BRAND.name}
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 24,
            boxShadow: "var(--ui-shadow-lg)",
            padding: 40,
          }}
        >
          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ textAlign: "center", padding: "16px 0" }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "var(--cc-primary-light)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px",
              }}>
                {delivery === "unavailable" ? (
                  <MailWarning size={24} color="var(--cc-primary)" strokeWidth={2} />
                ) : (
                  <Mail size={24} color="var(--cc-primary)" strokeWidth={2} />
                )}
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
                {delivery === "unavailable" ? "We can't email you yet" : "Check your email"}
              </h1>
              {delivery === "unavailable" ? (
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 32 }}>
                  Your reset link was created, but this workspace has no email
                  provider set up, so we could not send it. Ask whoever
                  administers{" "}
                  <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{BRAND.name}</span>{" "}
                  to send you the link, or to finish setting up email.
                </p>
              ) : (
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 32 }}>
                  We sent a reset link to{" "}
                  <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{email}</span>
                </p>
              )}
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
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Reset your password</h1>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
                Enter your email and we&apos;ll send you a reset link
              </p>

              <form
                onSubmit={requestReset}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />

                {error && (
                  <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger, #DC2626)", margin: 0 }}>
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
        </div>
      </motion.div>
    </div>
  );
}
