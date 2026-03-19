"use client";

const PLATFORM_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  TIKTOK: { bg: "bg-black", text: "text-white", label: "TikTok" },
  INSTAGRAM: { bg: "bg-gradient-to-r from-purple-500 to-pink-500", text: "text-white", label: "Instagram" },
  YOUTUBE: { bg: "bg-red-600", text: "text-white", label: "YouTube" },
  TWITTER: { bg: "bg-blue-500", text: "text-white", label: "Twitter" },
  X: { bg: "bg-black", text: "text-white", label: "X" },
};

export function PlatformBadge({ platform }: { platform: string }) {
  const config = PLATFORM_CONFIG[platform] ?? { bg: "bg-[#2A2A3A]", text: "text-[#8888AA]", label: platform };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}
