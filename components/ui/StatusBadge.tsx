"use client";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-[#1E1E2A] text-[#8888AA] border border-[#2A2A3A]",
  IN_PROGRESS: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  COMPLETE: "bg-emerald-500/10 text-emerald-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-400",
  CANCELLED: "bg-red-500/10 text-red-400",
  PENDING: "bg-amber-500/10 text-amber-400",
  PROCESSING: "bg-blue-500/10 text-blue-400",
  SUCCESS: "bg-emerald-500/10 text-emerald-400",
  FAILED: "bg-red-500/10 text-red-400",
  ACTIVE: "bg-emerald-500/10 text-emerald-400",
  POSTING: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  POSTED: "bg-emerald-500/10 text-emerald-400",
  APPROVED: "bg-emerald-500/10 text-emerald-400",
  DECLINED: "bg-red-500/10 text-red-400",
  AWAITING_DRAFT: "bg-amber-500/10 text-amber-400",
  DRAFT_SUBMITTED: "bg-blue-500/10 text-blue-400",
  AWAITING_APPROVAL: "bg-amber-500/10 text-amber-400",
};

const PULSE_STATUSES = new Set(["IN_PROGRESS", "POSTING", "PROCESSING"]);

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-[#1E1E2A] text-[#8888AA] border border-[#2A2A3A]";
  const showPulse = PULSE_STATUSES.has(status);

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>
      {showPulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {status.replace(/_/g, " ")}
    </span>
  );
}
