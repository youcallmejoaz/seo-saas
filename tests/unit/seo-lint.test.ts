import { describe, expect, it } from "vitest";
import { lintScore, lintSite } from "@/lib/site/seo-lint";
import { site } from "./fixtures";

describe("seo lint", () => {
  it("flags duplicate titles, long titles, broken links and orphans", () => {
    const pages = site();
    pages[2]!.title = pages[1]!.title;
    pages[1]!.title = "x".repeat(75);
    const intro = pages[2]!.blocks[1]!;
    if (intro.type === "rich_text") intro.paragraphs.push("See [this](/missing-page).");
    const checks = lintSite(pages).map((i) => `${i.page}:${i.check}`);
    expect(checks).toContain("emergency-plumbing:title_long");
    expect(checks).toContain("boiler-repair:broken_internal_link");
    expect(checks).toContain("boiler-repair:thin_content");
  });

  it("counts header/footer navigation as inbound links", () => {
    expect(lintSite(site()).filter((i) => i.check === "orphan_page")).toEqual([]);
  });

  it("scores between 0 and 100", () => {
    const s = lintScore(lintSite(site()), 4);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
