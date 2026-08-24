type Cell = string | number | null | undefined;

/**
 * A row of cells as one CSV line.
 *
 * Every cell is quoted rather than only the ones that need it. Campaign titles
 * and creator names carry commas, quotes and the occasional newline, and
 * deciding per cell is how a name with a comma in it turns into two columns.
 */
function line(cells: Cell[]): string {
  return cells
    .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
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
