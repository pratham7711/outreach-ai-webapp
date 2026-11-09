"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { AuthForm, AuthNotice, AuthShell, PasswordField } from "@/components/auth/AuthShell";
import { Field } from "@/components/ds/Field";
import { ConnectPrompt } from "@/components/portal/ConnectPrompt";
import { LegalLinks } from "@/components/LegalLinks";
import { errandQuery, landingAfterAuth, readAuthErrand } from "@/lib/portal/afterAuth";

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errand = readAuthErrand(searchParams);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "", name: "", handle: "" });
  const [nextPath, setNextPath] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const loginHref = `/portal/login${errandQuery(errand)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.name,
          handle: form.handle,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const next = await landingAfterAuth(errand, "/portal/campaigns?tab=open");
        /* A refused invitation goes back to its public landing page; the
           connect step is for creators who made it into the app, and is
           skipped for one who arrived from a connect link, having just
           connected. */
        if (!next.startsWith("/portal/") || errand.connect) {
          router.push(next);
          return;
        }
        setNextPath(next);
        setLoading(false);
      } else {
        setError(data.error ?? "Something went wrong");
        setLoading(false);
      }
    } catch {
      setError("Network error");
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={nextPath ? "One last step" : "Create your creator account"}
      subtitle={
        nextPath
          ? "Your account is ready"
          : errand.invitation
            ? "Sign up to accept your invitation"
            : errand.join
              ? "Sign up to join this campaign"
              : errand.connect
                ? "Sign up to see the accounts you connected"
                : "Join campaigns and track how your posts do"
      }
      footer={
        nextPath ? undefined : (
          <>
            Already have an account? <Link href={loginHref}>Sign in</Link>
          </>
        )
      }
      below={<LegalLinks />}
    >
      {/* Consent comes back to My accounts, not to nextPath: it is the screen
          that reads the callback's ?connected / ?error&reason and says what
          happened. The campaigns page ignores both, so a refused connect
          (no roster row yet: reason=creator) used to land there silently. */}
      {nextPath && (
        <ConnectPrompt
          variant="step"
          returnTo="/portal/accounts"
          onSkip={() => router.push(nextPath)}
          skipLabel="Skip for now"
        />
      )}

      {error && <AuthNotice tone="danger">{error}</AuthNotice>}

      {!nextPath && (
        <AuthForm onSubmit={handleSubmit}>
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" autoComplete="name" />
          </Field>
          <Field label="Handle" required helper="No spaces.">
            <Input value={form.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="yourhandle" autoComplete="off" />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="creator@example.com" autoComplete="email" />
          </Field>
          <PasswordField
            label="Password"
            value={form.password}
            onChange={(v) => set({ password: v })}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <Button type="submit" variant="primary" fullWidth loading={loading}>
            Create account
          </Button>
        </AuthForm>
      )}
    </AuthShell>
  );
}

export default function PortalRegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}
