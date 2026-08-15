"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Button, Input } from "@pratham7711/ui";

function Shell({ children }: { children: React.ReactNode }) {
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 40 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--cc-primary)" strokeWidth="2.5" />
            <circle cx="12" cy="12" r="5.5" stroke="var(--cc-primary)" strokeWidth="2" />
            <circle cx="12" cy="12" r="2" fill="var(--cc-primary)" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: 20, color: "var(--cc-text)", letterSpacing: "-0.5px" }}>
            {BRAND.name}
          </span>
        </div>
        <div
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 24,
            boxShadow: "var(--ui-shadow-lg)",
            padding: 40,
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function BackToSignIn({ muted }: { muted?: boolean }) {
  return (
    <div style={{ marginTop: 24, textAlign: "center" }}>
      <Link
        href="/login"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: muted ? "var(--cc-text-muted)" : "var(--cc-primary)",
          fontSize: 14,
          fontWeight: muted ? 500 : 600,
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={16} />
        Back to sign in
      </Link>
    </div>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          Reset link missing
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
          This page needs the link from your reset email. Request a new one and try again.
        </p>
        <div style={{ marginTop: 24 }}>
          <Link href="/forgot-password" style={{ textDecoration: "none" }}>
            <Button variant="primary" fullWidth>
              Request a new link
            </Button>
          </Link>
        </div>
        <BackToSignIn muted />
      </>
    );
  }

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ textAlign: "center", padding: "16px 0" }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--cc-primary-light)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <CheckCircle2 size={24} color="var(--cc-primary)" strokeWidth={2} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
          Password updated
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 32 }}>
          You can sign in with your new password now.
        </p>
        <Link href="/login" style={{ textDecoration: "none" }}>
          <Button variant="primary" fullWidth>
            Go to sign in
          </Button>
        </Link>
      </motion.div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Could not reset the password");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--cc-primary-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <KeyRound size={24} color="var(--cc-primary)" strokeWidth={2} />
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
        Choose a new password
      </h1>
      <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
        At least 8 characters. You will use this to sign in.
      </p>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          required
        />
        {error && (
          <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger, #DC2626)", margin: 0 }}>
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" fullWidth disabled={busy} style={{ marginTop: 4 }}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>

      <BackToSignIn muted />
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>Loading…</p>
        </Shell>
      }
    >
      <Shell>
        <ResetPasswordForm />
      </Shell>
    </Suspense>
  );
}
