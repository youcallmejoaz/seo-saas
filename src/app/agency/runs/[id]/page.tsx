import Link from "next/link";
import { notFound } from "next/navigation";
import { kindLabel } from "@/components/agency/run-list";
import { RunLog } from "@/components/agency/run-log";
import { Card, CardBody, CardHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Run, RunEvent } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, formatUsd } from "@/lib/utils";

export const metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("runs").select("*").eq("id", id).eq("agency_id", staff.agency.id).maybeSingle();
  if (!data) notFound();
  const run = data as Run;
  const [{ data: events }, { data: client }, { data: children }, { data: changes }] = await Promise.all([
    supabase.from("run_events").select("*").eq("run_id", id).order("id"),
    run.client_id ? supabase.from("clients").select("id, name").eq("id", run.client_id).single() : Promise.resolve({ data: null }),
    supabase.from("runs").select("id, kind, status, prompt").eq("parent_run_id", id).order("created_at"),
    supabase.from("change_sets").select("id, summary, status, risk").eq("run_id", id),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Link href="/agency/runs" className="text-sm text-slate-500 hover:text-slate-800">← Activity</Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{run.prompt || kindLabel(run.kind)}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {kindLabel(run.kind)} {client && <>· <Link href={`/agency/clients/${client.id}`} className="text-brand-600">{client.name}</Link></>} · {new Date(run.created_at).toLocaleString("en-GB")}
        </p>
        <Card className="mt-6">
          <CardBody>
            <RunLog runId={run.id} initialEvents={(events ?? []) as RunEvent[]} initialStatus={run.status} />
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Summary" />
          <CardBody className="space-y-2 text-sm">
            <p>Status: <StatusBadge status={run.status} /></p>
            {run.error && <p className="rounded bg-red-50 p-2 text-red-700">{run.error}</p>}
            <p className="text-slate-600">Tokens: {formatNumber(run.tokens_in)} in · {formatNumber(run.tokens_out)} out</p>
            <p className="text-slate-600">AI cost: {formatUsd(run.cost_usd)}</p>
            {run.finished_at && run.started_at && <p className="text-slate-600">Duration: {Math.round((+new Date(run.finished_at) - +new Date(run.started_at)) / 1000)}s</p>}
          </CardBody>
        </Card>
        {!!changes?.length && (
          <Card>
            <CardHeader title="Website changes" />
            <ul className="divide-y divide-slate-100">
              {changes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                  <span className="text-slate-700">{c.summary}</span>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
            <CardBody><Link href="/agency/approvals" className="text-sm text-brand-600">Review approvals →</Link></CardBody>
          </Card>
        )}
        {!!children?.length && (
          <Card>
            <CardHeader title="Sub-tasks" />
            <ul className="divide-y divide-slate-100">
              {children.map((c) => (
                <li key={c.id}>
                  <Link href={`/agency/runs/${c.id}`} className="flex items-center justify-between gap-2 px-5 py-2 text-sm hover:bg-slate-50">
                    <span className="truncate">{c.prompt || kindLabel(c.kind)}</span>
                    <StatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {run.output && (
          <Card>
            <CardHeader title="Output" />
            <CardBody><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(run.output, null, 2)}</pre></CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
