"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input } from "@pratham7711/ui";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ds";
import PlatformChips, { type PlatformChipLink } from "@/components/creators/PlatformChips";
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  detectMapping,
  isSignupFormMapping,
  parseTimestamp,
  type ColumnMapping,
  type ImportCell,
  type ImportField,
} from "@/lib/creators/importParse";
import { formatFull, formatFullCurrency } from "@/lib/format";

/**
 * Roster → Import: a Google Form export (or any sheet with profile links)
 * becomes creators. The file is read here, in the browser; the server parses
 * it again and decides, so the review shows exactly what will be written.
 */

type Sheet = { name: string; rows: ImportCell[][]; dataRows: number };

type PreviewPerson = {
  index: number;
  name: string;
  sheetName: string;
  rows: number[];
  links: (PlatformChipLink & { url: string })[];
  rate: number | null;
  audienceCountry: string | null;
  tags: string[];
  action: "create" | "update" | "correct" | "unchanged";
  changes: string[];
  corrections: string[];
};

type DryRun = {
  counts: { totalRows: number; people: number; create: number; update: number; correct: number; unchanged: number; rejected: number; merged: number };
  newTags: string[];
  people: PreviewPerson[];
  rejected: { row: number; name: string; reason: string }[];
};

type Step = "upload" | "tab" | "map" | "review" | "saving" | "done";
type ReviewTab = "create" | "update" | "correct" | "unchanged" | "rejected";

const CHUNK = 200;
const PAGE = 100;
const LINK_FIELDS: ImportField[] = ["tiktokLink", "instagramLink", "youtubeLink", "twitterLink"];

function hasValue(c: ImportCell) {
  return c !== null && c !== undefined && String(c).trim() !== "";
}

async function readWorkbook(file: File): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  // Text for a CSV, so a UTF-8 file without a BOM keeps its accents.
  const wb = /\.csv$/i.test(file.name)
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((name) => {
    const raw = XLSX.utils.sheet_to_json<ImportCell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    const rows = raw.map((r) => r.map((c) => (typeof c === "string" ? c.slice(0, 4000) : c)));
    return { name, rows, dataRows: rows.slice(1).filter((r) => r.some(hasValue)).length };
  });
}

/** Only the mapped columns travel, in the order the mapping names them. */
function project(rows: ImportCell[][], mapping: ColumnMapping) {
  const keep = mapping.flatMap((f, i) => (f ? [i] : []));
  return { rows: rows.map((r) => keep.map((i) => r[i] ?? null)), mapping: keep.map((i) => mapping[i]) };
}

function splitTags(text: string) {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 10);
}

