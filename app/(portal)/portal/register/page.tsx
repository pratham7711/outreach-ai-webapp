"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { AuthForm, AuthNotice, AuthShell, PasswordField } from "@/components/auth/AuthShell";
import { Field } from "@/components/ds/Field";
import { CheckEmail } from "@/components/portal/CheckEmail";
import { LegalLinks } from "@/components/LegalLinks";
import { errandQuery, joinLinkAgency, readAuthErrand } from "@/lib/portal/afterAuth";

function RegisterInner() {
  const searchParams = useSearchParams();
  const errand = readAuthErrand(searchParams);
  const [agency, setAgency] = useState<string | null>(null);
  useEffect(() => {
    if (!errand.agency) return;
    let alive = true;
    void joinLinkAgency(errand.agency).then((a) => alive && setAgency(a));
    return () => {
      alive = false;
    };
  }, [errand.agency]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "", name: "", handle: "" });
  const [pending, setPending] = useState<{ email: string; devVerifyUrl?: string | null } | null>(null);
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
          errand,
        }),
      });
      const data = await res.json();
      if (res.ok || data.needsVerification) {
        /* No session yet: the account opens from the mailed link, which
           carries the errand on (/portal/verify-email). */
        setPending({ email: data.email ?? form.email, devVerifyUrl: data.devVerifyUrl ?? null });
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
      title={pending ? "Check your email" : "Create your creator account"}
      subtitle={
        pending
          ? "Confirm it's you to open your account"
          : errand.agency
            ? agency
              ? `Sign up to join ${agency}`
              : "Sign up to join your agency"
            : errand.invitation
            ? "Sign up to accept your invitation"
            : errand.join
              ? "Sign up to join this campaign"
              : errand.connect
                ? "Sign up to see the accounts you connected"
                : "Join campaigns and track how your posts do"
      }
      footer={
        pending ? undefined : (
          <>
            Already have an account? <Link href={loginHref}>Sign in</Link>
          </>
        )
      }
      below={<LegalLinks />}
    >
      {pending && <CheckEmail email={pending.email} errand={errand} devVerifyUrl={pending.devVerifyUrl} />}

      {error && <AuthNotice tone="danger">{error}</AuthNotice>}

      {!pending && (
        <AuthForm onSubmit={handleSubmit}>
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" autoComplete="name" />
          </Field>
          <Field label="Handle" required helper="No spaces.">
            <Input value={form.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="yourhandle" autoComplete="off" />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="creator@example.com" autoComplete="username" />
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
