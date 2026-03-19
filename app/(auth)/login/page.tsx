"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Megaphone } from "lucide-react";

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
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#0A0A0F] relative overflow-hidden">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(#F0F0FF 1px, transparent 1px), linear-gradient(90deg, #F0F0FF 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />
      {/* Gradient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-purple-500 flex items-center justify-center">
            <Megaphone className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">CampaignHub</span>
        </div>

        {/* Card */}
        <div className="bg-[#111118] border border-[#2A2A3A] rounded-2xl shadow-2xl p-8">
          <h1 className="text-xl font-bold text-[#F0F0FF] mb-1">Welcome back</h1>
          <p className="text-sm text-[#8888AA] mb-6">Sign in to CampaignHub</p>

          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-[#8888AA] block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full px-4 py-2.5 rounded-lg bg-[#0A0A0F] border border-[#2A2A3A] text-sm text-[#F0F0FF] placeholder:text-[#555577] outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#8888AA] block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-2.5 rounded-lg bg-[#0A0A0F] border border-[#2A2A3A] text-sm text-[#F0F0FF] placeholder:text-[#555577] outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>

            <div className="flex items-center justify-end">
              <Link href="#" className="text-xs text-[var(--color-primary)] hover:underline">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-[var(--color-primary)]/25"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-xs text-[#555577] text-center mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-[var(--color-primary)] font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
