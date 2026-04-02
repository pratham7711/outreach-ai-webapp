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
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
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
      {/* CSS-only animated background orbs */}
      <div className="login-orb-1" aria-hidden="true" />
      <div className="login-orb-2" aria-hidden="true" />
      <div className="login-orb-3" aria-hidden="true" />
      <motion.div
        style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1 }}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 40 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5"/>
            <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="2"/>
            <circle cx="12" cy="12" r="2" fill="white"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 20, color: "white", letterSpacing: "-0.5px" }}>
            outreach ai
          </span>
        </div>

        {/* Card */}
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
            Login
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
            Sign in to outreach ai
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

            <div style={{ position: "relative" }} className="login-input-wrap">
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

            <div className="login-btn-glow" style={{ marginTop: 8 }}>
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
