"use client";

import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-4 text-[var(--color-primary)]">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[#F0F0FF] mb-1">{title}</h3>
      <p className="text-sm text-[#8888AA] max-w-sm mb-5">{description}</p>
      {action}
    </div>
  );
}
