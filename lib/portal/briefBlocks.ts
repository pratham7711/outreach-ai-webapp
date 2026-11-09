/**
 * The creative brief as plain blocks for the creator app.
 *
 * The agency writes the brief in a rich-text editor that stores HTML
 * (components/RichTextEditor.tsx saves editor.getHTML()), and the creator app
 * printed that string as text, so creators read "<p>Show the moment…</p>".
 * This turns it into paragraphs and list items without ever handing the
 * agency's markup to the DOM: tags are dropped, entities decoded, and the
 * result is rendered as text nodes. A brief typed before the editor existed
 * (plain text with newlines) comes out as one paragraph per line.
 */

export type BriefBlock = { kind: "p" | "li" | "h"; text: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 32);
    return m;
  });
}

function clean(text: string): string {
  return decode(text.replace(/<[^>]*>/g, "")).replace(/[ \t ]+/g, " ").trim();
}

export function briefBlocks(input: string | null | undefined): BriefBlock[] {
  const src = (input ?? "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").trim();
  if (!src) return [];
  if (!/<[a-z][\s\S]*>/i.test(src)) {
    return src
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ kind: "p" as const, text }));
  }
  const out: BriefBlock[] = [];
  /* Each list item, heading or paragraph is one block; a <br> inside one
     splits it. Anything outside those tags is read as a paragraph. */
  const re = /<(li|h[1-6]|p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushLoose = (chunk: string) => {
    for (const part of chunk.split(/<br\s*\/?>/i)) {
      const text = clean(part);
      if (text) out.push({ kind: "p", text });
    }
  };
  while ((m = re.exec(src))) {
    pushLoose(src.slice(last, m.index).replace(/<\/?(ul|ol)\b[^>]*>/gi, ""));
    const tag = m[1].toLowerCase();
    const kind: BriefBlock["kind"] = tag === "li" ? "li" : tag.startsWith("h") ? "h" : "p";
    for (const part of m[2].split(/<br\s*\/?>/i)) {
      const text = clean(part);
      if (text) out.push({ kind, text });
    }
    last = re.lastIndex;
  }
  pushLoose(src.slice(last).replace(/<\/?(ul|ol)\b[^>]*>/gi, ""));
  return out;
}
