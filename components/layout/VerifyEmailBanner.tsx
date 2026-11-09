"use client";

import React, { useState } from "react";
import { MailWarning } from "lucide-react";
import { Banner } from "@/components/ds/Banner";
import { Button } from "@/components/ds/Button";

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
          <Button variant="secondary" size="sm" onClick={resend} disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Resend the link"}
          </Button>
        )
      }
    >
      Confirm <strong>{email}</strong> so we know this address reaches you.
    </Banner>
  );
}
