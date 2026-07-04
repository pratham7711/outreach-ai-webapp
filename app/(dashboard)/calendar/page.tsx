"use client";
import { useState, useEffect } from "react";
import { Card, Button, Badge, Skeleton, EmptyState } from "@pratham7711/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, isSameMonth, isSameDay, isToday, addMonths, subMonths,
} from "date-fns";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#9CA3AF",
  PENDING: "#F59E0B",
  IN_PROGRESS: "var(--cc-primary)",
  COMPLETE: "#10B981",
  CANCELLED: "#EF4444",
};

type CalendarCampaign = {
  id: string; title: string; status: string; createdAt: string;
};

type CalendarActivation = {
  id: string; status: string; deliverableDueDate: string;
  creator: { id: string; name: string };
  campaign: { id: string; title: string };
};

type DayDetail = {
  campaigns: CalendarCampaign[];
  activations: CalendarActivation[];
};

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [campaigns, setCampaigns] = useState<CalendarCampaign[]>([]);
  const [activations, setActivations] = useState<CalendarActivation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStr = format(currentMonth, "yyyy-MM");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/calendar?month=${monthStr}`)
      .then(r => r.json())
      .then(data => {
        setCampaigns(data.campaigns ?? []);
        setActivations(data.activations ?? []);
      })
      .finally(() => setLoading(false));
  }, [monthStr]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const getDeliverables = (day: Date) =>
    activations.filter(a => a.deliverableDueDate && isSameDay(new Date(a.deliverableDueDate), day));

  const selectedDetail: DayDetail | null = selectedDay ? {
    campaigns: campaigns.filter(c => {
      const created = new Date(c.createdAt);
      return isSameDay(created, selectedDay);
    }),
    activations: getDeliverables(selectedDay),
  } : null;

  return (
    <div className="rsp-page">
      <style>{`
        .cal-more { display: none; }
        @media (max-width: 767px) {
          .cal-chip-extra { display: none; }
          .cal-more { display: block; }
        }
      `}</style>
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Calendar</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Campaign schedule and deadlines</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft size={16} />
          </Button>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", minWidth: 140, textAlign: "center" }}>
            {format(currentMonth, "MMMM yyyy")}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight size={16} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, color: "var(--cc-text-muted)", flexWrap: "wrap" }}>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            {status.replace(/_/g, " ")}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C3AED" }} />
          Deliverable Due
        </div>
      </div>

      <div className="rsp-split" style={{ gap: 24 }}>
        {/* Calendar grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <Skeleton width="100%" height="500px" borderRadius="12px" />
          ) : (
            <Card variant="outlined" noPadding>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--cc-border)" }}>
                {DAYS.map(d => (
                  <div key={d} style={{ padding: "12px 0", textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{d}</div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                {days.map((day) => {
                  const inMonth = isSameMonth(day, currentMonth);
                  const today = isToday(day);
                  const deliverables = getDeliverables(day);
                  const isSelected = selectedDay && isSameDay(day, selectedDay);
                  const campaignCreated = campaigns.filter(c => isSameDay(new Date(c.createdAt), day));

                  return (
                    <div
                      key={day.toISOString()}
                      onClick={() => setSelectedDay(day)}
                      className="cal-day-cell"
                      style={{
                        minWidth: 0, overflow: "hidden",
                        minHeight: 90, padding: 6,
                        borderBottom: "1px solid var(--cc-border)",
                        borderRight: "1px solid var(--cc-border)",
                        background: isSelected ? "var(--cc-bg)" : today ? "rgba(91,91,214,0.04)" : "transparent",
                        opacity: inMonth ? 1 : 0.35,
                        cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                    >
                      <span style={{
                        display: "inline-flex", width: 26, height: 26, alignItems: "center", justifyContent: "center",
                        borderRadius: "50%", fontSize: 12, fontWeight: today ? 700 : 500,
                        background: today ? "var(--cc-primary)" : "transparent",
                        color: today ? "white" : "var(--cc-text-muted)",
                      }}>
                        {format(day, "d")}
                      </span>
                      {campaignCreated.map((c, ci) => (
                        <div key={c.id} className={ci >= 2 ? "cal-chip cal-chip-extra" : "cal-chip"} style={{
                          minWidth: 0,
                          marginTop: 2, padding: "1px 4px", borderRadius: 3, fontSize: 9, fontWeight: 500,
                          background: `${STATUS_COLORS[c.status] ?? "var(--cc-primary)"}20`,
                          color: STATUS_COLORS[c.status] ?? "var(--cc-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {c.title}
                        </div>
                      ))}
                      {campaignCreated.length > 2 && (
                        <div className="cal-more" style={{
                          marginTop: 2, fontSize: 9, fontWeight: 600, color: "var(--cc-text-muted)",
                        }}>
                          +{campaignCreated.length - 2} more
                        </div>
                      )}
                      {/* Deliverable dots */}
                      {deliverables.length > 0 && (
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          {deliverables.map(d => (
                            <div key={d.id} style={{ width: 6, height: 6, borderRadius: "50%", background: "#7C3AED" }} title={`${d.creator.name} - ${d.campaign.title}`} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Side panel */}
        {selectedDay && (
          <div style={{ width: "100%", maxWidth: 320, flexShrink: 0 }} className="cal-side-panel">
            <style>{`@media (min-width: 1024px){ .cal-side-panel{ width:280px !important; } }`}</style>
            <Card variant="outlined" style={{ padding: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
                {format(selectedDay, "EEEE, MMM d")}
              </h3>
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 16 }}>{format(selectedDay, "yyyy")}</p>

              {selectedDetail && selectedDetail.campaigns.length === 0 && selectedDetail.activations.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "center", padding: "20px 0" }}>Nothing scheduled</p>
              ) : (
                <>
                  {selectedDetail!.campaigns.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Campaigns</span>
                      {selectedDetail!.campaigns.map(c => (
                        <div key={c.id} style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "var(--cc-bg)" }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>{c.title}</p>
                          <Badge variant="neutral" style={{ marginTop: 4, fontSize: 10 }}>{c.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedDetail!.activations.length > 0 && (
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Deliverables Due</span>
                      {selectedDetail!.activations.map(a => (
                        <div key={a.id} style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "rgba(124,58,237,0.06)" }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>{a.creator.name}</p>
                          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "2px 0 0" }}>{a.campaign.title}</p>
                          <Badge variant="neutral" style={{ marginTop: 4, fontSize: 10 }}>{a.status.replace(/_/g, " ")}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
