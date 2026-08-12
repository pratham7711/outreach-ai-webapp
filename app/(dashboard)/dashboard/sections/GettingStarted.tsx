"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Rocket } from "lucide-react";
import { SectionCard } from "@/components/ds";
import { BRAND } from "@/lib/brand";

const STEPS = [
  {
    href: "/campaigns",
    title: "Create your first campaign",
    body: "Launch a brief and start assigning creators to it.",
    cta: "Go to campaigns",
  },
  {
    href: "/creators",
    title: "Add creators",
    body: "Build your roster with handles, platforms, and rates.",
    cta: "Go to creators",
  },
  {
    href: "/settings",
    title: "Connect billing when you are ready",
    body: "Payouts and billing can wait until you need to pay someone.",
    cta: "Open settings",
  },
];

export function GettingStarted() {
  return (
    <SectionCard
      icon={Rocket}
      title={`Welcome to ${BRAND.name}`}
      description="Your workspace is ready. Three steps to get the first numbers on this dashboard."
      padded={false}
    >
      <ol className="flex flex-col divide-y divide-border">
        {STEPS.map((step, i) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/60"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                <span className="block text-[13px] leading-snug text-muted-foreground">
                  {step.body}
                </span>
              </span>
              <span className="hidden shrink-0 items-center gap-1 text-[13px] font-semibold text-primary sm:flex">
                {step.cta}
                <ArrowRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
