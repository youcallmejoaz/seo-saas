import "server-only";
import { generateText } from "@/lib/ai";
import { clientMetrics } from "@/lib/metrics";
import type { RunLogger } from "@/lib/runs";
import { adminClient } from "@/lib/supabase/admin";
import { formatNumber } from "@/lib/utils";

/** Plain-English monthly summary for the client portal, written for non-technical owners. */
export async function writeMonthlyReport(log: RunLogger, clientId: string, periodStart: string) {
  const db = adminClient();
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const days = Math.round((+end - +start) / 86_400_000) + 1;
  const m = await clientMetrics(db, clientId, days);
  const { data: client } = await db.from("clients").select("name").eq("id", clientId).single();
  const { data: tasks } = await db
    .from("tasks")
    .select("title, kind, completed_at")
    .eq("client_id", clientId)
    .eq("status", "done")
    .gte("completed_at", start.toISOString())
    .lte("completed_at", new Date(+end + 86_400_000).toISOString());
  const { data: upcoming } = await db.from("tasks").select("title, scheduled_for").eq("client_id", clientId).eq("status", "planned").order("scheduled_for").limit(5);
  const improved = m.rankings.filter((r) => (r.change ?? 0) > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 5);

  const facts = {
    clicks: m.totals.clicks,
    clicks_previous: m.previous.clicks,
    impressions: m.totals.impressions,
    leads: m.totals.leads,
    leads_previous: m.previous.leads,
    organic_sessions: m.totals.organic,
    top_queries: m.topQueries.slice(0, 5).map((q) => q.query),
    ranking_improvements: improved.map((r) => `${r.keyword}: ${r.previous_position?.toFixed(0)} → ${r.current_position?.toFixed(0)}`),
    work_completed: (tasks ?? []).map((t) => t.title),
    coming_next: (upcoming ?? []).map((t) => t.title),
  };

  const { text } = await generateText(log, {
    purpose: "monthly_report",
    tier: "fast",
    system: "You write short, friendly monthly SEO updates for small-business owners with no SEO knowledge. Plain English, no jargon, honest about declines, never invent numbers.",
    prompt: `Write the ${start.toLocaleString("en-GB", { month: "long", year: "numeric" })} update for ${client?.name}. Use Markdown with these sections: "Headlines" (3 bullets), "What we did", "What's next". Under 250 words.\nFacts (use only these): ${JSON.stringify(facts)}`,
    mock: () =>
      `## Headlines\n- ${formatNumber(facts.clicks)} visits from Google search (previous period: ${formatNumber(facts.clicks_previous)}).\n- ${facts.leads} enquiries through the website.\n- ${facts.ranking_improvements.length} keywords moved up in Google.\n\n## What we did\n${facts.work_completed.map((t) => `- ${t}`).join("\n") || "- Monitored the site and rankings."}\n\n## What's next\n${facts.coming_next.map((t) => `- ${t}`).join("\n") || "- Continue optimising your key pages."}`,
  });

  await db.from("reports").upsert(
    { client_id: clientId, period_start: periodStart, period_end: end.toISOString().slice(0, 10), summary_md: text, metrics: facts },
    { onConflict: "client_id,period_start" },
  );
  return { periodStart, words: text.split(/\s+/).length };
}
