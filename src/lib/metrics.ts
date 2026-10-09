import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgo, isoDate } from "@/lib/utils";

export type DailyPoint = { date: string; clicks: number; impressions: number; ctr: number; position: number | null };

export interface ClientMetrics {
  days: number;
  daily: DailyPoint[];
  traffic: { date: string; sessions: number; organic: number; conversions: number }[];
  totals: { clicks: number; impressions: number; ctr: number; position: number | null; leads: number; sessions: number; organic: number };
  previous: { clicks: number; impressions: number; leads: number; organic: number };
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; avg_position: number }[];
  topPages: { page: string; clicks: number; impressions: number; ctr: number; avg_position: number }[];
  rankings: RankRow[];
}

export interface RankRow {
  keyword_id: string;
  keyword: string;
  location: string;
  search_volume: number | null;
  is_estimate: boolean;
  current_position: number | null;
  previous_position: number | null;
  change: number | null;
  url: string | null;
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

/** All dashboard numbers for one client. Uses the caller's client, so RLS applies. */
export async function clientMetrics(db: SupabaseClient, clientId: string, days = 28): Promise<ClientMetrics> {
  const to = isoDate(new Date());
  const from = isoDate(daysAgo(days - 1));
  const prevFrom = isoDate(daysAgo(days * 2 - 1));
  const prevTo = isoDate(daysAgo(days));

  const [cur, prev, queries, pages, ranks, ga, gaPrev, leads, leadsPrev] = await Promise.all([
    db.rpc("client_gsc_daily", { p_client: clientId, p_from: from, p_to: to }),
    db.rpc("client_gsc_daily", { p_client: clientId, p_from: prevFrom, p_to: prevTo }),
    db.rpc("client_top_queries", { p_client: clientId, p_from: from, p_to: to, p_limit: 15 }),
    db.rpc("client_top_pages", { p_client: clientId, p_from: from, p_to: to, p_limit: 10 }),
    db.rpc("client_rank_movements", { p_client: clientId, p_days: days }),
    db.from("ga4_daily").select("date, sessions, organic_sessions, conversions").eq("client_id", clientId).gte("date", from).order("date"),
    db.from("ga4_daily").select("organic_sessions").eq("client_id", clientId).gte("date", prevFrom).lte("date", prevTo),
    db.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", `${from}T00:00:00Z`),
    db.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", `${prevFrom}T00:00:00Z`).lt("created_at", `${from}T00:00:00Z`),
  ]);

  const daily: DailyPoint[] = ((cur.data ?? []) as { date: string; clicks: number; impressions: number; ctr: number; avg_position: number | null }[]).map((r) => ({
    date: r.date,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    ctr: Number(r.ctr),
    position: r.avg_position === null ? null : Number(r.avg_position),
  }));
  const prevRows = (prev.data ?? []) as { clicks: number; impressions: number }[];
  const clicks = sum(daily, (r) => r.clicks);
  const impressions = sum(daily, (r) => r.impressions);
  const weightedPos = sum(daily, (r) => (r.position ?? 0) * r.impressions);
  const traffic = ((ga.data ?? []) as { date: string; sessions: number; organic_sessions: number; conversions: number }[]).map((r) => ({
    date: r.date,
    sessions: r.sessions,
    organic: r.organic_sessions,
    conversions: r.conversions,
  }));

  return {
    days,
    daily,
    traffic,
    totals: {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: impressions ? weightedPos / impressions : null,
      leads: leads.count ?? 0,
      sessions: sum(traffic, (r) => r.sessions),
      organic: sum(traffic, (r) => r.organic),
    },
    previous: {
      clicks: sum(prevRows, (r) => Number(r.clicks)),
      impressions: sum(prevRows, (r) => Number(r.impressions)),
      leads: leadsPrev.count ?? 0,
      organic: sum((gaPrev.data ?? []) as { organic_sessions: number }[], (r) => r.organic_sessions),
    },
    topQueries: ((queries.data ?? []) as ClientMetrics["topQueries"]).map((q) => ({ ...q, clicks: Number(q.clicks), impressions: Number(q.impressions), ctr: Number(q.ctr), avg_position: Number(q.avg_position) })),
    topPages: ((pages.data ?? []) as ClientMetrics["topPages"]).map((q) => ({ ...q, clicks: Number(q.clicks), impressions: Number(q.impressions), ctr: Number(q.ctr), avg_position: Number(q.avg_position) })),
    rankings: ((ranks.data ?? []) as RankRow[]).map((r) => ({
      ...r,
      current_position: r.current_position === null ? null : Number(r.current_position),
      previous_position: r.previous_position === null ? null : Number(r.previous_position),
      change: r.change === null ? null : Number(r.change),
    })),
  };
}

export interface PortfolioRow {
  client_id: string;
  name: string;
  status: string;
  site_status: string | null;
  subdomain: string | null;
  clicks: number;
  clicks_prev: number;
  impressions: number;
  impressions_prev: number;
  leads: number;
  leads_prev: number;
  tasks_done: number;
  pending_approvals: number;
  failed_tasks: number;
  ai_cost_month: number;
  subscription_status: string | null;
  mrr_cents: number;
}

export async function portfolio(db: SupabaseClient, agencyId: string, days = 28): Promise<PortfolioRow[]> {
  const { data, error } = await db.rpc("agency_portfolio", { p_agency: agencyId, p_days: days });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PortfolioRow[]).map((r) => ({
    ...r,
    clicks: Number(r.clicks),
    clicks_prev: Number(r.clicks_prev),
    impressions: Number(r.impressions),
    impressions_prev: Number(r.impressions_prev),
    leads: Number(r.leads),
    leads_prev: Number(r.leads_prev),
    tasks_done: Number(r.tasks_done),
    pending_approvals: Number(r.pending_approvals),
    failed_tasks: Number(r.failed_tasks),
    ai_cost_month: Number(r.ai_cost_month),
  }));
}
