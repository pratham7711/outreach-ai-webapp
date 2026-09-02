"use client";

import React, { useState } from "react";
import { MailWarning } from "lucide-react";

/**
 * The only in-app route back to a confirmation mail that was missed.
 *
 * Without it the link in the signup email is the single copy: it lands in spam
 * or expires overnight, and the account is left unverifiable from inside the
 * product. The address is passed in from the server rather than typed, so this
 * cannot be used to aim mail at anybody else.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "unavailable">("idle");

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => null);
      /* 429 included: the mail is rate limited per caller, and telling someone
         who just pressed it twice that sending "failed" would send them to
         support over a limit that is working as intended. */
      setState(res.ok && json?.delivery !== "unavailable" ? "sent" : "unavailable");
    } catch {
      setState("unavailable");
    }
  }

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 20px",
        background: "#FEF3C7",
        borderBottom: "1px solid var(--cc-border)",
        fontSize: 13,
        color: "#92400E",
      }}
    >
      <MailWarning size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span>
        Confirm <strong>{email}</strong> so we know this address reaches you.
      </span>
      {state === "sent" ? (
        <span style={{ fontWeight: 600 }}>Sent — check your inbox.</span>
      ) : state === "unavailable" ? (
        <span style={{ fontWeight: 600 }}>Could not send right now. Try again shortly.</span>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={state === "sending"}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            fontWeight: 600,
            color: "#92400E",
            textDecoration: "underline",
            cursor: state === "sending" ? "default" : "pointer",
          }}
        >
          {state === "sending" ? "Sending…" : "Resend the link"}
        </button>
      )}
    </div>
  );
}
