import { z } from "zod";
import { generateJson } from "@/lib/ai";
import type { BusinessInfo, Theme } from "@/lib/db/types";
import type { RunLogger } from "@/lib/runs";
import { blocks as blocksSchema, pageTypes, pathForSlug, type Block, type PageState } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";
import { slugify } from "@/lib/utils";
import { mockPageBlocks, mockSitePlan } from "./mocks";

// ---------------------------------------------------------------------------
// 1. Plan the site structure
// ---------------------------------------------------------------------------

export const pagePlan = z.object({
  slug: z.string().describe("URL path without leading slash; '' for the home page; lowercase-hyphenated"),
  type: z.enum(pageTypes),
  title: z.string().describe("SEO title tag, 30-60 characters, primary keyword first, brand last"),
  h1: z.string().describe("Visible page heading containing the target keyword"),
  meta_description: z.string().describe("70-155 characters, includes keyword and a call to action"),
  target_keyword: z.string().describe("Primary search phrase this page should rank for"),
  service: z.string().optional().describe("Service this page is about, if any"),
  location: z.string().optional().describe("Location this page targets, if any"),
  brief: z.string().describe("2-3 sentences: search intent, angle and key points for the writer"),
});
export type PagePlan = z.infer<typeof pagePlan>;

export const sitePlan = z.object({
  theme: z.object({
    primary: z.string().describe("Brand colour as #rrggbb, dark enough for white text"),
    accent: z.string().describe("Accent colour as #rrggbb for buttons, readable with dark text"),
    font: z.enum(["sans", "serif"]),
    logoText: z.string(),
  }),
  pages: z.array(pagePlan).min(3).max(40),
});
export type SitePlan = z.infer<typeof sitePlan>;

const SYSTEM = `You are a senior local-SEO strategist and conversion copywriter who builds small-business websites.
Principles: one clear search intent per page; no keyword cannibalisation (each page targets a distinct phrase);
service pages and location pages for local pack visibility; honest, specific copy (never invent awards, prices,
licences, years in business or reviews that were not provided); spelling and terminology that match the
business's country; concise sentences; strong calls to action.`;

export async function planSite(log: RunLogger, business: BusinessInfo, instructions: string | null, maxServiceLocationPages = 12): Promise<SitePlan> {
  await log.log("step", "Planning site structure and target keywords");
  const { data } = await generateJson(log, {
    purpose: "site_plan",
    tier: "planner",
    system: SYSTEM,
    schema: sitePlan,
    prompt: `Plan the page structure for this business website.

Business: ${JSON.stringify(business, null, 2)}
Extra instructions from the agency: ${instructions || "none"}

Required pages:
- home (slug ""), about ("about"), contact ("contact")
- one "service" page per service (slug = service name, e.g. "emergency-plumbing")
- one "location" page per location (slug = "areas/<location>")
- up to ${maxServiceLocationPages} "service_location" pages combining the most valuable services with the primary location(s)
  (slug = "<service>-<location>", e.g. "boiler-repair-manchester")
Choose realistic target keywords people actually search (e.g. "emergency plumber birmingham").
Pick a brand colour palette that suits the industry.`,
    mock: () => mockSitePlan(business, maxServiceLocationPages),
  });
  return normalisePlan(data);
}

