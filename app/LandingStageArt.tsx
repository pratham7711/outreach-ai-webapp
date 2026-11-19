import { CalendarDays, Check, IndianRupee } from "lucide-react";
import { Sparkline } from "@/components/ds/Sparkline";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";

export type StageKey = "pitch" | "brief" | "live" | "track" | "pay";

const FACES = ["DC", "SS", "TD", "PV"];

/** A small slice of the app for each stage of the strip, drawn with demo values. */
export function StageArt({ stage }: { stage: StageKey }) {
  return (
    <div className="mb-stage-art" aria-hidden>
      {stage === "pitch" && (
        <div className="mb-art-faces">
          {FACES.map((f) => (
            <span key={f} className="mb-avatar">
              {f}
            </span>
          ))}
          <span className="mb-avatar mb-avatar-more">+8</span>
        </div>
      )}
      {stage === "brief" && (
        <ul className="mb-art-list">
          <li>
            <Check size={14} />1 TikTok video
          </li>
          <li>
            <IndianRupee size={14} />
            40,000
          </li>
          <li>
            <CalendarDays size={14} />
            Due 24 Nov
          </li>
        </ul>
      )}
      {stage === "live" && (
        <div className="mb-art-row">
          <span className="mb-art-glyph">
            <PlatformGlyph platform="TIKTOK" size="1rem" />
          </span>
          <span className="mb-art-handle">@demo.creator</span>
          <StatusBadge tone="success">Live</StatusBadge>
        </div>
      )}
      {stage === "track" && (
        <div className="mb-art-track">
          <span className="mb-art-figure">48.2K</span>
          <Sparkline values={[3, 5, 9, 14, 22, 31, 38, 44, 48]} width={92} height={32} />
        </div>
      )}
      {stage === "pay" && (
        <div className="mb-art-row">
          <span className="mb-art-figure">₹40,000</span>
          <StatusBadge tone="success">Paid</StatusBadge>
        </div>
      )}
    </div>
  );
}
