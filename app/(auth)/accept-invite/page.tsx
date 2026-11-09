"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { AuthForm, AuthFrame, AuthNotice, PasswordField } from "@/components/auth/AuthShell";
import { Field } from "@/components/ds/Field";
import { BRAND } from "@/lib/brand";

/**
 * Where an invite link lands.
 *
 * POST /api/invites/accept has existed and been correct for some time —
 * transactional, expiry-checked, audited — and nothing in the product ever
 * called it. Invites were created, stored with a token, and the token was shown
 * to nobody and usable nowhere. An invited colleague received nothing at all;
 * the row simply sat there until it expired.
 *
 * This is the missing half. It is deliberately its own public page rather than a
 * mode of /login, because the person arriving does not have an account yet —
 * asking them to "sign in" to accept an invitation is the confusion that makes
 * people email support instead.
 */
function AcceptInviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* The page used to render the same form for a live invitation, an expired
     one and one somebody had already used, and the reader only found out which
     on submit — after typing a name and choosing a password. Ask first. */
  type Preview = { orgName: string; role: string; email: string; expiresAt: string };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(true);
  const [deadLink, setDeadLink] = useState("");

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setDeadLink(data?.error ?? "That invitation is no longer valid.");
          return;
        }
        setPreview(data as Preview);
      })
      .catch(() => {
        if (!cancelled) setDeadLink("Could not reach the server. Check your connection and reload.");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || password.length < 8) {
      setError("Enter your name and a password of at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        /* The endpoint distinguishes expired, already-used and already-registered,
           and each needs a different next step from the reader — so the message
           is passed through rather than flattened into "something went wrong". */
        setError(data?.error ?? "That invite could not be accepted.");
        return;
      }
      router.push("/login?invited=1");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Shell>
        <h1 className="cc-auth__title">This invite link is incomplete</h1>
        <p style={P}>
          The link is missing its invite code. Ask whoever invited you to send it again — the
          full link ends in <code>?token=…</code>
        </p>
        <Link href="/login" style={{ color: "var(--cc-primary)", fontSize: 14 }}>
          Go to sign in
        </Link>
      </Shell>
    );
  }

  if (checking) {
    return (
      <Shell>
        <h1 className="cc-auth__title">Checking your invitation…</h1>
        <p style={{ ...P, marginBottom: 0 }}>One moment.</p>
      </Shell>
    );
  }

  if (deadLink) {
    return (
      <Shell>
        <h1 className="cc-auth__title">This invitation can&apos;t be used</h1>
        <p style={P}>{deadLink}</p>
        <Link href="/login" style={{ color: "var(--cc-primary)", fontSize: 14 }}>
          Go to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="cc-auth__title">Accept your invitation</h1>
      <p style={P}>
        {preview
          ? `You've been invited to join ${preview.orgName} as ${
              /^[AEIOU]/.test(preview.role) ? "an" : "a"
            } ${preview.role.toLowerCase()}. Choose a password and you're in.`
          : `You've been invited to join a workspace on ${BRAND.name}. Choose a password and you're in — the email address is already set by the invitation.`}
      </p>
      {preview ? (
        <p style={{ ...P, marginTop: -12 }}>
          Your sign-in address will be <strong style={{ color: "var(--cc-text)" }}>{preview.email}</strong>.
        </p>
      ) : null}

      <AuthForm onSubmit={submit} noValidate>
        <Field label="Your name" required>
          <Input
            id="name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            autoComplete="name"
          />
        </Field>
        <PasswordField
          id="password"
          label="Choose a password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />

        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}

        <Button type="submit" variant="primary" fullWidth disabled={loading}>
          {loading ? "Setting up…" : "Accept and continue"}
        </Button>
      </AuthForm>

      <p style={{ ...P, marginTop: 18, marginBottom: 0 }}>
        Already have an account? <Link href="/login" style={{ color: "var(--cc-primary)" }}>Sign in</Link>
      </p>
    </Shell>
  );
}

const P = { fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 20 } as const;

function Shell({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}

export default function AcceptInvitePage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<Shell><p style={P}>Loading…</p></Shell>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
