import Link from "next/link";
import { RunList } from "@/components/agency/run-list";
import { Card, CardHeader, PageHeader, Stat, StatusBadge, Table, Td, Th, Button } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Run } from "@/lib/db/types";
import { pctChange, portfolio } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, formatUsd } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function AgencyOverview() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [rows, { data: runs }] = await Promise.all([
    portfolio(supabase, staff.agency.id),
    supabase.from("runs").select("*").eq("agency_id", staff.agency.id).order("created_at", { ascending: false }).limit(8),
  ]);
  const active = rows.filter((r) => r.status === "active");
  const t = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const names = Object.fromEntries(rows.map((r) => [r.client_id, r.name]));
  const movers = [...rows].filter((r) => r.clicks_prev > 0 || r.clicks > 0).sort((a, b) => b.clicks - b.clicks_prev - (a.clicks - a.clicks_prev));

  return (
    <>
      <PageHeader
        title="Agency overview"
        description="Last 28 days across every client."
        actions={
          <>
            <Link href="/agency/command"><Button variant="secondary">Ask the AI</Button></Link>
            <Link href="/agency/clients/new"><Button>Onboard client</Button></Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active clients" value={active.length} hint={`${rows.length} total`} />
        <Stat label="Organic clicks" value={formatNumber(t("clicks"))} delta={pctChange(t("clicks"), t("clicks_prev"))} />
        <Stat label="Leads" value={formatNumber(t("leads"))} delta={pctChange(t("leads"), t("leads_prev"))} />
        <Stat label="SEO tasks completed" value={formatNumber(t("tasks_done"))} hint={`AI spend this month ${formatUsd(t("ai_cost_month"))}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Portfolio" description="Sorted by biggest click gains" action={<Link href="/agency/clients" className="text-sm text-brand-600">All clients →</Link>} />
          <Table>
            <thead>
              <tr><Th>Client</Th><Th>Status</Th><Th className="text-right">Clicks</Th><Th className="text-right">Change</Th><Th className="text-right">Leads</Th><Th className="text-right">Needs you</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(movers.length ? movers : rows).slice(0, 10).map((r) => {
                const d = r.clicks - r.clicks_prev;
                return (
                  <tr key={r.client_id}>
                    <Td><Link href={`/agency/clients/${r.client_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link></Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-right tabular-nums">{formatNumber(r.clicks)}</Td>
                    <Td className={`text-right tabular-nums ${d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-slate-400"}`}>{d > 0 ? "+" : ""}{formatNumber(d)}</Td>
                    <Td className="text-right tabular-nums">{r.leads}</Td>
                    <Td className="text-right">
                      {r.pending_approvals + r.failed_tasks > 0 ? (
                        <span className="text-amber-700">{r.pending_approvals} approvals · {r.failed_tasks} failed</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {!rows.length && <p className="px-5 py-6 text-sm text-slate-500">No clients yet. <Link href="/agency/clients/new" className="text-brand-600">Onboard your first client</Link>.</p>}
        </Card>
        <Card>
          <CardHeader title="Recent AI activity" action={<Link href="/agency/runs" className="text-sm text-brand-600">All →</Link>} />
          <RunList runs={(runs ?? []) as Run[]} clients={names} />
        </Card>
      </div>
    </>
  );
}