/** Make slugs valid and unique, and guarantee the structural pages exist. */
export function normalisePlan(plan: SitePlan): SitePlan {
  const seen = new Set<string>();
  const pages: PagePlan[] = [];
  for (const p of plan.pages) {
    let slug = p.type === "home" ? "" : p.slug.split("/").map(slugify).filter(Boolean).join("/");
    if (p.type !== "home" && !slug) slug = slugify(p.h1 || p.title);
    if (p.type === "home" && seen.has("")) continue;
    while (seen.has(slug)) slug = `${slug}-2`;
    seen.add(slug);
    pages.push({ ...p, slug });
  }
  // One page per target keyword: duplicates would compete with each other in Google.
  const keywords = new Set<string>();
  for (const p of pages) {
    const kw = p.target_keyword.toLowerCase().trim();
    if (!kw) continue;
    if (keywords.has(kw)) {
      const qualifier = (p.type === "location" ? "areas" : p.service ?? p.slug.split("/").pop() ?? "").toLowerCase();
      const alt = `${kw} ${qualifier}`.trim();
      p.target_keyword = qualifier && !keywords.has(alt) ? alt : "";
    }
    if (p.target_keyword) keywords.add(p.target_keyword.toLowerCase().trim());
  }
  const ensure = (type: PagePlan["type"], slug: string, title: string) => {
    if (!pages.some((p) => p.type === type))
      pages.push({ slug, type, title, h1: title, meta_description: `${title}. Get in touch today to find out how we can help you.`, target_keyword: "", brief: "" });
  };
  ensure("home", "", "Home");
  ensure("contact", "contact", "Contact us");
  ensure("about", "about", "About us");
  const hex = /^#[0-9a-fA-F]{6}$/;
  return {
    theme: {
      ...plan.theme,
      primary: hex.test(plan.theme.primary) ? plan.theme.primary : "#1d4ed8",
      accent: hex.test(plan.theme.accent) ? plan.theme.accent : "#f59e0b",
    },
    pages,
  };
}

// ---------------------------------------------------------------------------
// 2. Write each page as typed blocks
// ---------------------------------------------------------------------------

export const BLOCK_GUIDE = `Available blocks (each needs a short unique "id" like "hero", "intro", "faq"):
- hero {heading (tagline, not the H1), subheading, ctaText, ctaHref}
- rich_text {heading?, paragraphs[], bullets?[]} — main copy. Inline links use markdown: [anchor text](/path)
- services_grid {heading, items[{title, description, href?}]}
- features {heading, items[{title, description}]} — reasons to choose us
- faq {heading, items[{question, answer}]} — real questions people search
- testimonials — ONLY if testimonials were provided; never invent reviews
- areas_served {heading, areas[{name, href?}]}
- cta {heading, text, buttonText, buttonHref}
- contact_form {heading, text}`;

const pageBlocksSchema = z.object({ blocks: blocksSchema });

export async function writePage(log: RunLogger, business: BusinessInfo, plan: SitePlan, page: PagePlan): Promise<Block[]> {
  const linkTargets = plan.pages
    .filter((p) => p.slug !== page.slug)
    .map((p) => `${pathForSlug(p.slug)} — ${p.h1} (${p.type})`)
    .join("\n");
  const minWords = page.type === "home" ? 450 : page.type === "service" ? 550 : page.type.includes("location") ? 450 : page.type === "contact" ? 80 : 250;
  const { data } = await generateJson(log, {
    purpose: "page_copy",
    tier: "fast",
    system: SYSTEM,
    schema: pageBlocksSchema,
    temperature: 0.7,
    prompt: `Write the content for one page of ${business.name}'s website.

Business facts (use only these facts): ${JSON.stringify(business)}
Page: ${JSON.stringify(page)}

${BLOCK_GUIDE}

Requirements:
- Start with a hero block. End with a cta block (or contact_form on the contact page).
- At least ${minWords} words of genuinely useful copy, mentioning "${page.target_keyword}" naturally (no stuffing).
- Include 2-4 contextual internal links inside rich_text paragraphs using ONLY these paths:
${linkTargets}
- Service pages: explain the service, process, what's included, why choose us, and an FAQ (4-6 items).
- Location pages: local relevance, services available in the area (link to them), areas served, FAQ.
- Home: overview, services_grid linking every service page, reasons to choose us, areas_served linking location pages.
- Contact page: short intro and a contact_form block with phone/email/address details in rich_text.`,
    mock: () => ({ blocks: mockPageBlocks(business, plan, page) }),
  });
  return data.blocks;
}

// ---------------------------------------------------------------------------
// 3. Deterministic internal linking + structural fixes
// ---------------------------------------------------------------------------

