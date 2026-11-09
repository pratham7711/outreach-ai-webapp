"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, MailWarning, MailCheck } from "lucide-react";
import Link from "next/link";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Field } from "@/components/ds/Field";
import { AuthFrame } from "@/components/auth/AuthShell";

function Shell({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
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

function Badge({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: tone === "ok" ? "var(--cc-primary-light)" : "var(--cc-warning-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 0 16px",
      }}
    >
      {children}
    </div>
  );
}

type State =
  | { kind: "working" }
  | { kind: "done"; already: boolean }
  | { kind: "failed"; message: string; expired: boolean }
  | { kind: "no-token" };

function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<State>(token ? { kind: "working" } : { kind: "no-token" });

  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState<null | "sent" | "unavailable">(null);

  /* Guards the double invocation React StrictMode performs in development.
     Without it the first call spends the token and the second is told the link
     is not valid -- so a perfectly good confirmation renders as a failure, in
     dev only, which is a maddening thing to debug. */
  const spent = useRef(false);

  const submit = useCallback(async () => {
    if (!token || spent.current) return;
    spent.current = true;
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setState({
          kind: "failed",
          message: json?.error ?? "This confirmation link is not valid",
          expired: Boolean(json?.expired),
        });
        return;
      }
      setState({ kind: "done", already: Boolean(json?.alreadyVerified) });
    } catch {
      setState({ kind: "failed", message: "Could not reach the server", expired: false });
    }
  }, [token]);

  useEffect(() => {
    void submit();
  }, [submit]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setResending(true);
    setResent(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => null);
      setResent(json?.delivery === "unavailable" ? "unavailable" : "sent");
    } catch {
      setResent("unavailable");
    } finally {
      setResending(false);
    }
  }

  if (state.kind === "working") {
    return (
      <div className="cc-auth__state">
        <h1 className="cc-auth__title">
          Confirming your email…
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>One moment.</p>
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="cc-auth__state">
        <Badge tone="ok">
          <CheckCircle2 size={24} color="var(--cc-primary)" strokeWidth={2} />
        </Badge>
        <h1 className="cc-auth__title">
          {state.already ? "Already confirmed" : "Email confirmed"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 32 }}>
          {state.already
            ? "This address was confirmed earlier. Nothing more to do."
            : "Thanks — we know this address reaches you."}
        </p>
        <Link href="/login" style={{ textDecoration: "none" }}>
          <Button variant="primary" fullWidth>
            Go to sign in
          </Button>
        </Link>
      </motion.div>
    );
  }

  const heading = state.kind === "no-token" ? "Confirmation link missing" : state.message;
  const blurb =
    state.kind === "no-token"
      ? "This page needs the link from your confirmation email."
      : state.expired
        ? "Links last 24 hours. Enter your email and we will send a fresh one."
        : "Enter your email and we will send a fresh confirmation link.";

  return (
    <>
      <Badge tone="warn">
        <MailWarning size={24} color="var(--cc-warning-solid)" strokeWidth={2} />
      </Badge>
      <h1 className="cc-auth__title">
        {heading}
      </h1>
      <p className="cc-auth__sub">{blurb}</p>

      {resent ? (
        <div style={{ textAlign: "center" }}>
          <Badge tone="ok">
            <MailCheck size={24} color="var(--cc-primary)" strokeWidth={2} />
          </Badge>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
            {resent === "sent"
              ? "If that address has an account awaiting confirmation, a new link is on its way."
              : "Email is not configured on this server, so no link could be sent. Ask an administrator."}
          </p>
        </div>
      ) : (
        <form onSubmit={resend} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>
          <Button type="submit" variant="primary" fullWidth disabled={resending}>
            {resending ? "Sending…" : "Send a new link"}
          </Button>
        </form>
      )}

      <BackToSignIn muted />
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>Loading…</p>
        </Shell>
      }
    >
      <Shell>
        <VerifyEmail />
      </Shell>
    </Suspense>
  );
}
