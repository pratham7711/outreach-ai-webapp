/**
 * A Prisma client on a fake pg pool, for tests that need the SQL Prisma really
 * sends rather than a mock's idea of it.
 *
 * Every statement is recorded in `fake.sql`. SELECTs are answered from
 * `fake.tables` (rows keyed by column name; WHERE is not evaluated, so a
 * fixture holds exactly the rows a statement should find), INSERT ... RETURNING
 * stores and echoes the inserted row, and UPDATE sets its columns on every
 * fixture row of the table. Column types come from the schema, so rows come
 * back typed the way Postgres would type them.
 *
 * `songLinkColumns: false` is a database from before Song.spotifyTrackId and
 * Song.instagramSoundId (lib/songs/songLinkDdl.ts): a statement naming either
 * fails as Postgres fails it, 42703 "column does not exist", and is also kept
 * in `fake.refused`.
 */
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/lib/generated/prisma";

export type Row = Record<string, unknown>;
export type FakePg = {
  sql: string[];
  refused: string[];
  tables: Record<string, Row[]>;
  reset(tables: Record<string, Row[]>): void;
};

/**
 * The statement names one of the Song table's link columns. spotifyTrackId is
 * also a SongStreamSnapshot column, so only Song's counts; instagramSoundId is
 * Song's alone, however Prisma aliases it.
 */
export function namesSongLinkColumn(sql: string): boolean {
  return (
    sql.includes(`"Song"."spotifyTrackId"`) ||
    sql.includes(`"instagramSoundId"`) ||
    (/^\s*(INSERT INTO|UPDATE)\s+"public"\."Song"\s/i.test(sql) && sql.includes(`"spotifyTrackId"`))
  );
}

