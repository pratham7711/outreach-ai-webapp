import { z } from "zod";

export type DeckMetric = { label: string; value: number | string };

export type DeckBlock = {
  kind: string;
  title: string;
  narrative?: string;
  metrics?: DeckMetric[];
};

export type DeckSection = {
  kind: string;
  title: string;
  narrative: string;
  metrics: DeckMetric[];
};

export type DeckCover = {
  title: string;
  subtitle?: string;
  sectionCount: number;
};

export type Deck = {
  cover: DeckCover;
  sections: DeckSection[];
};

export type AssembleDeckInput = {
  title: string;
  subtitle?: string;
  blocks: DeckBlock[];
  order?: string[];
};

export const KNOWN_SECTION_ORDER: readonly string[] = [
  "overview",
  "authenticity",
  "audience",
  "roi",
  "risks",
];

const deckMetricSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
});

const deckBlockSchema = z.object({
  kind: z.string(),
  title: z.string(),
  narrative: z.string().optional(),
  metrics: z.array(deckMetricSchema).optional(),
});

const assembleDeckInputSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  blocks: z.array(deckBlockSchema),
  order: z.array(z.string()).optional(),
});

function rankFor(kind: string, order: readonly string[]): number {
  const index = order.indexOf(kind);
  if (index < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return index;
}

function stableOrder(
  blocks: DeckBlock[],
  order: readonly string[],
): DeckBlock[] {
  const decorated = blocks.map((block, position) => ({ block, position }));
  decorated.sort((a, b) => {
    const rankA = rankFor(a.block.kind, order);
    const rankB = rankFor(b.block.kind, order);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.position - b.position;
  });
  return decorated.map((entry) => entry.block);
}

function toSection(block: DeckBlock): DeckSection {
  const metrics = Array.isArray(block.metrics)
    ? block.metrics.map((metric) => ({ label: metric.label, value: metric.value }))
    : [];
  return {
    kind: block.kind,
    title: block.title,
    narrative: typeof block.narrative === "string" ? block.narrative : "",
    metrics,
  };
}

export function assembleDeck(input: AssembleDeckInput): Deck {
  const parsed = assembleDeckInputSchema.parse(input);

  const order =
    parsed.order && parsed.order.length > 0 ? parsed.order : KNOWN_SECTION_ORDER;

  const ordered = stableOrder([...parsed.blocks], order);
  const sections = ordered.map(toSection);

  const cover: DeckCover = {
    title: parsed.title,
    sectionCount: sections.length,
  };
  if (typeof parsed.subtitle === "string") {
    cover.subtitle = parsed.subtitle;
  }

  return { cover, sections };
}

export function deckToPlainText(deck: Deck): string {
  const lines: string[] = [deck.cover.title];
  if (typeof deck.cover.subtitle === "string" && deck.cover.subtitle.length > 0) {
    lines.push(deck.cover.subtitle);
  }
  for (const section of deck.sections) {
    lines.push("");
    lines.push(section.title);
    if (section.narrative.length > 0) {
      lines.push(section.narrative);
    }
  }
  return lines.join("\n");
}
