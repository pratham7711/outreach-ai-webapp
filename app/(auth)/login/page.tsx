"use client";

import { useState, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Field } from "@/components/ds/Field";
import { BRAND } from "@/lib/brand";
import { AuthPlatforms } from "@/components/auth/AuthBrand";
import { AuthForm, AuthNotice, AuthShell, PasswordField } from "@/components/auth/AuthShell";
import { CALLBACK_PARAM, safeCallbackPath } from "@/lib/callbackPath";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  /* Sent here by /accept-invite after the account is created. Landing on a
     bare sign-in form with no word about what just happened reads like the
     invitation failed. */
  const [invited, setInvited] = useState(false);
  /* Whether signup's verification mail actually went out. "sent" and
     "unavailable" are the two values /api/signup returns; an older link with no
     verify param at all falls back to the cautious wording. */
  const [verifyState, setVerifyState] = useState<"sent" | "unavailable" | "unknown">("unknown");
  const [notice, setNotice] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setRegistered(params.get("registered") === "1");
      setInvited(params.get("invited") === "1");
      const verify = params.get("verify");
      if (verify === "sent" || verify === "unavailable") setVerifyState(verify);
      /* Sent here by /api/auth/session-invalid. Without a line of explanation,
         being signed out mid-session looks like the app losing your login. */
      if (params.get("reason") === "org-removed") {
        setNotice("Your workspace is no longer available, so you have been signed out. Sign in again, or ask whoever manages the workspace to invite you.");
      }
      if (params.get("reason") === "account-inactive") {
        setNotice("Your access to this workspace has been removed, so you have been signed out. Ask whoever manages the workspace if you think this is a mistake.");
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError("Please enter your email address");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Please enter your password");
      return;
    }

    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      /* "Invalid email or password" is the right answer to almost everything
         here and deliberately so -- it is what an unauthenticated stranger is
         told whether or not the address exists. A throttle is the exception:
         somebody who mistyped their own password ten times needs to know that
         waiting fixes it, or they will sit there retyping a password that was
         correct two attempts ago. `code` is the only field @auth/core copies
         onto the redirect URL, so it is the only thing available to branch on. */
      setError(
        result.code === "rate-limited"
          ? "Too many sign-in attempts. Wait a minute and try again."
          : "Invalid email or password"
      );
      setLoading(false);
    } else {
      /* Back to the page the sign-in interrupted, which the middleware put on
         the redirect; the campaign list only when there was none. Read from
         the live URL and re-checked here, because the query string is
         whatever the link said -- see lib/callbackPath. */
      const back = safeCallbackPath(new URLSearchParams(window.location.search).get(CALLBACK_PARAM));
      window.location.href = back ?? "/campaigns";
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle={`Welcome back to ${BRAND.name}`}
      footer={
        <>
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </>
      }
      below={<AuthPlatforms />}
    >
      {notice && !error && <AuthNotice tone="warning">{notice}</AuthNotice>}

      {/* Three states, because signup has three outcomes and only one of
          them is an email that went out. Saying "we have emailed you a
          link" on the other two sends a new account looking through spam
          for a message nothing ever sent. */}
      {registered && !error && (
        <AuthNotice tone={verifyState === "unavailable" ? "warning" : "success"}>
          {verifyState === "sent" ? (
            <>Account created. We have emailed you a link to confirm your address. Sign in to get started.</>
          ) : verifyState === "unavailable" ? (
            <>Account created, but we could not send the confirmation email just now. Sign in anyway: there is a Resend button in the banner at the top of the app.</>
          ) : (
            <>Account created. Sign in to get started.</>
          )}
        </AuthNotice>
      )}

      {invited && !registered && !error && (
        <AuthNotice tone="success">
          Invitation accepted. Sign in with the address it was sent to and the password you just chose.
        </AuthNotice>
      )}

      {error && <AuthNotice tone="danger">{error}</AuthNotice>}

      <AuthForm onSubmit={handleSubmit} noValidate>
        <Field label="Email" required>
          <Input
            ref={emailRef}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="Enter your password"
          autoComplete="current-password"
        />

        {/* The only route into the reset flow a locked-out user can reach:
            they cannot get past this screen to find it. */}
        <Link href="/forgot-password" className="cc-auth__aside-link">
          Forgot password?
        </Link>

        <Button type="submit" variant="primary" fullWidth loading={loading}>
          Sign in
        </Button>
      </AuthForm>
    </AuthShell>
  );
}
