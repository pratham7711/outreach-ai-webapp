"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button, Input } from "@pratham7711/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
        background: "linear-gradient(135deg, #6C3EF4 0%, #4A8EF0 100%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: 400 }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 40 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2.5"/>
            <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="2"/>
            <circle cx="12" cy="12" r="2" fill="white"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 20, color: "white", letterSpacing: "-0.5px" }}>
            outreach ai
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: "white",
            borderRadius: 24,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            padding: 40,
          }}
        >
          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ textAlign: "center", padding: "16px 0" }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "var(--cc-primary-light)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px", fontSize: 24,
              }}>
                ✉️
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>Check your email</h1>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 32 }}>
                We sent a reset link to{" "}
                <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{email}</span>
              </p>
              <Link
                href="/login"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  color: "var(--cc-primary)", fontSize: 14, fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                <ArrowLeft size={16} />
                Back to sign in
              </Link>
            </motion.div>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Reset your password</h1>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
                Enter your email and we&apos;ll send you a reset link
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email) setSent(true);
                }}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />

                <Button type="submit" variant="primary" fullWidth style={{ marginTop: 4 }}>
                  Send reset link
                </Button>
              </form>

              <div style={{ marginTop: 24, textAlign: "center" }}>
                <Link
                  href="/login"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    color: "var(--cc-text-muted)", fontSize: 14, fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <ArrowLeft size={16} />
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
