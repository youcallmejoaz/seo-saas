import * as cheerio from "cheerio";

export interface CrawledPage {
  url: string;
  status: number;
  ms: number;
  redirectedTo: string | null;
  contentType: string | null;
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  canonical: string | null;
  robots: string | null;
  wordCount: number;
  imagesMissingAlt: number;
  internalLinks: string[];
  hasJsonLd: boolean;
  bytes: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  robotsTxt: { status: number; body: string } | null;
  sitemap: { status: number; urls: string[] } | null;
}

export interface CrawlOptions {
  startUrl: string;
  maxPages?: number;
  /** Rewrites a public URL to the URL actually fetched (used in local dev). */
  mapUrl?: (url: string) => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function normalise(u: URL): string {
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/$/, "") || u.origin;
}

export function parsePage(url: string, html: string): Omit<CrawledPage, "status" | "ms" | "redirectedTo" | "contentType" | "bytes"> {
  const $ = cheerio.load(html);
  const origin = new URL(url).origin;
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    if (/^(mailto|tel|javascript):/i.test(href) || href.startsWith("#")) return;
    try {
      const abs = new URL(href, url);
      if (abs.origin === origin) links.add(normalise(abs));
    } catch {
      /* ignore malformed hrefs */
    }
  });
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return {
    url,
    title: $("title").first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? null,
    h1s: $("h1").map((_, el) => $(el).text().trim()).get(),
    canonical: $('link[rel="canonical"]').attr("href") ?? null,
    robots: $('meta[name="robots"]').attr("content") ?? null,
    wordCount: text ? text.split(" ").length : 0,
    imagesMissingAlt: $("img").filter((_, el) => !($(el).attr("alt") ?? "").trim()).length,
    internalLinks: [...links],
    hasJsonLd: cheerio.load(html)('script[type="application/ld+json"]').length > 0,
  };
}

/** Breadth-first crawl of one host. Polite: sequential, capped, with timeouts. */
export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const f = opts.fetchImpl ?? fetch;
  const map = opts.mapUrl ?? ((u: string) => u);
  const max = opts.maxPages ?? 50;
  const timeout = opts.timeoutMs ?? 15_000;
  const start = normalise(new URL(opts.startUrl));
  const origin = new URL(start).origin;
  const queue = [start];
  const seen = new Set(queue);
  const pages: CrawledPage[] = [];

  const get = async (url: string, redirect: RequestRedirect = "manual") => {
    const t0 = Date.now();
    const res = await f(map(url), { redirect, signal: AbortSignal.timeout(timeout), headers: { "user-agent": "RankPilotAuditBot/1.0 (+site audit)" } });
    return { res, ms: Date.now() - t0 };
  };

  while (queue.length && pages.length < max) {
    const url = queue.shift()!;
    try {
      const { res, ms } = await get(url);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        const target = normalise(new URL(loc, url));
        pages.push({ url, status: res.status, ms, redirectedTo: target, contentType: null, title: null, metaDescription: null, h1s: [], canonical: null, robots: null, wordCount: 0, imagesMissingAlt: 0, internalLinks: [], hasJsonLd: false, bytes: 0 });
        if (new URL(target).origin === origin && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
        continue;
      }
      const type = res.headers.get("content-type");
      const body = type?.includes("text/html") ? await res.text() : "";
      const parsed = body ? parsePage(url, body) : { url, title: null, metaDescription: null, h1s: [], canonical: null, robots: null, wordCount: 0, imagesMissingAlt: 0, internalLinks: [], hasJsonLd: false };
      pages.push({ ...parsed, status: res.status, ms, redirectedTo: null, contentType: type, bytes: body.length });
      for (const link of parsed.internalLinks) {
        if (!seen.has(link) && !/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|xml|txt)$/i.test(link)) {
          seen.add(link);
          queue.push(link);
        }
      }
    } catch (err) {
      pages.push({ url, status: 0, ms: timeout, redirectedTo: null, contentType: null, title: null, metaDescription: null, h1s: [], canonical: null, robots: null, wordCount: 0, imagesMissingAlt: 0, internalLinks: [], hasJsonLd: false, bytes: 0 });
      void err;
    }
  }

  let robotsTxt: CrawlResult["robotsTxt"] = null;
  let sitemap: CrawlResult["sitemap"] = null;
  try {
    const { res } = await get(`${origin}/robots.txt`, "follow");
    robotsTxt = { status: res.status, body: res.ok ? (await res.text()).slice(0, 5000) : "" };
  } catch {
    robotsTxt = null;
  }
  try {
    const { res } = await get(`${origin}/sitemap.xml`, "follow");
    const xml = res.ok ? await res.text() : "";
    sitemap = { status: res.status, urls: [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim()) };
  } catch {
    sitemap = null;
  }
  return { pages, robotsTxt, sitemap };
}