/** "a", "a and b", "a, b and c". */
function listing(parts: string[]) {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

export default function ImportCreatorsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [tagText, setTagText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [dry, setDry] = useState<DryRun | null>(null);
  const [checking, setChecking] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("create");
  const [shown, setShown] = useState(PAGE);

  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState({ created: 0, updated: 0, corrected: 0, unchanged: 0 });
  const [resumeAt, setResumeAt] = useState<number | null>(null);

  const recognised = mapping.length > 0 && isSignupFormMapping(mapping);
  const extraTags = splitTags(tagText);
  const source = (recognised ? `Sign-up form · ${sheet?.name ?? ""}` : `${fileName} · ${sheet?.name ?? ""}`).slice(0, 120);

  // Leaving mid-save loses nothing already written, but the rest never arrives.
  useEffect(() => {
    if (step !== "saving") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const read = await readWorkbook(file);
      const usable = read.filter((s) => s.dataRows > 0);
      if (!usable.length) {
        setError("That file has no rows to import.");
        return;
      }
      setFileName(file.name.replace(/\.(xlsx|xls|csv)$/i, ""));
      setSheets(read);
      if (usable.length === 1) chooseSheet(usable[0]);
      else setStep("tab");
    } catch {
      setError("Couldn't read this file. Is it an .xlsx or .csv?");
    }
  }

  function chooseSheet(s: Sheet) {
    setError(null);
    if (s.dataRows > MAX_IMPORT_ROWS) {
      setError(`"${s.name}" has ${formatFull(s.dataRows)} rows. Import at most ${formatFull(MAX_IMPORT_ROWS)} at a time; split it into two tabs.`);
      return;
    }
    const detected = detectMapping(s.rows[0] ?? []);
    setSheet(s);
    setMapping(detected);
    setTagText(s.name);
    setDry(null);
    setStep(isSignupFormMapping(detected) ? "review" : "map");
  }

  const payload = useCallback(
    (tags: string[]) => {
      const p = project(sheet?.rows ?? [], mapping);
      return { rows: p.rows, mapping: p.mapping, extraTags: tags, source };
    },
    [sheet, mapping, source],
  );

  const runDryRun = useCallback(
    async (tags: string[], signal?: AbortSignal) => {
      setChecking(true);
      setError(null);
      try {
        const res = await fetch("/api/creators/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload(tags), mode: "dryRun" }),
          signal,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error ?? (res.status === 401 ? "Your session has expired. Sign in again and retry." : "Couldn't check this sheet."));
          return;
        }
        setDry(body);
        setReviewTab((t) => {
          if (t !== "create" || body.counts.create) return t;
          return body.counts.correct ? "correct" : body.counts.update ? "update" : t;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Could not reach the server. Check your connection and try again.");
      } finally {
        if (!signal?.aborted) setChecking(false);
      }
    },
    [payload],
  );

  // The review re-checks when the import-wide tags change: a new tag turns
  // "already up to date" creators into updates.
  const tagKey = extraTags.join("\u0000");
  useEffect(() => {
    if (step !== "review" || !sheet) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => runDryRun(tagKey ? tagKey.split("\u0000") : [], ctrl.signal), dry ? 600 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [step, sheet, mapping, tagKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commit(from: number) {
    if (!dry) return;
    setStep("saving");
    setError(null);
    setResumeAt(null);
    let offset = from;
    const base = { ...payload(extraTags), mode: "commit" as const };
    try {
      while (offset < dry.counts.people) {
        const res = await fetch("/api/creators/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...base, offset, limit: CHUNK }),
        });
        const out = await res.json().catch(() => null);
        if (!res.ok) throw new Error(out?.error ?? `The save stopped (${res.status}).`);
        setSaved((s) => ({
          created: s.created + out.created,
          updated: s.updated + out.updated,
          corrected: s.corrected + (out.corrected ?? 0),
          unchanged: s.unchanged + out.unchanged,
        }));
        offset = out.nextOffset;
        setProgress(offset);
        if (out.done) break;
      }
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not reach the server.");
      setResumeAt(offset);
    }
  }

  const close = () => {
    if (step === "saving" && resumeAt === null) return;
    if (step === "saving" || step === "done") router.refresh();
    onClose();
  };

  const toWrite = dry ? dry.counts.create + dry.counts.update + dry.counts.correct : 0;
  const confirmLabel = (() => {
    if (!dry) return "Import";
    if (!toWrite) return "Nothing new to import";
    const parts = [
      dry.counts.create ? `add ${formatFull(dry.counts.create)}` : null,
      dry.counts.update ? `update ${formatFull(dry.counts.update)}` : null,
      dry.counts.correct ? `correct ${formatFull(dry.counts.correct)}` : null,
    ].filter((p): p is string => p !== null);
    const text = `${listing(parts)} creator${toWrite === 1 ? "" : "s"}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
  })();

  const footer =
    step === "review" ? (
      <div className="cc-modal-footer">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!dry || checking || toWrite === 0} onClick={() => commit(0)}>
          {confirmLabel}
        </Button>
      </div>
    ) : step === "map" ? (
      <div className="cc-modal-footer">
        <Button variant="secondary" onClick={() => setStep(sheets.filter((s) => s.dataRows).length > 1 ? "tab" : "upload")}>Back</Button>
        <Button
          variant="primary"
          disabled={!mapping.some((f) => f && LINK_FIELDS.includes(f))}
          onClick={() => setStep("review")}
        >
          Review
        </Button>
      </div>
    ) : step === "saving" && resumeAt !== null ? (
      <div className="cc-modal-footer">
        <Button variant="secondary" onClick={close}>Close</Button>
        <Button variant="primary" onClick={() => commit(resumeAt)}>Retry remaining</Button>
      </div>
    ) : step === "done" ? (
      <div className="cc-modal-footer">
        <Button variant="secondary" onClick={close}>Close</Button>
        <Button
          variant="primary"
          onClick={() => {
            onClose();
            router.push(extraTags.length ? `/creators?tags=${encodeURIComponent(extraTags[0])}` : "/creators");
          }}
        >
          View them
        </Button>
      </div>
    ) : undefined;

  return (
    <Modal open onClose={close} title="Import creators" size="lg" footer={footer}>
      <div className="cc-import">
        {error && (
          <div role="alert" className="cc-import-alert">
            {error}
          </div>
        )}

        {step === "upload" && (
          <>
            <button
              type="button"
              className="cc-import-drop"
              data-dragging={dragging || undefined}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
            >
              <Upload size={22} aria-hidden />
              <span className="cc-import-drop-title">Drop the Google Sheet export here (.xlsx or .csv)</span>
              <span className="cc-import-hint">or click to choose a file</span>
            </button>
            <p className="cc-import-hint">In Google Sheets: File → Download → Microsoft Excel (.xlsx).</p>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </>
        )}

        {step === "tab" && (
          <>
            <p className="cc-import-lead">Which tab holds the creators?</p>
            <ul className="cc-import-tabs">
              {sheets.map((s) => (
                <li key={s.name}>
                  <button type="button" className="cc-import-tab" disabled={!s.dataRows} onClick={() => chooseSheet(s)}>
                    <FileSpreadsheet size={16} aria-hidden />
                    <span className="cc-import-tab-name">{s.name}</span>
                    <span className="cc-import-hint">{s.dataRows ? `${formatFull(s.dataRows)} row${s.dataRows === 1 ? "" : "s"}` : "empty"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === "map" && sheet && (
          <>
            <p className="cc-import-lead">
              Match each column to what it holds. Columns set to “Don’t import” are ignored; at least one profile link is needed.
            </p>
            <ul className="cc-import-map">
              {(sheet.rows[0] ?? []).map((header, i) => {
                const raw = sheet.rows.slice(1).find((r) => hasValue(r[i]))?.[i];
                // A form timestamp arrives as an Excel serial day; show it as the date it is.
                const when = mapping[i] === "signedUpAt" ? parseTimestamp(raw) : null;
                const sample = when ? when.toISOString().slice(0, 10) : raw;
                return (
                  <li key={i} className="cc-import-map-row">
                    <label htmlFor={`import-col-${i}`} className="cc-import-map-label">
                      <span className="cc-import-tab-name">{hasValue(header) ? String(header) : `Column ${i + 1}`}</span>
                      {hasValue(sample) && <span className="cc-import-hint">e.g. {String(sample).slice(0, 48)}</span>}
                    </label>
                    <select
                      id={`import-col-${i}`}
                      className="cc-import-select"
                      value={mapping[i] ?? ""}
                      onChange={(e) => {
                        const field = (e.target.value || null) as ImportField | null;
                        setMapping((m) => {
                          const next = [...m];
                          // One column per field: taking a field frees it elsewhere.
                          if (field) for (let j = 0; j < next.length; j++) if (next[j] === field) next[j] = null;
                          next[i] = field;
                          return next;
                        });
                      }}
                    >
                      <option value="">Don’t import</option>
                      {IMPORT_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {step === "review" && sheet && (
          <>
            <div className="cc-import-source">
              <FileSpreadsheet size={16} aria-hidden />
              <span>
                {sheet.name} · {formatFull(sheet.dataRows)} rows
              </span>
              {recognised && <span className="cc-import-chip">Recognised: creator sign-up form</span>}
              <button type="button" className="cc-import-link" onClick={() => setStep("map")}>
                Edit columns
              </button>
            </div>

            <Input
              label="Tag everyone in this import"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="e.g. Anime, Sign-ups 2026"
            />
            {dry && dry.newTags.length > 0 && (
              <p className="cc-import-hint">New tags: {dry.newTags.join(", ")}</p>
            )}

            <p role="status" aria-live="polite" className="cc-import-hint">
              {checking ? `Checking ${formatFull(sheet.dataRows)} rows against your roster…` : dry ? `${formatFull(dry.counts.people)} creator${dry.counts.people === 1 ? "" : "s"} found` : ""}
            </p>

            {!dry ? (
              <div className="cc-import-tiles" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="cc-import-tile cc-skeleton" />
                ))}
              </div>
            ) : (
              <>
                <div className="cc-import-tiles" role="tablist" aria-label="Import review">
                  {(
                    [
                      ["create", "New", dry.counts.create],
                      ["update", "Updated", dry.counts.update],
                      // Only when there is something to correct; most imports have nothing.
                      ...(dry.counts.correct ? ([["correct", "Corrected", dry.counts.correct]] as const) : []),
                      ["unchanged", "Already up to date", dry.counts.unchanged],
                      ["rejected", "Needs attention", dry.counts.rejected],
                    ] as const
                  ).map(([key, label, n]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={reviewTab === key}
                      className="cc-import-tile"
                      data-kind={key}
                      onClick={() => {
                        setReviewTab(key);
                        setShown(PAGE);
                      }}
                    >
                      <span className="cc-import-tile-n">{formatFull(n)}</span>
                      <span className="cc-import-tile-label">{label}</span>
                    </button>
                  ))}
                </div>
                {dry.counts.merged > 0 && (
                  <p className="cc-import-hint">
                    {formatFull(dry.counts.merged)} repeat sign-up{dry.counts.merged === 1 ? "" : "s"} merged (the latest answer kept).
                  </p>
                )}

                {reviewTab === "correct" && (
                  <p className="cc-import-hint">
                    An earlier import misread these numbers, names or countries from the sheet. Only values nobody has changed
                    since are corrected; anything edited by hand or refreshed from the platform stays as it is.
                  </p>
                )}
                {reviewTab === "rejected" ? (
                  <>
                    <p className="cc-import-hint">These rows are skipped. Fix them in the sheet and import again.</p>
                    <ul className="cc-import-list">
                      {dry.rejected.slice(0, shown).map((r) => (
                        <li key={r.row} className="cc-import-row">
                          <span className="cc-import-row-name">
                            Row {r.row} · {r.name || "No name"}
                          </span>
                          <span className="cc-import-hint">{r.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <ul className="cc-import-list">
                    {dry.people
                      .filter((p) => p.action === reviewTab)
                      .slice(0, shown)
                      .map((p) => (
                        <li key={p.index} className="cc-import-row">
                          <div className="cc-import-row-main">
                            <span className="cc-import-row-name">{p.name}</span>
                            <PlatformChips links={p.links} />
                          </div>
                          <div className="cc-import-row-meta">
                            {/* An existing creator keeps what the roster has; only the changes apply. */}
                            {p.action === "create" && p.rate != null && <span>{formatFullCurrency(p.rate)}/video</span>}
                            {p.action === "create" && p.audienceCountry && <span>Audience: {p.audienceCountry}</span>}
                            {p.action !== "create" && p.sheetName !== p.name && <span>In the sheet as “{p.sheetName}”</span>}
                            {p.tags.slice(0, 3).map((t) => (
                              <span key={t} className="cc-import-chip">
                                {t}
                              </span>
                            ))}
                            {p.tags.length > 3 && <span className="cc-import-hint">+{p.tags.length - 3}</span>}
                            {p.action === "correct" && <span className="cc-import-changes">{p.corrections.join(" · ")}</span>}
                            {(p.action === "update" || p.action === "correct") && p.changes.length > 0 && (
                              <span className="cc-import-changes">{p.changes.join(" · ")}</span>
                            )}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
                {(reviewTab === "rejected" ? dry.rejected.length : dry.people.filter((p) => p.action === reviewTab).length) > shown && (
                  <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                    Show more
                  </Button>
                )}
              </>
            )}
          </>
        )}

        {step === "saving" && dry && (
          <div className="cc-import-progress-wrap">
            <p role="status" aria-live="polite" className="cc-import-lead">
              {resumeAt === null
                ? `Saving ${formatFull(progress)} of ${formatFull(dry.counts.people)}…`
                : `Saved ${formatFull(progress)} of ${formatFull(dry.counts.people)}. What was saved stays saved.`}
            </p>
            <div
              className="cc-import-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={dry.counts.people}
              aria-valuenow={progress}
            >
              <span style={{ width: `${dry.counts.people ? (progress / dry.counts.people) * 100 : 0}%` }} />
            </div>
            {resumeAt === null && <p className="cc-import-hint">Keep this window open until it finishes.</p>}
          </div>
        )}

        {step === "done" && (
          <div className="cc-import-done">
            <CheckCircle2 size={28} aria-hidden className="cc-import-done-icon" />
            <p className="cc-import-lead">
              {listing(
                (
                  [
                    [saved.created, "added"],
                    [saved.updated, "updated"],
                    [saved.corrected, "corrected"],
                  ] as const
                )
                  .filter(([n]) => n > 0)
                  .map(([n, done]) => `${formatFull(n)} ${done}`),
              ) || "Nothing changed"}{" "}
              in your roster.
            </p>
            {dry && dry.counts.rejected > 0 && (
              <p className="cc-import-hint">
                {formatFull(dry.counts.rejected)} row{dry.counts.rejected === 1 ? "" : "s"} skipped (needs attention).
              </p>
            )}
            <p className="cc-import-hint">Follower counts and profile pictures fill in in the background within a day.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
