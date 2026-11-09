"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, EmptyState } from "@pratham7711/ui";
import { PageHeader, Button, LoadError, Skeleton, StatusBadge } from "@/components/ds";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, isSameMonth, isSameDay, isToday, addMonths, subMonths,
} from "date-fns";
import { campaignStatusDot } from "@/lib/statusColors";
import { enumLabel } from "@/lib/ui/enumLabel";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";

/* CreatorCore's calendar starts its week on SATURDAY. MEASURED at
   desktop-1600, their weekday row reads, left to right:

     SAT 370.8 · SUN 550.4 · MON 730.1 · TUE 913.8 · WED 1092.8 · THU 1275.4 · FRI 1458

   all at 10px/400 in 181.1px columns. date-fns defaults to Sunday, so every
   one of our columns sat one place left of theirs and all seven weekday labels
   read as moved. The constant is here rather than inline because
   startOfWeek/endOfWeek and this array have to agree -- disagree and the grid
   silently labels Saturday's column "Sun". */
const WEEK_STARTS_ON = 6;
const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

/* The chips below used to build their background by appending hex alpha to
   whatever this map held -- `${color}20`. That works for a hex literal and
   silently produces nothing for "var(--cc-primary)20", which is
   not a colour, so Active and Complete campaigns drew their text on no
   background at all. The captured palette already carries the tinted ground as
   its own value, so there is nothing left to concatenate. */
const STATUS_ORDER = ["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"];

type CalendarCampaign = {
  id: string; title: string; status: string; createdAt: string;
};

