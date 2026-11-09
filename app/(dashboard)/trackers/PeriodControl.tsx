"use client";

/** The change window both tracker tabs read in: one framed row of options. */
export function PeriodControl({
  periods,
  value,
  onChange,
}: {
  periods: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="group" aria-label="Change over" className="cc-segmented">
      {periods.map((p) => (
        <button
          key={p.key}
          type="button"
          className="cc-segmented-btn"
          aria-pressed={value === p.key}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
