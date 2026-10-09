import Link from "next/link";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { Markdown } from "@/components/markdown";
import { PerformanceCharts, PerformanceKpis, RankingsTable } from "@/components/dashboard/performance";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import type { Lead, Site, Task } from "@/lib/db/types";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { clientMetrics } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };

// Plain-English labels for business owners.
const FRIENDLY: Record<string, string> = {
  meta_optimize: "Improved how a page appears in Google",
  content_expand: "Added helpful content to a page",
  new_service_page: "Created a new service page",
  new_location_page: "Created a new area page",
  new_blog_post: "Published a helpful article",
  internal_links: "Connected related pages together",
  schema_markup: "Added search-friendly page details",
  alt_text: "Described images for search engines",
  technical_fix: "Fixed technical issues",
};

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ client?: string; days?: string }> }) {
  const sp = await searchParams;
  const viewer = (await getViewer())!;
  const clientId = sp.client && viewer.clientIds.includes(sp.client) ? sp.client : viewer.clientIds[0]!;
  const days = [28, 90].includes(Number(sp.days)) ? Number(sp.days) : 28;
  const supabase = await createClient();
  const [{ data: client }, { data: site }, m, { data: done }, { data: upcoming }, { data: reports }, { data: leads }, { data: allClients }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", clientId).single(),
    supabase.from("sites").select("*").eq("client_id", clientId).neq("status", "archived").limit(1).maybeSingle(),
    clientMetrics(supabase, clientId, days),
    supabase.from("tasks").select("*").eq("client_id", clientId).eq("status", "done").order("completed_at", { ascending: false }).limit(10),
    supabase.from("tasks").select("*").eq("client_id", clientId).in("status", ["planned", "running", "awaiting_approval"]).order("scheduled_for").limit(6),
    supabase.from("reports").select("*").eq("client_id", clientId).order("period_start", { ascending: false }).limit(3),
    supabase.from("leads").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(10),
    supabase.from("clients").select("id, name").in("id", viewer.clientIds),
  ]);
  const s = site as Site | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{client?.name}</h1>
          {s?.status === "published" && (
            <a href={siteUrl(s, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL)} target="_blank" className="text-sm text-brand-600 hover:underline">
              {siteUrl(s, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL).replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
        <div className="flex gap-2 text-sm">
          {(allClients ?? []).length > 1 && (allClients ?? []).map((c) => (
            <Link key={c.id} href={`/portal?client=${c.id}`} className={`rounded-full px-3 py-1 ${c.id === clientId ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}>{c.name}</Link>
          ))}
          {[28, 90].map((d) => (
            <Link key={d} href={`/portal?client=${clientId}&days=${d}`} className={`rounded-full px-3 py-1 ${d === days ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>Last {d} days</Link>
          ))}
        </div>
      </div>

      <PerformanceKpis m={m} />
      <PerformanceCharts m={m} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where you rank in Google" description="Lower numbers are better. Arrows compare with the start of the period." />
          <RankingsTable m={m} limit={15} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Work completed for you" />
            <ul className="divide-y divide-slate-100">
              {((done ?? []) as Task[]).map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <p className="text-sm font-medium text-slate-800">{FRIENDLY[t.kind] ?? t.title}</p>
                  <p className="text-xs text-slate-500">{t.title} · {t.completed_at && new Date(t.completed_at).toLocaleDateString("en-GB")}</p>
                </li>
              ))}
              {!done?.length && <li className="px-5 py-4 text-sm text-slate-500">Your first improvements are on the way.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Coming up next" />
            <ul className="divide-y divide-slate-100">
              {((upcoming ?? []) as Task[]).map((t) => (
                <li key={t.id} className="px-5 py-3 text-sm text-slate-700">{FRIENDLY[t.kind] ?? t.title}<span className="ml-2 text-xs text-slate-400">{t.title}</span></li>
              ))}
              {!upcoming?.length && <li className="px-5 py-4 text-sm text-slate-500">We review your site every week and plan new improvements.</li>}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly summaries" />
          <CardBody className="space-y-6">
            {(reports ?? []).map((r) => (
              <div key={r.id}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{new Date(`${r.period_start}T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric" })}</p>
                <Markdown md={r.summary_md as string} />
              </div>
            ))}
            {!reports?.length && <EmptyState title="Your first monthly summary arrives at the start of next month." />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent enquiries" description="From the contact forms on your website." />
          {leads?.length ? <LeadsTable leads={leads as Lead[]} /> : <CardBody><p className="text-sm text-slate-500">No enquiries yet.</p></CardBody>}
        </Card>
      </div>
    </div>
  );
}
