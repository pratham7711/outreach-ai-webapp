"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      className="min-h-screen flex items-center justify-center px-4 relative"
      style={{
        background: "linear-gradient(135deg, #6C3EF4 0%, #4A8EF0 100%)",
      }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-10">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5"/>
            <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="2"/>
            <circle cx="12" cy="12" r="2" fill="white"/>
          </svg>
          <span
            style={{
              fontWeight: 800,
              fontSize: 20,
              color: "white",
              letterSpacing: "-0.5px",
            }}
          >
            creatorcore
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: "white",
            borderRadius: "24px",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            padding: "40px",
          }}
        >
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--cc-text)",
              marginBottom: "4px",
            }}
          >
            Login
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--cc-text-muted)",
              marginBottom: "24px",
            }}
          >
            Sign in to creatorcore
          </p>

          {error && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "12px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#DC2626",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--cc-text)",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: "#F3F4F8",
                  border: "1px solid var(--cc-border)",
                  fontSize: 14,
                  color: "var(--cc-text)",
                  outline: "none",
                  transition: "all 0.2s",
                }}
                onFocus={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = "var(--cc-primary)";
                  (e.target as HTMLInputElement).style.background = "white";
                }}
                onBlur={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = "var(--cc-border)";
                  (e.target as HTMLInputElement).style.background = "#F3F4F8";
                }}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--cc-text)",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: "#F3F4F8",
                  border: "1px solid var(--cc-border)",
                  fontSize: 14,
                  color: "var(--cc-text)",
                  outline: "none",
                  transition: "all 0.2s",
                }}
                onFocus={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = "var(--cc-primary)";
                  (e.target as HTMLInputElement).style.background = "white";
                }}
                onBlur={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = "var(--cc-border)";
                  (e.target as HTMLInputElement).style.background = "#F3F4F8";
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "12px",
                background: "var(--cc-primary)",
                color: "white",
                fontSize: 14,
                fontWeight: 600,
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
                marginTop: 8,
                transition: "opacity 0.2s",
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p
            style={{
              fontSize: 12,
              color: "var(--cc-text-muted)",
              textAlign: "center",
              marginTop: 24,
            }}
          >
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              style={{
                color: "var(--cc-primary)",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
