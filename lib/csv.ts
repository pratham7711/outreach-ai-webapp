export type Cell = string | number | null | undefined;

/**
 * Cells a spreadsheet would run instead of read.
 *
 * Excel, LibreOffice and Google Sheets all treat a cell beginning with `=`,
 * `+`, `-`, `@`, a tab or a carriage return as a formula, so a creator whose
 * display name is `=HYPERLINK("http://evil","claim payout")` -- or the older
 * `=cmd|'/c calc'!A0` -- executes in the finance lead's spreadsheet when they
 * open the export. Nothing in this product validates a name against that, and
 * quoting does not help: Excel strips the quotes and evaluates what is inside.
 *
 * The OWASP mitigation is to prefix the cell with a single quote, which costs a
 * visible apostrophe and buys a cell that is read rather than run. A
 * well-formed number is exempt: `-100` is not a formula, and prefixing it would
 * turn a numeric column into text.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function neutralizeCsvInjection(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const s = String(value);
  if (!FORMULA_LEAD.test(s) || PLAIN_NUMBER.test(s)) return s;
  return `'${s}`;
}

/** One cell, quoted only where a quote is needed. */
export function csvCell(value: Cell): string {
  const s = neutralizeCsvInjection(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A row of cells as one CSV line.
 *
 * Every cell is quoted rather than only the ones that need it. Campaign titles
 * and creator names carry commas, quotes and the occasional newline, and
 * deciding per cell is how a name with a comma in it turns into two columns.
 */
function line(cells: Cell[]): string {
  return cells
    .map((c) => `"${neutralizeCsvInjection(c).replace(/"/g, '""')}"`)
    .join(",");
}

export function toCsv(rows: Cell[][]): string {
  return rows.map(line).join("\n");
}

/**
 * Hand a CSV to the browser as a download.
 *
 * The anchor is put in the document and the URL is revoked on a later tick.
 * Clicking a detached anchor is a Chrome-only convenience, and revoking the
 * blob in the same tick as the click can cancel the download it was for --
 * both of which the copy this replaced did.
 */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** Today as YYYY-MM-DD, for stamping an export's filename. */
export function exportStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
