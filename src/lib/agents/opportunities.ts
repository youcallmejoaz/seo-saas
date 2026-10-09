import type { BusinessInfo, TaskKind } from "@/lib/db/types";
import { pathForSlug, type PageState } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";
import { slugify } from "@/lib/utils";

export interface GscPageQuery {
  page: string; // URL
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface Opportunity {
  kind: TaskKind;
  title: string;
  description: string;
  priority: number;
  payload: { target_page: string | null; target_keyword: string | null; new_page_slug: string | null };
}

/** Typical organic CTR by rounded position; below ~half of this the snippet is underperforming. */
const EXPECTED_CTR = [0, 0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02];

export function expectedCtr(position: number): number {
  return EXPECTED_CTR[Math.min(10, Math.max(1, Math.round(position)))] ?? 0.015;
}

/**
 * Find SEO opportunities from Search Console data and the site structure. Pure and
 * deterministic: no AI needed to spot these, the AI is used to act on them.
 */
export function findOpportunities(input: { pages: PageState[]; rows: GscPageQuery[]; business: BusinessInfo }): Opportunity[] {
  const { pages, rows, business } = input;
  const out: Opportunity[] = [];
  const slugForUrl = (url: string) => {
    try {
      return new URL(url).pathname.replace(/^\//, "").replace(/\/$/, "");
    } catch {
      return null;
    }
  };

  // 1. Pages with impressions but a weak snippet.
  const byPage = new Map<string, { clicks: number; impressions: number; pos: number; topQuery: string; topImpr: number }>();
  for (const r of rows) {
    const slug = slugForUrl(r.page);
    if (slug === null) continue;
    const a = byPage.get(slug) ?? { clicks: 0, impressions: 0, pos: 0, topQuery: r.query, topImpr: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.pos += r.position * r.impressions;
    if (r.impressions > a.topImpr) {
      a.topImpr = r.impressions;
      a.topQuery = r.query;
    }
    byPage.set(slug, a);
  }
  for (const [slug, a] of byPage) {
    if (!pages.some((p) => p.slug === slug) || a.impressions < 100) continue;
    const pos = a.pos / a.impressions;
    const ctr = a.clicks / a.impressions;
    if (pos <= 10 && ctr < expectedCtr(pos) * 0.5)
      out.push({
        kind: "meta_optimize",
        title: `Improve click-through on ${pathForSlug(slug)}`,
        description: `${a.impressions} impressions at average position ${pos.toFixed(1)} but only ${(ctr * 100).toFixed(1)}% CTR (expected ~${(expectedCtr(pos) * 100).toFixed(0)}%). Rewrite the title/meta around "${a.topQuery}".`,
        priority: Math.min(95, 50 + Math.round(a.impressions / 50)),
        payload: { target_page: slug, target_keyword: a.topQuery, new_page_slug: null },
      });
  }

  // 2. Striking-distance queries (positions 8-20) worth expanding content for.
  const striking = rows
    .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 50)
    .sort((a, b) => b.impressions - a.impressions);
  const seenPages = new Set<string>();
  for (const r of striking) {
    const slug = slugForUrl(r.page);
    if (slug === null || seenPages.has(slug) || !pages.some((p) => p.slug === slug)) continue;
    seenPages.add(slug);
    out.push({
      kind: "content_expand",
      title: `Push "${r.query}" onto page one`,
      description: `${pathForSlug(slug)} ranks ${r.position.toFixed(1)} for "${r.query}" (${r.impressions} impressions). Expand the content and internal links for this query.`,
      priority: Math.min(90, 40 + Math.round(r.impressions / 20)),
      payload: { target_page: slug, target_keyword: r.query, new_page_slug: null },
    });
    if (seenPages.size >= 3) break;
  }

  // 3. Coverage gaps: services or locations without a page.
  const slugs = new Set(pages.map((p) => p.slug));
  for (const s of business.services) {
    const slug = slugify(s);
    if (!slugs.has(slug) && !pages.some((p) => p.type === "service" && p.target_keyword?.toLowerCase().includes(s.toLowerCase())))
      out.push({ kind: "new_service_page", title: `Create a page for ${s}`, description: `The business offers ${s} but has no dedicated page to rank for it.`, priority: 60, payload: { target_page: null, target_keyword: `${s} ${business.locations[0] ?? ""}`.trim().toLowerCase(), new_page_slug: slug } });
  }
  for (const l of business.locations) {
    const slug = `areas/${slugify(l)}`;
    if (!slugs.has(slug) && !pages.some((p) => p.slug.endsWith(slugify(l))))
      out.push({ kind: "new_location_page", title: `Create a ${l} location page`, description: `${l} is a served area without a landing page.`, priority: 55, payload: { target_page: null, target_keyword: `${(business.industry ?? business.services[0] ?? "").toLowerCase()} ${l.toLowerCase()}`.trim(), new_page_slug: slug } });
  }

  // 4. Structural on-page fixes the lint can see.
  const lint = lintSite(pages);
  const orphans = lint.filter((i) => i.check === "orphan_page");
  if (orphans.length)
    out.push({ kind: "internal_links", title: `Link to ${orphans.length} orphan page(s)`, description: `No pages link to: ${orphans.map((o) => pathForSlug(o.page)).join(", ")}.`, priority: 65, payload: { target_page: orphans[0]!.page, target_keyword: null, new_page_slug: null } });
  const metaIssues = lint.filter((i) => ["title_long", "title_short", "meta_short", "meta_long", "duplicate_title"].includes(i.check));
  const metaPages = [...new Set(metaIssues.map((i) => i.page))].filter((slug) => !out.some((o) => o.kind === "meta_optimize" && o.payload.target_page === slug));
  for (const slug of metaPages.slice(0, 3))
    out.push({ kind: "meta_optimize", title: `Fix title/meta on ${pathForSlug(slug)}`, description: metaIssues.filter((i) => i.page === slug).map((i) => i.message).join(" "), priority: 45, payload: { target_page: slug, target_keyword: null, new_page_slug: null } });

  return out.sort((a, b) => b.priority - a.priority);
}