/** Ensure hub-and-spoke linking: home -> services/areas, service <-> location pages. */
export function strengthenLinking(pages: PageState[], plans: PagePlan[]): PageState[] {
  const bySlug = new Map(plans.map((p) => [p.slug, p]));
  const services = pages.filter((p) => p.type === "service");
  const locations = pages.filter((p) => p.type === "location");
  const combos = pages.filter((p) => p.type === "service_location");
  const pageHref = (p: PageState) => pathForSlug(p.slug);

  for (const page of pages) {
    const plan = bySlug.get(page.slug);
    if (page.type === "home") {
      const grid = page.blocks.find((b) => b.type === "services_grid");
      if (grid && grid.type === "services_grid") {
        for (const s of services) {
          const item = grid.items.find((i) => i.title.toLowerCase() === (bySlug.get(s.slug)?.service ?? s.h1).toLowerCase() || i.href === pageHref(s));
          if (item) item.href = pageHref(s);
          else grid.items.push({ title: bySlug.get(s.slug)?.service ?? s.h1, description: s.meta_description, href: pageHref(s) });
        }
      } else if (services.length) {
        insertBeforeCta(page, { id: "services", type: "services_grid", heading: "Our services", items: services.map((s) => ({ title: bySlug.get(s.slug)?.service ?? s.h1, description: s.meta_description, href: pageHref(s) })) });
      }
      upsertAreas(page, locations, "Areas we cover");
    }
    if (page.type === "service") {
      const related = combos.filter((c) => bySlug.get(c.slug)?.service && bySlug.get(c.slug)?.service === plan?.service);
      if (related.length) upsertAreas(page, related, `${plan?.service ?? page.h1} near you`, (c) => bySlug.get(c.slug)?.location ?? c.h1);
      else upsertAreas(page, locations, "Areas we cover");
    }
    if (page.type === "location") {
      const related = combos.filter((c) => bySlug.get(c.slug)?.location && bySlug.get(c.slug)?.location === plan?.location);
      const targets = related.length ? related : services;
      if (targets.length && !page.blocks.some((b) => b.type === "services_grid"))
        insertBeforeCta(page, {
          id: "local-services",
          type: "services_grid",
          heading: `Services in ${plan?.location ?? "your area"}`,
          items: targets.map((t) => ({ title: bySlug.get(t.slug)?.service ?? t.h1, description: t.meta_description, href: pageHref(t) })),
        });
    }
    if (page.type === "service_location") {
      const svc = services.find((s) => bySlug.get(s.slug)?.service === plan?.service);
      const loc = locations.find((l) => bySlug.get(l.slug)?.location === plan?.location);
      const text = page.blocks.find((b) => b.type === "rich_text");
      if (text && text.type === "rich_text") {
        const links = [svc && `[${bySlug.get(svc.slug)?.service ?? svc.h1}](${pageHref(svc)})`, loc && `[other services in ${bySlug.get(loc.slug)?.location}](${pageHref(loc)})`].filter(Boolean);
        const joined = text.paragraphs.join(" ");
        const missing = links.filter((l) => !joined.includes(l!.slice(l!.indexOf("]("))));
        if (missing.length) text.paragraphs.push(`Find out more about our ${missing.join(" and ")}.`);
      }
    }
  }
  return pages;
}

function insertBeforeCta(page: PageState, block: Block) {
  if (page.blocks.some((b) => b.id === block.id)) return;
  const ctaIdx = page.blocks.findIndex((b) => b.type === "cta" || b.type === "contact_form");
  page.blocks.splice(ctaIdx >= 0 ? ctaIdx : page.blocks.length, 0, block);
}

function upsertAreas(page: PageState, targets: PageState[], heading: string, name: (p: PageState) => string = (p) => p.h1) {
  if (!targets.length) return;
  const areas = targets.map((t) => ({ name: name(t), href: pathForSlug(t.slug) }));
  const existing = page.blocks.find((b) => b.type === "areas_served");
  if (existing && existing.type === "areas_served") {
    for (const a of areas) {
      const match = existing.areas.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
      if (match) match.href = a.href;
      else existing.areas.push(a);
    }
  } else {
    insertBeforeCta(page, { id: "areas", type: "areas_served", heading, areas });
  }
}

