import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLATFORM_FILTER_OPTIONS,
  PLATFORM_VALUES,
  isPlatform,
} from "@/lib/platforms/constants";
import { platformLabel } from "@/lib/format";

/** The Platform enum members, read straight from the schema. */
function schemaPlatforms(): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const block = schema.match(/enum Platform \{([^}]*)\}/);
  if (!block) throw new Error("Platform enum not found in schema.prisma");
  return block[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"));
}

describe("platform constants", () => {
  // The whole point of the shared constant: adding a platform to the Prisma enum
  // and forgetting this file used to mean every zod schema silently rejected it
  // and every filter silently omitted it. This fails loudly instead.
  it("covers exactly the Platform enum in schema.prisma", () => {
    expect([...PLATFORM_VALUES].sort()).toEqual(schemaPlatforms().sort());
  });

  it("offers a filter option for every platform, plus All", () => {
    const keys = PLATFORM_FILTER_OPTIONS.map((o) => o.key);
    expect(keys[0]).toBe("ALL");
    expect(keys.slice(1).sort()).toEqual([...PLATFORM_VALUES].sort());
  });

  it("gives every platform a human label rather than echoing the enum", () => {
    for (const p of PLATFORM_VALUES) {
      expect(platformLabel(p)).not.toBe(p);
    }
    expect(platformLabel("TWITTER")).toBe("X");
    expect(platformLabel("LINKEDIN")).toBe("LinkedIn");
  });

  it("narrows unknown values", () => {
    expect(isPlatform("TIKTOK")).toBe(true);
    expect(isPlatform("MYSPACE")).toBe(false);
    expect(isPlatform(null)).toBe(false);
  });
});
