"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Field } from "@/components/ds/Field";
import { AuthFrame } from "@/components/auth/AuthShell";
import { Eye, EyeOff, Building2, Sparkles } from "lucide-react";
import { BRAND } from "@/lib/brand";

type OrgTypeChoice = "AGENCY" | "BRAND";

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
  const [showPassword, setShowPassword] = useState(false);
  const orgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    orgRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!orgName.trim()) {
      setError("Please enter your organization name");
      orgRef.current?.focus();
      return;
    }
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
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
    <AuthFrame>
          <h1 className="cc-auth__title">
            Create your account
          </h1>
          <p className="cc-auth__sub">
            Set up your workspace on {BRAND.name}
          </p>

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
              <Field label="Organization name" required>
                <Input
                  ref={orgRef}
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
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
                {ORG_TYPE_OPTIONS.map(({ value, title, description, icon: Icon }) => {
                  const selected = orgType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setOrgType(value)}
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
              <Field label="Your name" required>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </Field>
            </div>

            <div>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </Field>
            </div>

            <div style={{ position: "relative" }}>
              <Field label="Password" required>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  minLength={8}
                  autoComplete="new-password"
                />
              </Field>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute",
                  right: 12,
                  /* Centred on the 38px input rather than pinned 10px off its
                     bottom: the phone touch rule makes this button 44px tall,
                     and growing upward from a fixed bottom put the eye 13px
                     above the field's centre. */
                  bottom: 19,
                  transform: "translateY(50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  color: "var(--cc-text-muted)",
                  display: "flex",
                  alignItems: "center",
                  zIndex: 2,
                  borderRadius: 4,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cc-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cc-text-muted)"; }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div>
              <Field label="Confirm password" required>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  minLength={8}
                  autoComplete="new-password"
                />
              </Field>
            </div>

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
