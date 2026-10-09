import "server-only";
import { env } from "@/lib/env";

// Optional paid provider for real search volumes and SERP rank tracking.
// Without credentials the platform uses Search Console data + labelled AI estimates.

export const dataForSeoConfigured = () => !!(env().DATAFORSEO_LOGIN && env().DATAFORSEO_PASSWORD);

async function post<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${env().DATAFORSEO_LOGIN}:${env().DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json()) as { status_code: number; status_message: string; tasks?: { status_code: number; status_message: string; result?: unknown[] }[] };
  if (!res.ok || j.status_code !== 20000) throw new Error(`DataForSEO: ${j.status_message ?? res.status}`);
  const task = j.tasks?.[0];
  if (!task || task.status_code !== 20000) throw new Error(`DataForSEO task: ${task?.status_message ?? "no task"}`);
  return task.result as T;
}

export interface KeywordMetrics {
  keyword: string;
  search_volume: number | null;
  competition_index: number | null;
}

export async function searchVolumes(keywords: string[], location: string, languageCode = "en"): Promise<KeywordMetrics[]> {
  const result = await post<{ keyword: string; search_volume: number | null; competition_index: number | null }[]>("keywords_data/google_ads/search_volume/live", [
    { keywords: keywords.slice(0, 1000), location_name: location, language_code: languageCode },
  ]);
  return (result ?? []).map((r) => ({ keyword: r.keyword, search_volume: r.search_volume, competition_index: r.competition_index }));
}

export interface SerpItem {
  position: number;
  url: string;
  domain: string;
  title: string;
}

export async function serp(keyword: string, location: string, languageCode = "en"): Promise<SerpItem[]> {
  const result = await post<{ items?: { type: string; rank_absolute: number; url: string; domain: string; title: string }[] }[]>("serp/google/organic/live/regular", [
    { keyword, location_name: location, language_code: languageCode, depth: 50 },
  ]);
  return (result?.[0]?.items ?? []).filter((i) => i.type === "organic").map((i) => ({ position: i.rank_absolute, url: i.url, domain: i.domain, title: i.title }));
}
