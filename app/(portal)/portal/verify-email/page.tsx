"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ds";
import { AuthNotice, AuthShell } from "@/components/auth/AuthShell";
import { ConnectPrompt } from "@/components/portal/ConnectPrompt";
import { LegalLinks } from "@/components/LegalLinks";
import { errandQuery, joinLinkAgency, landingAfterAuth, readAuthErrand } from "@/lib/portal/afterAuth";

/**
 * /portal/verify-email?token=...&<errand> -- where the confirmation mail
 * lands. A button, not an automatic confirm, so a mail scanner that opens the
 * link cannot spend it. Confirming signs the creator in and carries on with the
 * errand they signed up for (join link, invite, campaign), then offers to
 * connect an account.
 */
function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const errand = readAuthErrand(params);
  const [agency, setAgency] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [failure, setFailure] = useState("");
  const [nextPath, setNextPath] = useState<string | null>(null);

  useEffect(() => {
    if (!errand.agency) return;
    let alive = true;
    void joinLinkAgency(errand.agency).then((a) => alive && setAgency(a));
    return () => {
      alive = false;
    };
  }, [errand.agency]);

  const confirm = async () => {
    setState("working");
    try {
      const res = await fetch("/api/portal/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFailure(
          data.error === "expired" || data.error === "invalid"
            ? "This link has expired or was already used. Sign in and we'll send a new one."
            : (data.error ?? "Something went wrong"),
        );
        setState("failed");
        return;
      }
      const next = await landingAfterAuth(errand, "/portal/campaigns?tab=open");
      if (!next.startsWith("/portal/") || errand.connect) {
        router.push(next);
        return;
      }
      setNextPath(next);
    } catch {
      setFailure("Network error");
      setState("failed");
    }
  };

  const loginHref = `/portal/login${errandQuery(errand)}`;

  return (
    <AuthShell
      title={nextPath ? "Email confirmed" : "Confirm your email"}
      subtitle={
        nextPath
          ? errand.agency && agency
            ? `You're on ${agency}'s roster`
            : "Your account is ready"
          : "One click and your account is open"
      }
      below={<LegalLinks />}
    >
      {nextPath ? (
        <ConnectPrompt variant="step" returnTo="/portal/accounts" onSkip={() => router.push(nextPath)} skipLabel="Skip for now" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {state === "failed" && <AuthNotice tone="danger">{failure}</AuthNotice>}
          {!token ? (
            <AuthNotice tone="danger">This link is missing its code. Open the link from the email again.</AuthNotice>
          ) : (
            <Button variant="primary" fullWidth onClick={confirm} loading={state === "working"} data-testid="confirm-email">
              Confirm email
            </Button>
          )}
          {state === "failed" && (
            <p style={{ margin: 0, fontSize: 14, textAlign: "center" }}>
              <Link href={loginHref}>Sign in</Link>
            </p>
          )}
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
