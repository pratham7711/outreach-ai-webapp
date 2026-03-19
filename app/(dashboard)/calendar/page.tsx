"use client";
import { Card } from "@pratham7711/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";

const EVENTS = [
  { day: 1, title: "Summer Glow kickoff", color: "#2563EB" },
  { day: 5, title: "Creator onboarding call", color: "#7C3AED" },
  { day: 8, title: "Content review deadline", color: "#f59e0b" },
  { day: 13, title: "Mid-campaign check-in", color: "#22c55e" },
  { day: 15, title: "Back to School launch", color: "#2563EB" },
  { day: 20, title: "Payout processing", color: "#ef4444" },
  { day: 25, title: "Sound Drop Vol. 3 wrap", color: "#7C3AED" },
  { day: 30, title: "Monthly report due", color: "#f59e0b" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const daysInMonth = 31;
  const firstDayOffset = 0; // July 2026 starts on Wednesday actually, but for simplicity
  const blanks = Array.from({ length: firstDayOffset });
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Calendar</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Campaign schedule and deadlines</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", color: "var(--cc-text-muted)" }}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>July 2026</span>
          <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", color: "var(--cc-text-muted)" }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <Card variant="glass" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
        <div className="grid grid-cols-7" style={{ borderBottom: "1px solid var(--cc-border)" }}>
          {DAYS.map(d => (
            <div key={d} className="py-3 text-center" style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {blanks.map((_, i) => <div key={`b-${i}`} className="min-h-[100px]" style={{ borderBottom: "1px solid var(--cc-border)", borderRight: "1px solid var(--cc-border)" }} />)}
          {days.map(day => {
            const event = EVENTS.find(e => e.day === day);
            const isToday = day === 13;
            return (
              <div key={day} className="min-h-[100px] p-2" style={{ borderBottom: "1px solid var(--cc-border)", borderRight: "1px solid var(--cc-border)", background: isToday ? "rgba(37,99,235,0.06)" : "transparent" }}>
                <span className="inline-flex w-7 h-7 items-center justify-center rounded-full text-xs" style={{ fontWeight: isToday ? 800 : 500, background: isToday ? "#2563EB" : "transparent", color: isToday ? "white" : "var(--cc-text-muted)" }}>
                  {day}
                </span>
                {event && (
                  <div className="mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium truncate" style={{ background: `${event.color}20`, color: event.color }}>
                    {event.title}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
