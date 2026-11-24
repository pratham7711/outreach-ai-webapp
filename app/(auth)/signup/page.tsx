"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Field } from "@/components/ds/Field";
import { AuthFrame, PasswordField } from "@/components/auth/AuthShell";
import { Building2, Sparkles } from "lucide-react";

type OrgTypeChoice = "AGENCY" | "BRAND";
type FieldKey = "orgName" | "name" | "email" | "password" | "confirm";

const FIELD_IDS: Record<FieldKey, string> = {
  orgName: "signup-org",
  name: "signup-name",
  email: "signup-email",
  password: "signup-password",
  confirm: "signup-confirm",
};

const ORG_TYPE_OPTIONS: { value: OrgTypeChoice; title: string; description: string; icon: typeof Building2 }[] = [
  { value: "AGENCY", title: "Marketing Agency", description: "Manage campaigns for your brand clients", icon: Building2 },
  { value: "BRAND", title: "Brand", description: "Run your own campaigns", icon: Sparkles },
];

export default function SignupPage() {
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<OrgTypeChoice>("AGENCY");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const orgRef = useRef<HTMLInputElement>(null);
  const typeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const clearError = (key: FieldKey) => setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

  const onTypeKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + ORG_TYPE_OPTIONS.length) % ORG_TYPE_OPTIONS.length;
    setOrgType(ORG_TYPE_OPTIONS[next].value);
    typeRefs.current[next]?.focus();
  };

  useEffect(() => {
    orgRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const found: Partial<Record<FieldKey, string>> = {};
    if (!orgName.trim()) found.orgName = "Enter your organization name";
    if (!name.trim()) found.name = "Enter your name";
    if (!email.trim()) found.email = "Enter your email address";
    if (password.length < 8) found.password = "Use at least 8 characters";
    else if (password !== confirmPassword) found.confirm = "Passwords do not match";
    setFieldErrors(found);
    const first = (Object.keys(FIELD_IDS) as FieldKey[]).find((k) => found[k]);
    if (first) {
      setError("");
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, name, email, password, orgType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      /* The route already tells us whether a verification mail actually left
         the building. Dropping it here is what made the login page promise an
         email on a deployment with no mail provider configured -- the one
         moment a new account most needs to be told the truth. */
      const verify = data.verificationEmail === "sent" ? "sent" : "unavailable";
      window.location.href = `/login?registered=1&verify=${verify}`;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthFrame showcase>
          <h1 className="cc-auth__title">
            Create your account
          </h1>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              role="alert"
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                background: "color-mix(in srgb, var(--cc-danger) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--cc-danger) 32%, transparent)",
                color: "var(--cc-danger)",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
            <div>
              <Field label="Organization name" required error={fieldErrors.orgName}>
                <Input
                  ref={orgRef}
                  id={FIELD_IDS.orgName}
                  type="text"
                  value={orgName}
                  onChange={(e) => { setOrgName(e.target.value); clearError("orgName"); }}
                  placeholder="Acme Agency"
                  autoComplete="organization"
                />
              </Field>
            </div>

            <div>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>
                What kind of organization is this?
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }} role="radiogroup" aria-label="Organization type">
                {ORG_TYPE_OPTIONS.map(({ value, title, description, icon: Icon }, i) => {
                  const selected = orgType === value;
                  return (
                    <button
                      key={value}
                      ref={(el) => {
                        typeRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setOrgType(value)}
                      onKeyDown={(e) => onTypeKey(e, i)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 12,
                        border: `2px solid ${selected ? "var(--cc-primary)" : "var(--cc-border)"}`,
                        background: selected ? "var(--cc-primary-light)" : "var(--cc-card)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          flexShrink: 0,
                          background: selected ? "var(--cc-primary)" : "var(--cc-bg)",
                          color: selected ? "var(--cc-on-primary)" : "var(--cc-text-muted)",
                        }}
                      >
                        <Icon size={18} />
                      </span>
                      <span>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{title}</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>{description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Field label="Your name" required error={fieldErrors.name}>
                <Input
                  id={FIELD_IDS.name}
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); clearError("name"); }}
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </Field>
            </div>

            <div>
              <Field label="Email" required error={fieldErrors.email}>
                <Input
                  id={FIELD_IDS.email}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError("email"); }}
                  placeholder="you@company.com"
                  autoComplete="username"
                  spellCheck={false}
                />
              </Field>
            </div>

            <PasswordField
              id={FIELD_IDS.password}
              label="Password"
              value={password}
              onChange={(v) => { setPassword(v); clearError("password"); }}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              error={fieldErrors.password}
            />

            <PasswordField
              id={FIELD_IDS.confirm}
              label="Confirm password"
              value={confirmPassword}
              onChange={(v) => { setConfirmPassword(v); clearError("confirm"); }}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              error={fieldErrors.confirm}
            />

            <div style={{ marginTop: 8 }}>
              <Button type="submit" variant="primary" fullWidth loading={loading}>
                Create account
              </Button>
            </div>
          </form>

          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", textAlign: "center", marginTop: 24 }}>
            Already have an account?{" "}
            <Link href="/login" style={{ color: "var(--cc-primary)", fontWeight: 600, textDecoration: "none" }}>
              Sign in
            </Link>
          </p>
    </AuthFrame>
  );
}
