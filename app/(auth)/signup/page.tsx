"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@pratham7711/ui";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      setLoading(false);
    } else {
      router.push("/login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--cc-bg)" }}>
      <div className="fixed top-4 right-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-1.5 justify-center mb-8">
          <span style={{ color: "#2563EB", fontSize: 20 }}>✦</span>
          <span style={{ fontWeight: 900, fontSize: 20, color: "var(--cc-text)" }}>creatorcore</span>
        </div>
        <div className="p-8 rounded-2xl" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", boxShadow: "var(--cc-shadow-lg)" }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "var(--cc-text)", marginBottom: 6 }}>Create account</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>Get started with CreatorCore</p>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)", display: "block", marginBottom: 6 }}>Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 12, fontSize: 14,
                  background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                  color: "var(--cc-text)", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)", display: "block", marginBottom: 6 }}>Work Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 12, fontSize: 14,
                  background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                  color: "var(--cc-text)", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)", display: "block", marginBottom: 6 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 12, fontSize: 14,
                  background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                  color: "var(--cc-text)", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
              Create Account
            </Button>
          </form>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "center", marginTop: 16 }}>
            {"Already have an account? "}
            <Link href="/login" style={{ color: "#3b82f6", fontWeight: 600 }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
