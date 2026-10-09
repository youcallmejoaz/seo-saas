import "server-only";
import { z } from "zod";
import { generateJson } from "@/lib/ai";
import { parsePage } from "@/lib/audit/crawler";
import type { Client, Site } from "@/lib/db/types";
import { dataForSeoConfigured, searchVolumes, serp } from "@/lib/integrations/dataforseo";
import type { RunLogger } from "@/lib/runs";
import { adminClient } from "@/lib/supabase/admin";
import { daysAgo, errorMessage, isoDate } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Keyword research: real demand from Search Console + search-grounded AI ideas,
// upgraded with real volumes from DataForSEO when configured.
// ---------------------------------------------------------------------------

const keywordIdeas = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(2).max(120),
        intent: z.enum(["informational", "commercial", "transactional", "navigational", "local"]),
        difficulty_estimate: z.number().int().min(0).max(100),
        monthly_volume_estimate: z.number().int().min(0).max(1_000_000),
        rationale: z.string().max(300),
      }),
    )
    .min(1)
    .max(40),
});

export interface ResearchedKeyword {
  keyword: string;
  intent: string;
  difficulty: number | null;
  volume: number | null;
  isEstimate: boolean;
  source: "gsc" | "ai_estimate" | "dataforseo";
  impressions?: number;
  position?: number;
}

export async function keywordResearch(
  log: RunLogger,
  input: { client: Client; site: Site; goal: string; seeds: string[]; location: string },
): Promise<ResearchedKeyword[]> {
  const db = adminClient();
  await log.log("step", `Researching keywords for "${input.goal}" in ${input.location}`);

  const { data: gsc } = await db.rpc("client_top_queries", { p_client: input.client.id, p_from: isoDate(daysAgo(90)), p_to: isoDate(new Date()), p_limit: 60 });
  const gscRows = (gsc ?? []) as { query: string; clicks: number; impressions: number; avg_position: number }[];

  const { data } = await generateJson(log, {
    purpose: "keyword_research",
    tier: "fast",
    search: true,
    schema: keywordIdeas,
    prompt: `You are doing local keyword research for ${input.site.business.name} (${input.site.business.industry ?? input.client.industry}).
Services: ${input.site.business.services.join(", ")}. Target location: ${input.location}.
Campaign goal: ${input.goal}. Seed keywords: ${input.seeds.join(", ") || "none"}.
Queries the site already gets impressions for (Search Console): ${gscRows.slice(0, 30).map((r) => `${r.query} (pos ${Number(r.avg_position).toFixed(1)}, ${r.impressions} impr)`).join("; ") || "none yet"}.

Search Google to see what people actually search and what currently ranks. Return 15-30 keywords that a local
business could realistically rank for, prioritising high purchase intent ("near me", "emergency", "cost",
service + town). Volumes and difficulty are your best estimates; they will be labelled as estimates.`,
    mock: () => ({
      keywords: [...input.seeds, ...input.site.business.services.map((s) => `${s} ${input.location}`)].slice(0, 12).map((k, i) => ({
        keyword: k.toLowerCase(),
        intent: i % 3 === 0 ? ("transactional" as const) : ("local" as const),
        difficulty_estimate: 25 + ((i * 7) % 40),
        monthly_volume_estimate: 50 + ((i * 37) % 400),
        rationale: "Mock estimate",
      })),
    }),
  });

  const byKey = new Map<string, ResearchedKeyword>();
  for (const k of data.keywords) {
    byKey.set(k.keyword.toLowerCase().trim(), { keyword: k.keyword.toLowerCase().trim(), intent: k.intent, difficulty: k.difficulty_estimate, volume: k.monthly_volume_estimate, isEstimate: true, source: "ai_estimate" });
  }
  for (const r of gscRows) {
    const key = r.query.toLowerCase();
    const prev = byKey.get(key);
    byKey.set(key, { keyword: key, intent: prev?.intent ?? "local", difficulty: prev?.difficulty ?? null, volume: prev?.volume ?? null, isEstimate: prev?.isEstimate ?? true, source: prev ? prev.source : "gsc", impressions: Number(r.impressions), position: Number(r.avg_position) });
  }

  if (dataForSeoConfigured()) {
    try {
      const metrics = await searchVolumes([...byKey.keys()], input.location);
      for (const m of metrics) {
        const k = byKey.get(m.keyword.toLowerCase());
        if (k && m.search_volume !== null) Object.assign(k, { volume: m.search_volume, difficulty: m.competition_index ?? k.difficulty, isEstimate: false, source: "dataforseo" });
      }
      await log.log("step", `Fetched real search volumes for ${metrics.length} keywords`);
    } catch (err) {
      await log.log("step", `Search volume lookup failed, keeping estimates: ${errorMessage(err)}`, null, "warn");
    }
  }

  const list = [...byKey.values()];
  await db.from("keywords").upsert(
    list.map((k) => ({
      client_id: input.client.id,
      keyword: k.keyword,
      location: input.location,
      search_volume: k.volume,
      difficulty: k.difficulty,
      intent: k.intent,
      source: k.source,
      is_estimate: k.isEstimate,
    })),
    { onConflict: "client_id,keyword,location" },
  );
  await log.log("step", `Saved ${list.length} keywords`, { top: list.slice(0, 15).map((k) => `${k.keyword} (${k.volume ?? "?"}${k.isEstimate ? " est." : ""})`) });
  return list;
}

