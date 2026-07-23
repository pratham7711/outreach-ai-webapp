"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, User, Music, Zap, Plus, X, Sparkles, ArrowRight, PartyPopper } from "lucide-react";

type OrgType = "Agency" | "Manager" | "Music Label" | "Brand";

const orgTypes: { type: OrgType; icon: typeof Building2; description: string }[] = [
  { type: "Agency", icon: Building2, description: "Manage multiple clients" },
  { type: "Manager", icon: User, description: "Represent creators" },
  { type: "Music Label", icon: Music, description: "Music & audio campaigns" },
  { type: "Brand", icon: Zap, description: "Direct brand campaigns" },
];

const slideVariants = {
  enter: { x: 40, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -40, opacity: 0 },
};

function Confetti() {
  const colors = ["#2563EB", "#7C3AED", "#60A5FA", "#34D399", "#F59E0B"];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
      {Array.from({ length: 24 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-sm"
          style={{
            backgroundColor: colors[i % colors.length],
            left: `${15 + (i * 3.2) % 70}%`,
          }}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{ y: 350, opacity: [1, 1, 0], rotate: (i % 2 === 0 ? 1 : -1) * (180 + i * 30) }}
          transition={{
            duration: 2 + (i % 3) * 0.4,
            delay: (i % 8) * 0.1,
            ease: "easeIn",
          }}
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [teammates, setTeammates] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

  const totalSteps = 3;
  const progress = ((step + 1) / totalSteps) * 100;

  const handleContinue2 = () => {
    setStep(2);
    setShowConfetti(true);
  };

  const addTeammate = () => {
    if (newEmail.trim()) {
      setTeammates([...teammates, newEmail.trim()]);
      setNewEmail("");
    }
  };

  return (
    <div className="min-h-screen bg-[#050A1F] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2">
            <Sparkles className="text-[#2563EB]" />
            <span className="text-2xl font-black text-white">outreach ai</span>
          </a>
        </div>

        {/* Card */}
        <div className="bg-[#0E0F1C] border border-white/[0.08] rounded-3xl p-10 relative overflow-hidden">
          {showConfetti && step === 2 && <Confetti />}

          {/* Progress bar */}
          <div className="w-full bg-white/10 rounded-full h-1 mb-8">
            <motion.div
              className="h-full bg-[#2563EB] rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>

          <AnimatePresence mode="wait">
            {/* ── Step 1: Organization ── */}
            {step === 0 && (
              <motion.div
                key="step0"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
              >
                <p className="text-white/40 text-xs uppercase tracking-widest mb-6 font-semibold">
                  Step 1 of 3
                </p>
                <h2 className="text-2xl font-black text-white mb-2">
                  Tell us about your organization
                </h2>
                <p className="text-white/50 text-sm mb-8">
                  We&apos;ll personalize your experience based on your team type.
                </p>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-white/70 text-sm font-medium mb-1.5">
                      Organization Name
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Your Agency Name"
                      className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-white/70 text-sm font-medium mb-3">
                      What best describes your team?
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {orgTypes.map(({ type, icon: Icon, description }) => (
                        <button
                          key={type}
                          onClick={() => setOrgType(type)}
                          className={`p-4 rounded-xl border text-left transition-all ${
                            orgType === type
                              ? "border-[#2563EB] bg-[#2563EB]/10 text-white"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white/80"
                          }`}
                        >
                          <Icon className="w-5 h-5 mb-2" />
                          <p className="font-bold text-sm">{type}</p>
                          <p className="text-xs opacity-60 mt-0.5">{description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => orgName && orgType && setStep(1)}
                  disabled={!orgName || !orgType}
                  className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-full transition-colors flex items-center justify-center gap-2"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ── Step 2: Team ── */}
            {step === 1 && (
              <motion.div
                key="step1"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
              >
                <p className="text-white/40 text-xs uppercase tracking-widest mb-6 font-semibold">
                  Step 2 of 3
                </p>
                <h2 className="text-2xl font-black text-white mb-2">Invite your team</h2>
                <p className="text-white/50 text-sm mb-8">
                  Collaborate from day one. You can always do this later.
                </p>

                <div className="space-y-3 mb-6">
                  {teammates.map((email) => (
                    <div key={email} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                      <div className="w-7 h-7 rounded-full bg-[#2563EB]/20 flex items-center justify-center text-[#2563EB] text-xs font-bold">
                        {email[0].toUpperCase()}
                      </div>
                      <span className="text-white text-sm flex-1">{email}</span>
                      <button
                        onClick={() => setTeammates(teammates.filter((e) => e !== email))}
                        className="text-white/30 hover:text-white/70 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addTeammate()}
                      placeholder="colleague@company.com"
                      className="flex-1 bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                    />
                    <button
                      onClick={addTeammate}
                      className="bg-white/10 hover:bg-white/15 text-white px-4 rounded-xl transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleContinue2}
                    className="flex-1 text-white/40 hover:text-white font-medium text-sm py-3 rounded-full border border-white/10 hover:border-white/20 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleContinue2}
                    className="flex-1 bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-bold py-3 rounded-full transition-colors flex items-center justify-center gap-2"
                  >
                    Continue <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Done ── */}
            {step === 2 && (
              <motion.div
                key="step2"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
                className="text-center py-4"
              >
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5, type: "spring" }}
                  className="mb-6"
                >
                  <PartyPopper className="w-12 h-12 inline-block text-[#2563EB]" />
                </motion.div>
                <h2 className="text-3xl font-black text-white mb-3">You&apos;re all set!</h2>
                <p className="text-white/50 text-base mb-10">
                  Welcome to Outreach AI
                  {orgName ? `, ${orgName}` : ""}. Your workspace is ready.
                </p>
                <motion.a
                  href="/dashboard"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center justify-center gap-2 bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-bold py-3.5 px-10 rounded-full transition-colors"
                >
                  Go to your dashboard <ArrowRight className="w-4 h-4" />
                </motion.a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
