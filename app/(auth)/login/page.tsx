"use client";

import { useState, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button, Input } from "@pratham7711/ui";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setRegistered(params.get("registered") === "1");
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
      setError("Invalid email or password");
      setLoading(false);
    } else {
      window.location.href = "/campaigns";
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
        background: "var(--cc-bg)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <motion.div
        style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1 }}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 32 }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="var(--cc-primary)" strokeWidth="2.5"/>
            <circle cx="12" cy="12" r="5.5" stroke="var(--cc-primary)" strokeWidth="2"/>
            <circle cx="12" cy="12" r="2" fill="var(--cc-primary)"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 20, color: "var(--cc-text)", letterSpacing: "-0.02em" }}>
            outreach ai
          </span>
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 20,
            boxShadow: "var(--ui-shadow-lg)",
            padding: 40,
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Login
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
            Sign in to outreach ai
          </p>

          {registered && !error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              role="status"
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                background: "color-mix(in srgb, var(--cc-success) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--cc-success) 32%, transparent)",
                color: "var(--cc-success)",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              Account created. Sign in to get started.
            </motion.div>
          )}

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
              <Input
                ref={emailRef}
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div style={{ position: "relative" }}>
              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
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

            <div style={{ marginTop: 8 }}>
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
              >
                Sign in
              </Button>
            </div>
          </form>

          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", textAlign: "center", marginTop: 24 }}>
            Don&apos;t have an account?{" "}
            <Link href="/signup" style={{ color: "var(--cc-primary)", fontWeight: 600, textDecoration: "none" }}>
              Sign up
            </Link>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