export function createFakePgDb(options: { songLinkColumns: boolean }) {
  /* Column types from the schema itself, so a fixture row is handed back the
     way Postgres would type it. */
  const OID: Record<string, number> = { String: 25, Int: 23, BigInt: 20, Float: 701, Decimal: 1700, Boolean: 16, DateTime: 1184, Json: 3802 };
  const columnType = new Map<string, number>();
  for (const model of Prisma.dmmf.datamodel.models) {
    for (const field of model.fields) {
      if (field.kind === "object") continue;
      const oid = field.kind === "enum" ? 25 : OID[field.type] ?? 25;
      columnType.set(`${model.dbName ?? model.name}.${field.dbName ?? field.name}`, field.isList ? 1009 : oid);
    }
  }

  const fake: FakePg = {
    sql: [],
    refused: [],
    tables: {},
    reset(tables) {
      fake.sql = [];
      fake.refused = [];
      fake.tables = tables;
    },
  };


  /** Splits a select list at top-level commas. */
  function splitTop(list: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quoted = false;
    let cur = "";
    for (const ch of list) {
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === "(") depth++;
      if (!quoted && ch === ")") depth--;
      if (!quoted && depth === 0 && ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /** The text inside the parenthesis that opens at `open`. */
  function balanced(text: string, open: number): string {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++;
      if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
    }
    return text.slice(open + 1);
  }

  /** Output columns: [name, table, column] for each item of a select or returning list. */
  function outputColumns(list: string): { name: string; table: string | null; column: string | null; expr: string }[] {
    return splitTop(list).map((raw) => {
      const item = raw.replace(/::text\b/g, "");
      const alias = /\s+AS\s+"([^"]+)"\s*$/i.exec(item);
      const ref = /"(\w+)"\."(\w+)"\s*(?:AS\s+"[^"]+")?\s*$/i.exec(item);
      const qualified = /"public"\."(\w+)"\."(\w+)"/.exec(item);
      const name = alias ? alias[1] : ref ? ref[2] : item;
      return { name, table: qualified ? qualified[1] : null, column: qualified ? qualified[2] : ref ? ref[2] : null, expr: item };
    });
  }

  function encode(value: unknown, oid: number): unknown {
    if (value === null || value === undefined) return null;
    if (oid === 1184) return value instanceof Date ? value.toISOString() : String(value);
    if (oid === 3802) return typeof value === "string" ? value : JSON.stringify(value);
    if (oid === 20 || oid === 1700) return String(value);
    return value;
  }

  function answer(sql: string, values: unknown[]) {
    const empty = { command: "SELECT", fields: [], rows: [], rowCount: 0 };
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET|SAVEPOINT|RELEASE)/i.test(sql)) return empty;

    const insert = /^\s*INSERT INTO "public"\."(\w+)"\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(sql);
    if (insert) {
      const [head, table, colList] = insert;
      const valueList = balanced(sql, head.length - 1);
      const returning = /RETURNING\s+([\s\S]+)$/i.exec(sql.slice(head.length + valueList.length))?.[1] ?? "";
      const cols = colList.split(",").map((c) => c.trim().replace(/"/g, ""));
      const params = splitTop(valueList);
      const row: Row = {};
      cols.forEach((c, i) => {
        const p = /\$(\d+)/.exec(params[i] ?? "");
        row[c] = p ? values[Number(p[1]) - 1] : null;
      });
      row.id ??= `${table.toLowerCase()}-new`;
      (fake.tables[table] ??= []).push(row);
      return rowsFor(table, [row], returning);
    }

    /* WHERE is not evaluated anywhere here: a fixture holds the rows a
       statement is meant to find, so an UPDATE sets every row of its table. */
    const update = /^\s*UPDATE "public"\."(\w+)"\s+SET\s+([\s\S]*?)(?:\s+WHERE\s[\s\S]*?)?(?:\s+RETURNING\s+([\s\S]+))?$/i.exec(sql);
    if (update) {
      const [, table, set, returning] = update;
      const rows = fake.tables[table] ?? [];
      for (const [, col, n] of set.matchAll(/"(\w+)"\s*=\s*(?:CAST\()?\$(\d+)/g)) {
        for (const row of rows) row[col] = values[Number(n) - 1];
      }
      return returning ? rowsFor(table, rows, returning) : { command: "UPDATE", fields: [], rows: [], rowCount: rows.length };
    }
    if (/^\s*DELETE/i.test(sql)) return { command: "DELETE", fields: [], rows: [], rowCount: 0 };

    const count = /^\s*SELECT COUNT\(\*\) AS "([^"]+)" FROM \(SELECT [\s\S]*? FROM "public"\."(\w+)"/i.exec(sql);
    if (count) {
      const [, name, table] = count;
      return { command: "SELECT", fields: [{ name, dataTypeID: 20 }], rows: [[String((fake.tables[table] ?? []).length)]], rowCount: 1 };
    }
    const select = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s+"public"\."(\w+)"/i.exec(sql);
    if (select) {
      const [, list, table] = select;
      return rowsFor(table, fake.tables[table] ?? [], list);
    }
    return empty;
  }

  function rowsFor(table: string, rows: Row[], list: string) {
    const cols = outputColumns(list);
    /* A relation count arrives as COALESCE(<joined count>, 0); this database
       has no rows behind any of them. */
    const isCount = (c: { expr: string }) => /^COALESCE\(/i.test(c.expr);
    const fields = cols.map((c) => ({
      name: c.name,
      dataTypeID: isCount(c) ? 20 : columnType.get(`${c.table ?? table}.${c.column}`) ?? 25,
    }));
    return {
      command: "SELECT",
      fields,
      rows: rows.map((r) => cols.map((c, i) => (isCount(c) ? "0" : encode(c.column ? r[c.column] : null, fields[i].dataTypeID)))),
      rowCount: rows.length,
    };
  }

  async function query(q: { text: string; values?: unknown[] } | string, values?: unknown[]) {
    const sql = typeof q === "string" ? q : q.text;
    const args = (typeof q === "string" ? values : q.values ?? values) ?? [];
    fake.sql.push(sql);
    if (!options.songLinkColumns && namesSongLinkColumn(sql)) {
      fake.refused.push(sql);
      const column = sql.includes(`"instagramSoundId"`) ? "instagramSoundId" : "spotifyTrackId";
      throw Object.assign(new Error(`column Song.${column} does not exist`), { code: "42703", severity: "ERROR" });
    }
    return answer(sql, args);
  }

  /* A real Pool, so the adapter takes it as one, that never opens a socket:
     both ways in -- pool.query and a transaction's checked-out client -- are
     answered by query() above. */
  const pool = new pg.Pool({ max: 1 });
  Object.assign(pool, {
    query,
    connect: async () => ({ query, on() {}, removeListener() {}, release() {} }),
  });

  return { db: new PrismaClient({ adapter: new PrismaPg(pool as never) }), fake };
}
