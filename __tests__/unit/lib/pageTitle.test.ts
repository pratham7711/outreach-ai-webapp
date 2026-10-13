import fs from "fs";
import path from "path";
import { sectionTitle, PAGE_TITLE_TEMPLATE } from "@/lib/ui/pageTitle";
import { BRAND } from "@/lib/brand";

describe("sectionTitle", () => {
  it("names the section and hands the product suffix on to its pages", () => {
    expect(sectionTitle("Campaigns")).toEqual({ default: "Campaigns", template: `%s · ${BRAND.name}` });
    expect(PAGE_TITLE_TEMPLATE.replace("%s", "Campaigns")).toBe(`Campaigns · ${BRAND.name}`);
  });
});

/* Every tab used to read only the product name. A new top-level section
   without a layout of its own would quietly go back to that, so each one has
   to name itself. */
describe("dashboard sections", () => {
  const root = path.join(process.cwd(), "app", "(dashboard)");
  const sections = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("("))
    .map((d) => d.name);

  it.each(sections)("%s has a layout that titles it", (name) => {
    const file = path.join(root, name, "layout.tsx");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toMatch(/title:\s*sectionTitle\("[^"]+"\)/);
  });
});