type CalendarActivation = {
  id: string; status: string; deliverableDueDate: string;
  creator: { id: string; name: string; handle?: string | null };
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStr = format(currentMonth, "yyyy-MM");

  /* `.finally` with no `.catch` was the whole bug: a failed month left
     campaigns and activations at their previous (or empty) value, cleared the
     spinner, and the grid announced "Nothing scheduled" for a month whose
     contents were never read. An outage rendered as a fact about the calendar. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const r = await fetch(`/api/calendar?month=${monthStr}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      setCampaigns(data.campaigns ?? []);
      setActivations(data.activations ?? []);
    } catch {
      setCampaigns([]);
      setActivations([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [monthStr]);

  useEffect(() => { void load(); }, [load]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });
  const monthHasContent = days.some((day) =>
    campaigns.some((c) => isSameDay(new Date(c.createdAt), day)) ||
    activations.some((a) => a.deliverableDueDate && isSameDay(new Date(a.deliverableDueDate), day)),
  );
  const monthEmpty = !loading && !monthHasContent;

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
    <div className="rsp-page cc-bleed-page cc-cal-page">
      {/* On a phone a day cell is about 50px wide, so a chip could show two
          letters of its title -- MEASURED 2026-10-13 at 390: "WA..." in a 35px
          chip whose title needed 151 -- and a deliverable was a bare 6px dot.
          Below 768 the cell only marks that something is on (a dot per item,
          in its status colour) and the month is written out underneath as an
          agenda, where a title has the full width to wrap in. */}
      <style>{`
        .cal-more, .cal-marks, .cal-agenda { display: none; }
        .cal-dots { display: flex; }
        .cal-mark { width: 8px; height: 8px; border-radius: 50%; flex: none; }
        .cal-agenda ol, .cal-agenda ul { list-style: none; margin: 0; padding: 0; }
        .cal-agenda-day + .cal-agenda-day { margin-top: 16px; }
        .cal-agenda-date { margin: 0 0 8px; font-size: var(--cc-t-13); font-weight: var(--cc-fw-strong); color: var(--cc-text); }
        .cal-agenda-item { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--cc-card); border: 1px solid var(--cc-border); border-left-width: 3px; }
        .cal-agenda-item + .cal-agenda-item { margin-top: 8px; }
        .cal-agenda-title { font-size: var(--cc-t-14); font-weight: var(--cc-fw-strong); color: var(--cc-text); overflow-wrap: anywhere; }
        .cal-agenda-meta { font-size: var(--cc-t-12); color: var(--cc-text-muted); overflow-wrap: anywhere; }
        @media (max-width: 767px) {
          .cal-day-cell { --cal-cell-min-h: 56px; }
          .cal-chip, .cal-dots { display: none; }
          .cal-marks { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
          .cal-agenda { display: block; margin-top: 16px; }
        }
      `}</style>
      <PageHeader
        title="Calendar"
        subtitle="Campaign schedule and deadlines"
      />

      {/* The month nav sits on its own row under the title rather than inside
          the header's action slot. MEASURED at desktop-1600: their calendar
          puts its whole toolbar -- three filters, the Week/Month toggle and
          Today -- on a 40px row at y=90, with the grid following at 145. Ours
          had Today up on the title line at y=26 and the grid at 100, which put
          every weekday label 28px above theirs. */}
      <div className="cc-cal-toolbar cc-bleed">
        <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft size={16} />
        </Button>
        <span className="cc-panel-title" style={{ minWidth: 140, textAlign: "center" }}>
          {format(currentMonth, "MMMM yyyy")}
        </span>
        <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight size={16} />
        </Button>
        <Button className="cc-cal-today" variant="secondary" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
      </div>

      {/* Legend */}
      <div className="cc-cal-legend" style={{ gap: 16, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", flexWrap: "wrap" }}>
        {STATUS_ORDER.map((status) => (
          <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: campaignStatusDot(status) }} />
            {enumLabel(status)}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--cc-deliverable)" }} />
          Deliverable due
        </div>
      </div>

      <div className="rsp-split cc-cal-body cc-bleed" style={{ gap: 24 }}>
        {/* Calendar grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <Skeleton height={500} radius="var(--cc-r-card)" />
          ) : loadFailed ? (
            <LoadError
              title="We couldn't load this month"
              description={`${format(currentMonth, "MMMM yyyy")} could not be read. This is not the same as nothing being scheduled.`}
              onRetry={() => { void load(); }}
            />
          ) : (
            <Card variant="outlined" noPadding>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--cc-border)" }}>
                {DAYS.map(d => (
                  <div key={d} className="cal-weekday">{d}</div>
                ))}
              </div>
              {monthEmpty ? (
                <div style={{ padding: "56px 24px" }}>
                  <EmptyState
                    icon={<CalendarIcon size={32} color="var(--cc-text-subtle)" />}
                    title="Nothing scheduled"
                    description={`No campaigns or deliverable due dates in ${format(currentMonth, "MMMM yyyy")}.`}
                  />
                </div>
              ) : (
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
                        minHeight: "var(--cal-cell-min-h, 90px)", padding: 6,
                        borderBottom: "1px solid var(--cc-border)",
                        borderRight: "1px solid var(--cc-border)",
                        background: isSelected ? "var(--cc-bg)" : today ? "var(--cc-primary-light)" : inMonth ? "transparent" : "var(--cc-cal-outside-bg)",
                        cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                    >
                      <span className="cal-daynum" data-today={today ? "true" : undefined} style={{
                        background: today ? "var(--cc-primary)" : "transparent",
                        color: today ? "var(--cc-on-primary)" : "var(--cc-text-muted)",
                      }}>
                        {format(day, "d")}
                      </span>
                      {campaignCreated.map((c, ci) => (
                        /* The status rides on the tint and the edge, and the title
                           is the page's own ink at 11px. In the status colour at
                           9px it measured 1.9:1 (Pending) to 4.2:1 (Active) --
                           the smallest, faintest text in the app. */
                        <div key={c.id} title={c.title} className={ci >= 2 ? "cal-chip cal-chip-extra" : "cal-chip"} style={{
                          minWidth: 0,
                          marginTop: 2, padding: "1px 4px", borderRadius: 3, fontSize: "var(--cc-t-11)", fontWeight: 500,
                          /* Mixed into the card rather than into transparent: a
                             translucent chip over today's translucent cell is
                             two layers the contrast sweep composites as if the
                             lower one were opaque, scoring the title at 1.13:1
                             on a ground that is really near-white. */
                          background: `color-mix(in srgb, ${campaignStatusDot(c.status)} 14%, var(--cc-card))`,
                          borderLeft: `3px solid ${campaignStatusDot(c.status)}`,
                          color: "var(--cc-text)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {c.title}
                        </div>
                      ))}
                      {campaignCreated.length > 2 && (
                        <div className="cal-more" style={{
                          marginTop: 2, fontSize: "var(--cc-t-11)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text-muted)",
                        }}>
                          +{campaignCreated.length - 2} more
                        </div>
                      )}
                      {/* Deliverable dots */}
                      {deliverables.length > 0 && (
                        <div className="cal-dots" style={{ gap: 3, marginTop: 3 }}>
                          {deliverables.map(d => (
                            <div key={d.id} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cc-deliverable)" }} title={`${d.creator.name} - ${d.campaign.title}`} />
                          ))}
                        </div>
                      )}
                      {/* Phone only: what is on, not what it is -- the agenda
                          under the grid says that. */}
                      {(campaignCreated.length > 0 || deliverables.length > 0) && (
                        <div className="cal-marks" aria-hidden="true">
                          {campaignCreated.map((c) => (
                            <span key={c.id} className="cal-mark" style={{ background: campaignStatusDot(c.status) }} />
                          ))}
                          {deliverables.map((d) => (
                            <span key={d.id} className="cal-mark" style={{ background: "var(--cc-deliverable)" }} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </Card>
          )}
          {!loading && !loadFailed && !monthEmpty && (
            <section className="cal-agenda" aria-label={`Scheduled in ${format(currentMonth, "MMMM yyyy")}`}>
              <ol>
                {days.map((day) => {
                  const created = campaigns.filter((c) => isSameDay(new Date(c.createdAt), day));
                  const due = getDeliverables(day);
                  if (created.length === 0 && due.length === 0) return null;
                  return (
                    <li key={day.toISOString()} className="cal-agenda-day">
                      <h3 className="cal-agenda-date">{format(day, "EEE d MMM")}</h3>
                      <ul>
                        {created.map((c) => (
                          <li key={c.id} className="cal-agenda-item" style={{ borderLeftColor: campaignStatusDot(c.status) }}>
                            <span className="cal-agenda-title">{c.title}</span>
                            <span className="cal-agenda-meta">Campaign created · {enumLabel(c.status)}</span>
                          </li>
                        ))}
                        {due.map((a) => (
                          <li key={a.id} className="cal-agenda-item" style={{ borderLeftColor: "var(--cc-deliverable)" }}>
                            <CreatorName name={a.creator.name} handle={a.creator.handle} layout="inline" size="sm" />
                            <span className="cal-agenda-meta">
                              Deliverable due · {a.campaign.title} · {enumLabel(a.status)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>

        {/* Side panel */}
        {selectedDay && (
          <div style={{ maxWidth: 320, flexShrink: 0 }} className="cal-side-panel">
            <style>{`.cal-side-panel{ width:100%; } @media (min-width: 1024px){ .cal-side-panel{ width:280px; } }`}</style>
            <Card variant="outlined">
              <h3 style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
                {format(selectedDay, "EEEE, MMM d")}
              </h3>
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginBottom: 16 }}>{format(selectedDay, "yyyy")}</p>

              {selectedDetail && selectedDetail.campaigns.length === 0 && selectedDetail.activations.length === 0 ? (
                <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", textAlign: "center", padding: "20px 0" }}>Nothing scheduled</p>
              ) : (
                <>
                  {selectedDetail!.campaigns.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <span className="cc-microlabel">Campaigns</span>
                      {selectedDetail!.campaigns.map(c => (
                        <div key={c.id} style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "var(--cc-bg)" }}>
                          <p style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", margin: 0 }}>{c.title}</p>
                          <div style={{ marginTop: 6 }}><StatusBadge status={c.status} /></div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedDetail!.activations.length > 0 && (
                    <div>
                      <span className="cc-microlabel">Deliverables due</span>
                      {selectedDetail!.activations.map(a => (
                        <div key={a.id} style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "color-mix(in srgb, var(--cc-deliverable) 6%, transparent)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <CreatorAvatar id={a.creator.id} name={a.creator.name} size="sm" />
                            <CreatorName name={a.creator.name} handle={a.creator.handle} layout="inline" size="sm" />
                          </div>
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "2px 0 0" }}>{a.campaign.title}</p>
                          <div style={{ marginTop: 6 }}><StatusBadge status={a.status} /></div>
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
