import { internalLinks, pageText, pathForSlug, wordCount, type PageState } from "./schema";

export type LintSeverity = "critical" | "warning" | "notice";

export interface LintIssue {
  page: string; // slug
  pageId?: string;
  check: string;
  severity: LintSeverity;
  message: string;
  /** True when a low-risk automated fix exists (meta/alt/link ops). */
  autoFixable: boolean;
}

const MIN_WORDS: Partial<Record<PageState["type"], number>> = {
  home: 300,
  service: 350,
  location: 300,
  service_location: 300,
  blog: 600,
};

/** On-page SEO checks over the structured site. Shared by the generator and audits. */
export function lintSite(pages: PageState[]): LintIssue[] {
  const live = pages.filter((p) => p.status !== "archived");
  const issues: LintIssue[] = [];
  const add = (p: PageState, check: string, severity: LintSeverity, message: string, autoFixable = false) =>
    issues.push({ page: p.slug, pageId: p.id, check, severity, message, autoFixable });

  const titles = new Map<string, PageState[]>();
  const h1s = new Map<string, PageState[]>();
  const inbound = new Map<string, number>();

  for (const p of live) {
    titles.set(p.title.toLowerCase(), [...(titles.get(p.title.toLowerCase()) ?? []), p]);
    h1s.set(p.h1.toLowerCase(), [...(h1s.get(p.h1.toLowerCase()) ?? []), p]);
    for (const target of internalLinks(p)) {
      if (target !== pathForSlug(p.slug)) inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }

  const slugs = new Set(live.map((p) => pathForSlug(p.slug)));

  for (const p of live) {
    if (p.title.length < 30) add(p, "title_short", "warning", `Title is ${p.title.length} characters (aim for 30–60).`, true);
    if (p.title.length > 60) add(p, "title_long", "warning", `Title is ${p.title.length} characters and may be truncated (aim for 30–60).`, true);
    if (p.meta_description.length < 70) add(p, "meta_short", "warning", `Meta description is ${p.meta_description.length} characters (aim for 70–160).`, true);
    if (p.meta_description.length > 160) add(p, "meta_long", "notice", `Meta description is ${p.meta_description.length} characters (aim for 70–160).`, true);
    if (!p.h1.trim()) add(p, "h1_missing", "critical", "Page has no H1.", true);

    const kw = p.target_keyword?.toLowerCase().trim();
    if (kw) {
      if (!p.title.toLowerCase().includes(kw) && !fuzzyIncludes(p.title, kw))
        add(p, "keyword_title", "warning", `Target keyword "${p.target_keyword}" is not in the title.`, true);
      if (!p.h1.toLowerCase().includes(kw) && !fuzzyIncludes(p.h1, kw))
        add(p, "keyword_h1", "notice", `Target keyword "${p.target_keyword}" is not in the H1.`, true);
    } else if (p.type !== "contact" && p.type !== "about") {
      add(p, "keyword_missing", "notice", "Page has no target keyword assigned.");
    }

    const words = wordCount(pageText(p));
    const min = MIN_WORDS[p.type];
    if (min && words < min) add(p, "thin_content", "warning", `Only ${words} words of content (aim for ${min}+).`);

    for (const b of p.blocks) {
      if (b.type === "image" && !b.alt.trim()) add(p, "img_alt", "warning", `Image "${b.id}" has no alt text.`, true);
      if (b.type === "hero" && b.image && !b.image.alt.trim()) add(p, "img_alt", "warning", `Hero image has no alt text.`, true);
    }

    for (const target of internalLinks(p)) {
      if (!slugs.has(target) && target !== "/") add(p, "broken_internal_link", "critical", `Links to ${target}, which does not exist.`);
    }

    if (p.status === "published" && p.type !== "home" && !inbound.get(pathForSlug(p.slug)))
      add(p, "orphan_page", "warning", "No other page links here (orphan page).", true);
    if (internalLinks(p).length === 0 && p.type !== "contact") add(p, "no_outlinks", "notice", "Page has no internal links.", true);
  }

  for (const [, group] of titles) if (group.length > 1) for (const p of group) add(p, "duplicate_title", "warning", "Title is shared with another page.", true);
  for (const [, group] of h1s) if (group.length > 1) for (const p of group) add(p, "duplicate_h1", "notice", "H1 is shared with another page.", true);

  return issues;
}

function fuzzyIncludes(haystack: string, keyword: string): boolean {
  const words = keyword.split(/\s+/).filter((w) => w.length > 2);
  const h = haystack.toLowerCase();
  return words.length > 0 && words.every((w) => h.includes(w.replace(/s$/, "")));
}

export function lintScore(issues: LintIssue[], pageCount: number): number {
  const penalty = issues.reduce((s, i) => s + (i.severity === "critical" ? 8 : i.severity === "warning" ? 3 : 1), 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty / Math.max(1, pageCount / 4))));
}
