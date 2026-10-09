import type { CrawlResult } from "./crawler";

export interface TechIssue {
  url: string;
  check: string;
  severity: "critical" | "warning" | "notice";
  message: string;
  autoFixable: boolean;
}

/** Technical SEO checks over a live crawl (complements the structured-content lint). */
export function technicalIssues(crawl: CrawlResult): TechIssue[] {
  const out: TechIssue[] = [];
  const add = (url: string, check: string, severity: TechIssue["severity"], message: string, autoFixable = false) => out.push({ url, check, severity, message, autoFixable });
  const ok = crawl.pages.filter((p) => p.status >= 200 && p.status < 300);
  const crawled = new Set(crawl.pages.map((p) => p.url));

  for (const p of crawl.pages) {
    if (p.status === 0) add(p.url, "unreachable", "critical", "Page could not be fetched (timeout or network error).");
    else if (p.status >= 500) add(p.url, "server_error", "critical", `Server error ${p.status}.`);
    else if (p.status === 404) add(p.url, "broken_page", "critical", "Linked page returns 404.");
    else if (p.status >= 400) add(p.url, "client_error", "warning", `Returns HTTP ${p.status}.`);
    if (p.redirectedTo && crawl.pages.find((x) => x.url === p.redirectedTo)?.redirectedTo) add(p.url, "redirect_chain", "warning", "Redirect chain (more than one hop).");
  }

  const titles = new Map<string, string[]>();
  for (const p of ok) {
    if (!p.title) add(p.url, "title_missing", "critical", "Missing <title>.", true);
    else titles.set(p.title, [...(titles.get(p.title) ?? []), p.url]);
    if (!p.metaDescription) add(p.url, "meta_missing", "warning", "Missing meta description.", true);
    if (p.h1s.length === 0) add(p.url, "h1_missing", "critical", "No <h1> on the page.", true);
    if (p.h1s.length > 1) add(p.url, "h1_multiple", "notice", `${p.h1s.length} <h1> elements.`);
    if (!p.canonical) add(p.url, "canonical_missing", "notice", "No canonical link.");
    if (p.robots?.includes("noindex")) add(p.url, "noindex", "warning", "Page is set to noindex.");
    if (p.imagesMissingAlt) add(p.url, "img_alt", "warning", `${p.imagesMissingAlt} image(s) without alt text.`, true);
    if (!p.hasJsonLd) add(p.url, "no_structured_data", "notice", "No JSON-LD structured data.");
    if (p.ms > 2500) add(p.url, "slow_response", "warning", `Slow server response (${(p.ms / 1000).toFixed(1)}s).`);
    if (p.wordCount < 200) add(p.url, "thin_content", "notice", `Low word count (${p.wordCount}).`);
  }
  for (const [title, urls] of titles) if (urls.length > 1) urls.forEach((u) => add(u, "duplicate_title", "warning", `Title "${title.slice(0, 60)}" is used on ${urls.length} pages.`, true));

  const origin = crawl.pages[0] ? new URL(crawl.pages[0].url).origin : "";
  if (!crawl.robotsTxt || crawl.robotsTxt.status !== 200) add(`${origin}/robots.txt`, "robots_missing", "warning", "robots.txt is missing.");
  else if (/^\s*Disallow:\s*\/\s*$/im.test(crawl.robotsTxt.body)) add(`${origin}/robots.txt`, "robots_blocks_all", "critical", "robots.txt blocks the whole site.");
  if (!crawl.sitemap || crawl.sitemap.status !== 200 || !crawl.sitemap.urls.length) add(`${origin}/sitemap.xml`, "sitemap_missing", "warning", "XML sitemap is missing or empty.");
  else {
    const missing = ok.filter((p) => !crawl.sitemap!.urls.some((u) => u.replace(/\/$/, "") === p.url.replace(/\/$/, "")) && !p.robots?.includes("noindex"));
    if (missing.length) add(`${origin}/sitemap.xml`, "sitemap_incomplete", "notice", `${missing.length} indexable page(s) are not in the sitemap.`);
  }
  void crawled;
  return out;
}

export function auditScore(issues: { severity: string }[], pages: number): number {
  const penalty = issues.reduce((s, i) => s + (i.severity === "critical" ? 10 : i.severity === "warning" ? 3 : 0.5), 0);
  return Math.max(0, Math.min(100, Math.round(100 - (penalty * 4) / Math.max(4, pages))));
}
