"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="min-h-screen bg-[#050A1F] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl text-[#2563EB] font-black">✦</span>
            <span className="text-2xl font-black text-white">creatorcore</span>
          </a>
        </div>

        {/* Card */}
        <div className="bg-[#0E0F1C] border border-white/[0.08] rounded-3xl p-10">
          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-4"
            >
              <div className="w-14 h-14 rounded-full bg-[#2563EB]/20 flex items-center justify-center mx-auto mb-4 text-2xl">
                ✉️
              </div>
              <h1 className="text-2xl font-black text-white mb-2">Check your email</h1>
              <p className="text-white/50 text-sm mb-8">
                We sent a reset link to{" "}
                <span className="text-white font-medium">{email}</span>
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-[#2563EB] hover:text-blue-400 text-sm font-semibold transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to sign in
              </Link>
            </motion.div>
          ) : (
            <>
              <h1 className="text-2xl font-black text-white mb-2">Reset your password</h1>
              <p className="text-white/50 text-sm mb-8">
                Enter your email and we&apos;ll send you a reset link
              </p>

              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email) setSent(true);
                }}
              >
                <div>
                  <label className="block text-white/70 text-sm font-medium mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-bold py-3 rounded-full transition-colors"
                >
                  Send reset link
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-white/40 hover:text-white text-sm font-medium transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
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
