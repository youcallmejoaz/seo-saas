import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { changeOps } from "@/lib/site/changes";
import { loadPages } from "@/lib/site/repo";
import { pathForSlug } from "@/lib/site/schema";
import { isoDate } from "@/lib/utils";

export interface WindowStats {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface Impact {
  checkpointDays: number;
  pages: string[];
  before: WindowStats;
  after: WindowStats;
  clicksChangePct: number | null;
  positionChange: number | null; // positive = moved up
  verdict: "improved" | "declined" | "flat" | "insufficient_data";
}

export function aggregate(rows: { clicks: number; impressions: number; position: number }[]): WindowStats {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const pos = rows.reduce((s, r) => s + r.position * r.impressions, 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? pos / impressions : null };
}

/** Compare equal windows before/after a change. Pure, so it is unit-tested. */
export function compareWindows(before: WindowStats, after: WindowStats, checkpointDays: number, pages: string[]): Impact {
  const clicksChangePct = before.clicks ? ((after.clicks - before.clicks) / before.clicks) * 100 : null;
  const positionChange = before.position !== null && after.position !== null ? before.position - after.position : null;
  let verdict: Impact["verdict"] = "flat";
  if (before.impressions + after.impressions < 30) verdict = "insufficient_data";
  else if ((clicksChangePct ?? 0) >= 10 || (positionChange ?? 0) >= 1) verdict = "improved";
  else if ((clicksChangePct ?? 0) <= -10 || (positionChange ?? 0) <= -1) verdict = "declined";
  return { checkpointDays, pages, before, after, clicksChangePct, positionChange, verdict };
}

/** Measure a completed task's effect on the pages it changed, using Search Console data. */
export async function measureTask(taskId: string, checkpointDays: number): Promise<Impact | null> {
  const db = adminClient();
  const { data: task } = await db.from("tasks").select("id, client_id, change_set_id, completed_at, measured_impact").eq("id", taskId).single();
  if (!task?.change_set_id) return null;
  const { data: cs } = await db.from("change_sets").select("site_id, ops, applied_at, status").eq("id", task.change_set_id).single();
  if (!cs?.applied_at || cs.status !== "applied") return null;

  const ops = changeOps.parse(cs.ops);
  const pages = await loadPages(cs.site_id as string, { includeArchived: true });
  const slugs = new Set<string>();
  for (const op of ops) {
    if (op.op === "create_page") slugs.add(op.page.slug);
    else if ("page" in op && typeof op.page === "string") {
      const p = pages.find((x) => x.id === op.page || x.slug === op.page);
      if (p) slugs.add(p.slug);
    }
    if (op.op === "add_internal_link") slugs.add(op.target_path.replace(/^\//, ""));
  }
  const paths = [...slugs].map(pathForSlug);
  const applied = new Date(cs.applied_at as string);
  const day = 86_400_000;
  const beforeFrom = isoDate(new Date(+applied - checkpointDays * day));
  const afterTo = isoDate(new Date(+applied + checkpointDays * day));

  const { data: rows } = await db
    .from("gsc_daily")
    .select("date, page, clicks, impressions, position")
    .eq("client_id", task.client_id)
    .gte("date", beforeFrom)
    .lte("date", afterTo)
    .limit(50_000);
  const pathOf = (url: string) => new URL(url, "https://x").pathname.replace(/\/$/, "") || "/";
  const matches = (rows ?? []).filter((r) => paths.includes(pathOf(r.page as string)));
  const cut = isoDate(applied);
  const toNum = (r: { clicks: unknown; impressions: unknown; position: unknown }) => ({ clicks: Number(r.clicks), impressions: Number(r.impressions), position: Number(r.position) });
  const impact = compareWindows(
    aggregate(matches.filter((r) => (r.date as string) < cut).map(toNum)),
    aggregate(matches.filter((r) => (r.date as string) > cut).map(toNum)),
    checkpointDays,
    paths,
  );
  const prev = (task.measured_impact as Record<string, unknown> | null) ?? {};
  await db.from("tasks").update({ measured_impact: { ...prev, [`d${checkpointDays}`]: impact } }).eq("id", taskId);
  return impact;
}
