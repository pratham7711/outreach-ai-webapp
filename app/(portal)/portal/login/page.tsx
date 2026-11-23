"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";
import { AuthPlatforms } from "@/components/auth/AuthBrand";
import { AuthForm, AuthNotice, AuthShell, PasswordField } from "@/components/auth/AuthShell";
import { Field } from "@/components/ds/Field";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { CheckEmail } from "@/components/portal/CheckEmail";
import { errandQuery, joinLinkAgency, landingAfterAuth, readAuthErrand } from "@/lib/portal/afterAuth";
import { CALLBACK_PARAM, safeCallbackPath } from "@/lib/callbackPath";

function LoginInner() {
  const router = useRouter();
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
  const [form, setForm] = useState({ email: "", password: "" });
  const [pending, setPending] = useState<{ email: string; devVerifyUrl?: string | null } | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const registerHref = `/portal/register${errandQuery(errand)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, errand }),
      });
      const data = await res.json();
      if (res.ok) {
        /* An errand (invite, join, connect) still decides first; otherwise
           back to the portal page that found the creator signed out. */
        const back = safeCallbackPath(searchParams.get(CALLBACK_PARAM), { within: "/portal" });
        router.push(await landingAfterAuth(errand, back ?? "/portal/dashboard"));
      } else if (data.needsVerification) {
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
      title={pending ? "Check your email" : "Creator Portal"}
      subtitle={
        pending
          ? "Confirm your email to open your account"
          : errand.agency
          ? agency
            ? `Sign in to join ${agency}`
            : "Sign in to join your agency"
          : errand.invitation
          ? "Sign in to accept your invitation"
          : errand.join
            ? "Sign in to join this campaign"
            : errand.connect
              ? "Sign in to see the accounts you connected"
              : undefined
      }
      footer={
        <>
          Don&apos;t have an account? <Link href={registerHref}>Register</Link>
        </>
      }
      below={
        <>
          <AuthPlatforms />
          <LegalLinks />
        </>
      }
    >
      {error && <AuthNotice tone="danger">{error}</AuthNotice>}

      {pending ? (
        <CheckEmail email={pending.email} errand={errand} devVerifyUrl={pending.devVerifyUrl} />
      ) : (
      <AuthForm onSubmit={handleSubmit}>
        <Field label="Email" required>
          <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="creator@example.com" autoComplete="email" />
        </Field>
        <PasswordField
          label="Password"
          value={form.password}
          onChange={(v) => set({ password: v })}
          placeholder="Enter password"
          autoComplete="current-password"
        />
        <Button type="submit" variant="primary" fullWidth loading={loading}>
          Sign in
        </Button>
      </AuthForm>
      )}
    </AuthShell>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
