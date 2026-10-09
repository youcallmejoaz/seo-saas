import "server-only";
import { env } from "@/lib/env";

export interface PageSpeedResult {
  url: string;
  strategy: "mobile" | "desktop";
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
}

/** Lighthouse scores via the free PageSpeed Insights API (key optional, raises quota). */
export async function pageSpeed(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<PageSpeedResult | null> {
  if (/localhost|127\.0\.0\.1/.test(url)) return null;
  const p = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "seo", "accessibility"]) p.append("category", c);
  if (env().PAGESPEED_API_KEY) p.set("key", env().PAGESPEED_API_KEY!);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    lighthouseResult?: { categories?: Record<string, { score: number | null }>; audits?: Record<string, { numericValue?: number }> };
    loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
  };
  const cat = j.lighthouseResult?.categories ?? {};
  const audits = j.lighthouseResult?.audits ?? {};
  const score = (k: string) => (cat[k]?.score == null ? null : Math.round(cat[k]!.score! * 100));
  return {
    url,
    strategy,
    performance: score("performance"),
    seo: score("seo"),
    accessibility: score("accessibility"),
    lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    inpMs: j.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
  };
}
