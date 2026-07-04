"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button, Input } from "@pratham7711/ui";
import { Eye, EyeOff, Building2, Sparkles } from "lucide-react";

type OrgTypeChoice = "AGENCY" | "BRAND";

const ORG_TYPE_OPTIONS: { value: OrgTypeChoice; title: string; description: string; icon: typeof Building2 }[] = [
  { value: "AGENCY", title: "Marketing Agency", description: "Manage campaigns for your brand clients", icon: Building2 },
  { value: "BRAND", title: "Brand", description: "Run your own campaigns", icon: Sparkles },
];

export default function SignupPage() {
  const router = useRouter();
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
      router.push("/login?registered=1");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
        background: "linear-gradient(135deg, #6C3EF4 0%, #4A8EF0 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="login-orb-1" aria-hidden="true" />
      <div className="login-orb-2" aria-hidden="true" />
      <div className="login-orb-3" aria-hidden="true" />
      <motion.div
        style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1 }}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 40 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5" />
            <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="2" />
            <circle cx="12" cy="12" r="2" fill="white" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: 20, color: "white", letterSpacing: "-0.5px" }}>
            outreach ai
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
          style={{
            background: "white",
            borderRadius: 24,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            padding: 40,
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Create your account
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
            Set up your workspace on outreach ai
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
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#DC2626",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
            <div className="login-input-wrap">
              <Input
                ref={orgRef}
                label="Organization name"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Agency"
                required
                autoComplete="organization"
              />
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
                        background: selected ? "rgba(91, 91, 214, 0.05)" : "white",
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
                          color: selected ? "white" : "var(--cc-text-muted)",
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

            <div className="login-input-wrap">
              <Input
                label="Your name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                required
                autoComplete="name"
              />
            </div>

            <div className="login-input-wrap">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </div>

            <div style={{ position: "relative" }} className="login-input-wrap">
              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute",
                  right: 12,
                  bottom: 10,
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

            <div className="login-input-wrap">
              <Input
                label="Confirm password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <div className="login-btn-glow" style={{ marginTop: 8 }}>
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
        </motion.div>
      </motion.div>
    </div>
  );
}
