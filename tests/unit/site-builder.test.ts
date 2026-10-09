import { describe, expect, it } from "vitest";
import { assemblePages, normalisePlan, planSite, repairMeta, stripBrokenLinks, strengthenLinking, writePage } from "@/lib/agents/site-builder";
import { memoryLogger } from "@/lib/runs";
import { blocks, internalLinks, pageContent } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";

const business = {
  name: "Brum Plumbing Co",
  industry: "plumbing",
  services: ["Emergency plumbing", "Boiler repair", "Bathroom installation"],
  locations: ["Birmingham", "Solihull", "Sutton Coldfield"],
  phone: "0121 555 0100",
  email: "hello@brumplumbing.test",
};

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("site builder (mock mode)", () => {
  it("plans, writes and links a complete, valid site", async () => {
    const log = memoryLogger();
    const plan = await planSite(log, business, null, 6);
    expect(plan.pages.filter((p) => p.type === "service")).toHaveLength(3);
    expect(plan.pages.filter((p) => p.type === "location")).toHaveLength(3);
    expect(plan.pages.some((p) => p.type === "home" && p.slug === "")).toBe(true);

    const contents = new Map();
    for (const p of plan.pages) contents.set(p.slug, await writePage(log, business, plan, p));
    let pages = assemblePages(plan, contents, newId);
    pages = stripBrokenLinks(strengthenLinking(pages, plan.pages));
    pages = await repairMeta(log, business, pages);

    for (const p of pages) {
      expect(pageContent.safeParse(p).success, `page /${p.slug} valid`).toBe(true);
      expect(blocks.safeParse(p.blocks).success).toBe(true);
    }
    const home = pages.find((p) => p.type === "home")!;
    const homeLinks = internalLinks(home);
    for (const s of pages.filter((p) => p.type === "service")) expect(homeLinks).toContain(`/${s.slug}`);

    const published = pages.map((p) => ({ ...p, status: "published" as const }));
    const critical = lintSite(published).filter((i) => i.severity === "critical");
    expect(critical).toEqual([]);
    expect(lintSite(published).filter((i) => i.check === "orphan_page")).toEqual([]);
    expect(log.usage.length).toBeGreaterThan(0);
  });

  it("normalises bad slugs and duplicate pages", () => {
    const plan = normalisePlan({
      theme: { primary: "blue", accent: "#ffcc00", font: "sans", logoText: "X" },
      pages: [
        { slug: "Emergency Plumbing!", type: "service", title: "t", h1: "h", meta_description: "m", target_keyword: "k", brief: "" },
        { slug: "emergency-plumbing", type: "service", title: "t", h1: "h", meta_description: "m", target_keyword: "k", brief: "" },
      ],
    });
    expect(plan.pages.map((p) => p.slug)).toEqual(["emergency-plumbing", "emergency-plumbing-2", "", "contact", "about"]);
    expect(plan.theme.primary).toBe("#1d4ed8");
  });
});
