"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";

type Phase = "idle" | "accepting" | "declining" | "signin" | "declined" | "error";

/**
 * Accept and "Not for me" on /invite/<code>.
 *
 * Accept needs a creator login (the invite links the agency's roster row to
 * it). Signed out, the 401 turns into the sign-up / log-in choice with the code
 * carried through; the portal auth pages accept it on the way back and land on
 * the campaign. "Not for me" needs no login: it only marks the invite declined,
 * through the same public respond route the old invite emails used.
 */
export function InviteActions({ code }: { code: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const q = `invitation=${encodeURIComponent(code)}`;

  const accept = async () => {
    setPhase("accepting");
    setMessage(null);
    try {
      const res = await fetch(`/api/portal/invites/${encodeURIComponent(code)}/accept`, { method: "POST" });
      if (res.status === 401) {
        setPhase("signin");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.campaignPath) {
        router.push(`${data.campaignPath}?accepted=1`);
        return;
      }
      setMessage(data.error ?? "Couldn't accept the invite. Try again.");
      setPhase("error");
    } catch {
      setMessage("Network error. Try again.");
      setPhase("error");
    }
  };

  const decline = async () => {
    setPhase("declining");
    setMessage(null);
    try {
      const res = await fetch("/api/campaign-invites/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code, action: "DECLINED" }),
      });
      if (res.ok) {
        setPhase("declined");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Couldn't record that. Try again.");
      setPhase("error");
    } catch {
      setMessage("Network error. Try again.");
      setPhase("error");
    }
  };

  if (phase === "declined") {
    return (
      <p role="status" style={{ fontSize: 15, color: "var(--cc-text)", margin: 0 }}>
        Thanks. We&apos;ve told the agency this one isn&apos;t for you.
      </p>
    );
  }

  if (phase === "signin") {
    return (
      <div role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 15, color: "var(--cc-text)", margin: 0 }}>
          Create your free creator account to accept. It takes a minute, and you&apos;ll land on the campaign.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            href={`/portal/register?${q}`}
            className="rsp-touch"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 40,
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
              background: "var(--cc-primary)",
              color: "var(--cc-on-primary)",
            }}
          >
            Sign up
          </Link>
          <Link
            href={`/portal/login?${q}`}
            className="rsp-touch"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 40,
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              border: "1px solid var(--cc-border)",
            }}
          >
            I have an account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="primary" loading={phase === "accepting"} disabled={phase === "declining"} onClick={accept}>
          Accept
        </Button>
        <Button variant="secondary" loading={phase === "declining"} disabled={phase === "accepting"} onClick={decline}>
          Not for me
        </Button>
      </div>
      {message && (
        <p role="alert" style={{ fontSize: 14, color: "var(--cc-danger-ink)", margin: 0 }}>
          {message}
        </p>
      )}
    </div>
  );
}
