"use client";

import React, { useEffect, useState } from "react";
import { MailWarning, X } from "lucide-react";
import { Banner } from "@/components/ds/Banner";

/**
 * The only in-app route back to a confirmation mail that was missed.
 *
 * Without it the link in the signup email is the single copy: it lands in spam
 * or expires overnight, and the account is left unverifiable from inside the
 * product. The address is passed in from the server rather than typed, so this
 * cannot be used to aim mail at anybody else.
 */
const DISMISSED_KEY = "cc-verify-banner-dismissed";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "unavailable">("idle");
  /* One line, closable for the rest of the browser session: it sat on every
     page at 40px, 115px on a phone. It comes back on the next visit until the
     address is confirmed. */
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only
    if (sessionStorage.getItem(DISMISSED_KEY) === email) setDismissed(true);
  }, [email]);
  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, email);
    setDismissed(true);
  };
  if (dismissed) return null;

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
    <Banner
      placement="shell"
      tone="warning"
      icon={<MailWarning aria-hidden="true" />}
      action={
        state === "sent" ? (
          <span className="cc-banner-title">Sent — check your inbox.</span>
        ) : state === "unavailable" ? (
          <span className="cc-banner-title">Could not send right now. Try again shortly.</span>
        ) : (
          <span className="cc-verify-banner-actions">
            <button type="button" className="cc-verify-banner-link" onClick={resend} disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Resend link"}
            </button>
            <button type="button" className="cc-verify-banner-close" onClick={dismiss} aria-label="Hide until next visit">
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        )
      }
      className="cc-verify-banner"
    >
      Confirm <strong className="cc-verify-banner-email">{email}</strong>
      <span className="cc-verify-banner-tail"> so we know this address reaches you.</span>
    </Banner>
  );
}