/** Remove links to paths that don't exist (models occasionally invent them). */
export function stripBrokenLinks(pages: PageState[]): PageState[] {
  const valid = new Set(pages.map((p) => pathForSlug(p.slug)));
  const fix = (s: string) => s.replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, (m, anchor: string, path: string) => (valid.has(path.split("#")[0]!.replace(/\/$/, "") || "/") ? m : anchor));
  for (const p of pages) {
    for (const b of p.blocks) {
      if (b.type === "rich_text") {
        b.paragraphs = b.paragraphs.map(fix);
        if (b.bullets) b.bullets = b.bullets.map(fix);
      }
      if (b.type === "faq") b.items.forEach((i) => (i.answer = fix(i.answer)));
      if ((b.type === "services_grid") ) b.items.forEach((i) => { if (i.href?.startsWith("/") && !valid.has(i.href)) delete i.href; });
      if (b.type === "areas_served") b.areas.forEach((a) => { if (a.href?.startsWith("/") && !valid.has(a.href)) delete a.href; });
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// 4. Metadata repair from lint results
// ---------------------------------------------------------------------------

const metaFixes = z.object({
  pages: z.array(z.object({ slug: z.string(), title: z.string(), meta_description: z.string() })),
});

export async function repairMeta(log: RunLogger, business: BusinessInfo, pages: PageState[]): Promise<PageState[]> {
  const issues = lintSite(pages).filter((i) => ["title_short", "title_long", "meta_short", "meta_long", "duplicate_title", "keyword_title"].includes(i.check));
  if (!issues.length) return pages;
  const slugs = [...new Set(issues.map((i) => i.page))];
  await log.log("step", `Fixing titles/meta descriptions on ${slugs.length} page(s)`, { issues: issues.map((i) => `${i.page}: ${i.message}`) });
  const targets = pages.filter((p) => slugs.includes(p.slug));
  const { data } = await generateJson(log, {
    purpose: "meta_repair",
    tier: "fast",
    schema: metaFixes,
    prompt: `Rewrite these title tags and meta descriptions for ${business.name}.
Rules: title 30-60 characters with the target keyword near the start and "| ${business.name}" at the end if it fits;
meta description 120-155 characters with the keyword and a call to action; every title unique.
Problems found: ${JSON.stringify(issues.map((i) => ({ page: i.page, problem: i.message })))}
Pages: ${JSON.stringify(targets.map((p) => ({ slug: p.slug, title: p.title, meta_description: p.meta_description, target_keyword: p.target_keyword, h1: p.h1 })))}`,
    mock: () => ({ pages: targets.map((p) => ({ slug: p.slug, ...fitMeta(p, business.name) })) }),
  });
  for (const fix of data.pages) {
    const p = pages.find((x) => x.slug === fix.slug);
    if (!p) continue;
    if (fix.title.length >= 20 && fix.title.length <= 70) p.title = fix.title;
    if (fix.meta_description.length >= 50 && fix.meta_description.length <= 170) p.meta_description = fix.meta_description;
  }
  return pages;
}

/** Deterministic title/meta fitting, used by the mock and as a last-resort clamp. */
export function fitMeta(p: Pick<PageState, "title" | "meta_description" | "h1" | "target_keyword">, brand: string) {
  const base = (p.target_keyword ? capitalise(p.target_keyword) : p.h1).slice(0, 45);
  let title = `${base} | ${brand}`;
  if (title.length > 60) title = base.slice(0, 60);
  if (title.length < 30) title = `${base} | ${brand} – Local Experts`.slice(0, 60);
  let meta = p.meta_description;
  if (meta.length < 70) meta = `${meta.replace(/\.?$/, ".")} Friendly, reliable local service from ${brand}. Call today for a free quote.`;
  if (meta.length > 160) meta = `${meta.slice(0, 156).replace(/\s+\S*$/, "")}…`;
  return { title, meta_description: meta };
}

function capitalise(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Orchestration (pure aside from the AI calls; persistence lives in the Inngest fn)
// ---------------------------------------------------------------------------

export function assemblePages(plan: SitePlan, contents: Map<string, Block[]>, newId: () => string): PageState[] {
  return plan.pages.map((p) => ({
    id: newId(),
    slug: p.slug,
    type: p.type,
    title: p.title.slice(0, 70),
    meta_description: p.meta_description.slice(0, 170),
    h1: p.h1.slice(0, 120),
    target_keyword: p.target_keyword || null,
    blocks: contents.get(p.slug) ?? [],
    status: "draft",
    noindex: false,
    version: 1,
  }));
}

export function themeFrom(plan: SitePlan): Theme {
  return plan.theme;
}
