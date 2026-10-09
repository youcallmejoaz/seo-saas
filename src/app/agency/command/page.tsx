import Link from "next/link";
import { sendCommand } from "@/app/agency/actions";
import { RunLog } from "@/components/agency/run-log";
import { Button, Card, CardBody, CardHeader, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Run, RunEvent } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "AI command" };

const EXAMPLES = [
  "Build a website for a plumbing company in Birmingham called Brum Plumbing Co. Services: emergency plumbing, boiler repair, bathroom installation.",
  "Optimise Brum Plumbing Co's website for emergency plumbing searches.",
  "Create five relevant service pages for the roofing client.",
  "Review all client websites and identify SEO improvements.",
  "Show me which clients have experienced ranking improvements this month.",
  "Audit this client's website and fix the technical issues.",
];

export default async function CommandPage({ searchParams }: { searchParams: Promise<{ run?: string; client?: string }> }) {
  const sp = await searchParams;
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: clients }, { data: history }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("agency_id", staff.agency.id).neq("status", "offboarded").order("name"),
    supabase.from("runs").select("*").eq("agency_id", staff.agency.id).eq("kind", "command").order("created_at", { ascending: false }).limit(12),
  ]);
  const current = sp.run ? ((history ?? []).find((r) => r.id === sp.run) as Run | undefined) ?? ((await supabase.from("runs").select("*").eq("id", sp.run).maybeSingle()).data as Run | null) : null;
  const { data: events } = current ? await supabase.from("run_events").select("*").eq("run_id", current.id).order("id") : { data: [] };
  const answer = (current?.output as { answer?: string } | null)?.answer;

  return (
    <>
      <PageHeader title="AI command" description="Tell the AI what to do across your clients. It plans, acts through tools, and logs every step." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <form action={sendCommand} className="space-y-3">
                <Textarea name="prompt" rows={4} required placeholder="e.g. Improve Brum Plumbing Co's rankings for boiler repair in Solihull." />
                <div className="flex flex-wrap items-center gap-3">
                  <Select name="clientId" defaultValue={sp.client ?? ""} className="w-auto">
                    <option value="">All clients</option>
                    {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Button type="submit">Run</Button>
                </div>
              </form>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <span key={e} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{e.length > 70 ? `${e.slice(0, 70)}…` : e}</span>
                ))}
              </div>
            </CardBody>
          </Card>

          {current && (
            <Card>
              <CardHeader title={current.prompt ?? "Command"} description={<StatusBadge status={current.status} />} action={<Link href={`/agency/runs/${current.id}`} className="text-sm text-brand-600">Full log →</Link>} />
              <CardBody className="space-y-4">
                {answer && <div className="whitespace-pre-wrap rounded-lg bg-brand-50 p-4 text-sm text-slate-800">{answer}</div>}
                <RunLog runId={current.id} initialEvents={(events ?? []) as RunEvent[]} initialStatus={current.status} />
              </CardBody>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Recent commands" />
          <ul className="divide-y divide-slate-100">
            {(history ?? []).map((r) => (
              <li key={r.id}>
                <Link href={`/agency/command?run=${r.id}`} className="block px-5 py-3 hover:bg-slate-50">
                  <p className="line-clamp-2 text-sm text-slate-800">{r.prompt}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><StatusBadge status={r.status} /> {new Date(r.created_at).toLocaleString("en-GB")}</p>
                </Link>
              </li>
            ))}
            {!history?.length && <li className="px-5 py-4 text-sm text-slate-500">No commands yet.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
