/**
 * Field-level inventory of the CreatorCore extract.
 *
 * The PRD needs to know what CreatorCore actually stores per type, not what its
 * UI happens to render. This reads scripts/creatorcore/out/<type>.jsonl and
 * reports, per field: how many records carry it, its observed types, and how
 * many distinct values it takes -- enough to tell an enum from free text and a
 * populated field from a vestigial one.
 *
 * Prints names and shapes only. No values, because these are the user's real
 * campaign and creator records.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readdirSync } from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "out");

/** Enum-ish fields are worth listing exactly; anything wider stays summarised. */
const ENUM_CEILING = 12;

function classify(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function inventory(file) {
  const fields = new Map();
  let records = 0;

  const stream = createInterface({
    input: createReadStream(path.join(OUT, file)),
    crlfDelay: Infinity,
  });

  for await (const line of stream) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    records += 1;
    for (const [key, value] of Object.entries(row)) {
      const entry =
        fields.get(key) ??
        { present: 0, empty: 0, types: new Set(), values: new Set(), wide: false };
      entry.present += 1;
      const kind = classify(value);
      entry.types.add(kind);
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        entry.empty += 1;
      } else if (!entry.wide && (kind === "string" || kind === "boolean" || kind === "number")) {
        entry.values.add(String(value));
        if (entry.values.size > ENUM_CEILING) {
          entry.wide = true;
          entry.values.clear();
        }
      }
      fields.set(key, entry);
    }
  }

  return { records, fields };
}

const files = readdirSync(OUT).filter((f) => f.endsWith(".jsonl"));

for (const file of files) {
  const { records, fields } = await inventory(file);
  console.log(`\n## ${file.replace(".jsonl", "")} — ${records} records, ${fields.size} fields\n`);
  if (records === 0) {
    console.log("(empty extract)\n");
    continue;
  }
  const rows = [...fields.entries()].sort((a, b) => b[1].present - a[1].present);
  console.log("| field | present | populated | types | distinct |");
  console.log("|---|---|---|---|---|");
  for (const [name, e] of rows) {
    const populated = e.present - e.empty;
    const pct = ((populated / records) * 100).toFixed(0);
    const distinct = e.wide ? `>${ENUM_CEILING}` : String(e.values.size);
    console.log(
      `| ${name} | ${e.present} | ${populated} (${pct}%) | ${[...e.types].join("/")} | ${distinct} |`,
    );
  }
  // Small value sets are the product's own vocabulary -- statuses, types, modes.
  const enums = rows.filter(([, e]) => !e.wide && e.values.size > 1 && e.values.size <= ENUM_CEILING);
  if (enums.length) {
    console.log(`\n### ${file.replace(".jsonl", "")} — enumerated vocabularies\n`);
    for (const [name, e] of enums) {
      console.log(`- **${name}**: ${[...e.values].sort().join(" · ")}`);
    }
  }
}
