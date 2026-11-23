"use client";

import { useState } from "react";
import { Button } from "@/components/ds";
import { AuthNotice } from "@/components/auth/AuthShell";
import type { AuthErrand } from "@/lib/portal/afterAuth";

/**
 * The body of "Check your email" on portal sign-up and sign-in: the account
 * opens only from the link mailed to the address (lib/portal/creatorEmailVerification.ts).
 * `devVerifyUrl` is returned by the API outside production when no mail
 * provider is configured, so the flow can be walked locally.
 */
export function CheckEmail({ email, errand, devVerifyUrl }: { email: string; errand: AuthErrand; devVerifyUrl?: string | null }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [devUrl, setDevUrl] = useState(devVerifyUrl ?? null);

  const resend = async () => {
    setState("sending");
    try {
      const res = await fetch("/api/portal/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, errand }),
      });
      const data = (await res.json().catch(() => ({}))) as { devVerifyUrl?: string };
      if (data.devVerifyUrl) setDevUrl(data.devVerifyUrl);
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  };

  return (
    <div data-testid="check-email" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14, color: "var(--cc-text)" }}>
        We sent a link to <strong>{email}</strong>. Open it to finish. It works for 24 hours.
      </p>
      {state === "sent" && <AuthNotice tone="success">A new link is on its way.</AuthNotice>}
      {state === "failed" && <AuthNotice tone="danger">Couldn&rsquo;t send a new link. Try again in a minute.</AuthNotice>}
      <Button variant="secondary" fullWidth onClick={resend} loading={state === "sending"}>
        Send a new link
      </Button>
      {devUrl && (
        <a href={devUrl} data-testid="dev-verify-link" style={{ fontSize: 12, color: "var(--cc-text-muted)", wordBreak: "break-all" }}>
          Dev only, no mail provider: open the link
        </a>
      )}
    </div>
  );
}
