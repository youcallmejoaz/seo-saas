import "server-only";
import { accessToken, ga4Daily, getGoogleIntegration, gscQuery } from "@/lib/integrations/google";
import { dataForSeoConfigured, serp } from "@/lib/integrations/dataforseo";
import type { RunLogger } from "@/lib/runs";
import { adminClient } from "@/lib/supabase/admin";
import { daysAgo, errorMessage, isoDate } from "@/lib/utils";
import type { Keyword } from "@/lib/db/types";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { primarySiteFor } from "@/lib/site/repo";

/**
 * Pull Search Console + GA4 data for a client and derive keyword rank snapshots.
 * Incremental: re-fetches the last few days (GSC data settles ~3 days late).
 */
export async function syncClient(log: RunLogger, clientId: string): Promise<{ gscRows: number; gaDays: number; ranks: number }> {
  const db = adminClient();
  const google = await getGoogleIntegration(clientId);
  if (!google || google.status !== "connected") {
    await log.log("step", "Google not connected; skipping Search Console/GA4 sync");
    return { gscRows: 0, gaDays: 0, ranks: 0 };
  }
  const token = await accessToken(google.id);
  const end = isoDate(daysAgo(1));
  let gscRows = 0;
  let gaDays = 0;

  if (google.gsc_property) {
    const { data: last } = await db.from("gsc_daily").select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(1).maybeSingle();
    const start = last ? isoDate(daysAgo(4, new Date(last.date as string))) : isoDate(daysAgo(90));
    const rows = await gscQuery(token, google.gsc_property, start, end);
    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000).map((r) => ({ client_id: clientId, ...r, query: r.query.slice(0, 500), page: r.page.slice(0, 1000) }));
      const { error } = await db.from("gsc_daily").upsert(chunk, { onConflict: "client_id,date,query,page" });
      if (error) throw new Error(`gsc upsert: ${error.message}`);
    }
    gscRows = rows.length;
    await log.log("step", `Synced ${rows.length} Search Console rows (${start} → ${end})`);
  }

  if (google.ga4_property_id) {
    try {
      const days = await ga4Daily(token, google.ga4_property_id, isoDate(daysAgo(30)), end);
      if (days.length) await db.from("ga4_daily").upsert(days.map((d) => ({ client_id: clientId, ...d })), { onConflict: "client_id,date" });
      gaDays = days.length;
      await log.log("step", `Synced ${days.length} days of GA4 traffic`);
    } catch (err) {
      await log.log("step", `GA4 sync failed: ${errorMessage(err)}`, null, "warn");
    }
  }

  const ranks = await snapshotRanksFromGsc(clientId);
  await db.from("integrations").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", google.id);
  return { gscRows, gaDays, ranks };
}

/** Daily position per tracked keyword, from GSC average position for that exact query. */
export async function snapshotRanksFromGsc(clientId: string): Promise<number> {
  const db = adminClient();
  const { data: keywords } = await db.from("keywords").select("id, keyword").eq("client_id", clientId).eq("tracked", true);
  if (!keywords?.length) return 0;
  const since = isoDate(daysAgo(7));
  const { data: rows } = await db
    .from("gsc_daily")
    .select("date, query, page, impressions, position")
    .eq("client_id", clientId)
    .gte("date", since)
    .in("query", keywords.map((k) => k.keyword as string));
  const best = new Map<string, { date: string; position: number; page: string; impressions: number }>();
  for (const r of rows ?? []) {
    const key = `${r.query}|${r.date}`;
    const cur = best.get(key);
    if (!cur || (r.impressions as number) > cur.impressions) best.set(key, { date: r.date as string, position: Number(r.position), page: r.page as string, impressions: r.impressions as number });
  }
  const snaps = keywords.flatMap((k) =>
    [...best.entries()].filter(([key]) => key.startsWith(`${k.keyword}|`)).map(([, v]) => ({ client_id: clientId, keyword_id: k.id, date: v.date, position: v.position, url: v.page, source: "gsc" })),
  );
  if (snaps.length) await db.from("rank_snapshots").upsert(snaps, { onConflict: "keyword_id,date,source" });
  return snaps.length;
}

/** Weekly SERP rank check through DataForSEO (only when configured). */
export async function trackRanksWithSerp(log: RunLogger, clientId: string): Promise<number> {
  if (!dataForSeoConfigured()) return 0;
  const db = adminClient();
  const site = await primarySiteFor(clientId);
  if (!site) return 0;
  const host = new URL(siteUrl(site, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL)).hostname.replace(/^www\./, "");
  const { data: kws } = await db.from("keywords").select("*").eq("client_id", clientId).eq("tracked", true).limit(100);
  let n = 0;
  for (const k of (kws ?? []) as Keyword[]) {
    try {
      const items = await serp(k.keyword, k.location || "United Kingdom");
      const hit = items.find((i) => i.domain.replace(/^www\./, "") === host);
      await db.from("rank_snapshots").upsert({ client_id: clientId, keyword_id: k.id, date: isoDate(new Date()), position: hit?.position ?? null, url: hit?.url ?? null, source: "dataforseo" }, { onConflict: "keyword_id,date,source" });
      n++;
    } catch (err) {
      await log.log("step", `SERP check failed for "${k.keyword}": ${errorMessage(err)}`, null, "warn");
    }
  }
  await log.log("step", `Checked SERP positions for ${n} keywords`);
  return n;
}
