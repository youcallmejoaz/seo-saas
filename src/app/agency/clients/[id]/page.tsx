import Link from "next/link";
import { scanNow, runAuditNow, syncNow } from "@/app/agency/actions";
import { ChangeSetCard } from "@/components/agency/change-set-card";
import { PerformanceCharts, PerformanceKpis, RankingsTable } from "@/components/dashboard/performance";
import { Button, Card, CardHeader, StatusBadge } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";
import type { ChangeSetRow, Task } from "@/lib/db/types";
import { clientMetrics } from "@/lib/metrics";

export default async function ClientOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client } = await assertClientStaff(id);
  const [m, { data: tasks }, { data: pending }, { data: integ }] = await Promise.all([
    clientMetrics(supabase, id, 28),
    supabase.from("tasks").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(8),
    supabase.from("change_sets").select("*").eq("client_id", id).eq("status", "proposed").order("created_at"),
    supabase.from("integrations").select("status, last_synced_at, gsc_property").eq("client_id", id).eq("provider", "google").maybeSingle(),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Google: {integ ? <><StatusBadge status={integ.status} /> {integ.gsc_property ?? "no Search Console property selected"}{integ.last_synced_at && ` · synced ${new Date(integ.last_synced_at).toLocaleString("en-GB")}`}</> : <Link href={`/agency/clients/${id}/settings`} className="text-brand-600">connect Search Console &amp; Analytics</Link>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/agency/command?client=${id}`}><Button size="sm" variant="secondary">Ask AI about {client.name}</Button></Link>
          <form action={scanNow.bind(null, id)}><Button size="sm" variant="secondary">Find opportunities</Button></form>
          <form action={runAuditNow.bind(null, id)}><Button size="sm" variant="secondary">Run audit</Button></form>
          <form action={syncNow.bind(null, id)}><Button size="sm" variant="ghost">Sync now</Button></form>
        </div>
      </div>
      <PerformanceKpis m={m} />
      <PerformanceCharts m={m} />
      {!!pending?.length && (
        <Card>
          <CardHeader title={`Waiting for approval (${pending.length})`} />
          <div className="divide-y divide-slate-100">{(pending as ChangeSetRow[]).map((cs) => <ChangeSetCard key={cs.id} cs={cs} previewHref={`/preview/${cs.site_id}`} />)}</div>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Keyword rankings" action={<Link href={`/agency/clients/${id}/keywords`} className="text-sm text-brand-600">All →</Link>} />
          <RankingsTable m={m} limit={10} />
        </Card>
        <Card>
          <CardHeader title="Latest SEO tasks" action={<Link href={`/agency/clients/${id}/seo`} className="text-sm text-brand-600">All →</Link>} />
          <ul className="divide-y divide-slate-100">
            {((tasks ?? []) as Task[]).map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{t.title}</p>
                  <p className="text-xs text-slate-500">{t.kind.replace(/_/g, " ")} · {t.risk} risk</p>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {!tasks?.length && <li className="px-5 py-4 text-sm text-slate-500">No tasks yet. Start a campaign from the SEO tab.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