// ---------------------------------------------------------------------------
// Competitor analysis
// ---------------------------------------------------------------------------

const competitorList = z.object({
  competitors: z
    .array(z.object({ url: z.string().min(8), title: z.string().max(200), position_estimate: z.number().int().min(1).max(50), why_they_rank: z.string().max(400) }))
    .max(10),
});

export interface CompetitorInsight {
  url: string;
  domain: string;
  position: number | null;
  title: string | null;
  h1: string | null;
  wordCount: number | null;
  hasJsonLd: boolean | null;
  notes: string;
}

async function resolveUrl(url: string): Promise<string> {
  // Grounding links can be Google redirect URLs; resolve them to the real page.
  if (!url.includes("grounding-api-redirect")) return url;
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return res.headers.get("location") ?? url;
  } catch {
    return url;
  }
}

export async function analyseCompetitors(log: RunLogger, input: { client: Client; site: Site; keyword: string; location: string; campaignId?: string | null }): Promise<CompetitorInsight[]> {
  await log.log("step", `Analysing who ranks for "${input.keyword}"`);
  let found: { url: string; position: number | null; title: string; notes: string }[] = [];

  if (dataForSeoConfigured()) {
    try {
      found = (await serp(input.keyword, input.location)).slice(0, 8).map((i) => ({ url: i.url, position: i.position, title: i.title, notes: "" }));
    } catch (err) {
      await log.log("step", `SERP lookup failed, falling back to search grounding: ${errorMessage(err)}`, null, "warn");
    }
  }
  if (!found.length) {
    const { data, sources } = await generateJson(log, {
      purpose: "competitor_discovery",
      tier: "fast",
      search: true,
      schema: competitorList,
      prompt: `Search Google for "${input.keyword}" as a searcher in ${input.location} would. List the organic results that are local
businesses or service pages (exclude directories like Yell, Checkatrade, Yelp, and exclude ${input.site.business.name}).
Give each page's full URL, its title, your estimate of its ranking position, and why it ranks (content depth, reviews, locality, etc.).`,
      mock: () => ({ competitors: [] }),
    });
    const list = data.competitors.length ? data.competitors : sources.slice(0, 6).map((s, i) => ({ url: s.uri, title: s.title, position_estimate: i + 1, why_they_rank: "" }));
    found = await Promise.all(list.map(async (c) => ({ url: await resolveUrl(c.url), position: c.position_estimate, title: c.title, notes: c.why_they_rank })));
  }

  const insights: CompetitorInsight[] = [];
  for (const c of found.slice(0, 6)) {
    let domain = "";
    try {
      domain = new URL(c.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    let parsed: ReturnType<typeof parsePage> | null = null;
    try {
      const res = await fetch(c.url, { signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Mozilla/5.0 (compatible; RankPilotResearch/1.0)" } });
      if (res.ok && res.headers.get("content-type")?.includes("text/html")) parsed = parsePage(c.url, await res.text());
    } catch {
      parsed = null;
    }
    insights.push({ url: c.url, domain, position: c.position, title: parsed?.title ?? c.title, h1: parsed?.h1s[0] ?? null, wordCount: parsed?.wordCount ?? null, hasJsonLd: parsed?.hasJsonLd ?? null, notes: c.notes });
  }

  if (insights.length) {
    await adminClient()
      .from("competitors")
      .insert(insights.map((i) => ({ client_id: input.client.id, campaign_id: input.campaignId ?? null, keyword: input.keyword, url: i.url, domain: i.domain, position: i.position, analysis: i })));
  }
  await log.log("step", `Analysed ${insights.length} competing pages for "${input.keyword}"`, insights.map((i) => `${i.position ?? "?"}. ${i.domain} (${i.wordCount ?? "?"} words)`));
  return insights;
}
