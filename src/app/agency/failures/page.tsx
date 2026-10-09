import Link from "next/link";
import { cancelTask, retryTask } from "@/app/agency/actions";
import { kindLabel } from "@/components/agency/run-list";
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Failures" };

export default async function FailuresPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id, name").eq("agency_id", staff.agency.id);
  const names = Object.fromEntries((clients ?? []).map((c) => [c.id, c.name as string]));
  const ids = Object.keys(names);
  const [{ data: tasks }, { data: runs }] = await Promise.all([
    ids.length ? supabase.from("tasks").select("*").in("client_id", ids).eq("status", "failed").order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    supabase.from("runs").select("*").eq("agency_id", staff.agency.id).eq("status", "failed").order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <>
      <PageHeader title="Failures" description="Tasks and runs that failed after automatic retries. Retry once the cause is fixed." />
      <Card>
        <CardHeader title={`Failed SEO tasks (${tasks?.length ?? 0})`} />
        {tasks?.length ? (
          <Table>
            <thead><tr><Th>Task</Th><Th>Client</Th><Th>Error</Th><Th>Attempts</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <tr key={t.id}>
                  <Td><span className="font-medium">{t.title}</span><p className="text-xs text-slate-500">{t.kind}</p></Td>
                  <Td><Link href={`/agency/clients/${t.client_id}/seo`} className="text-brand-600">{names[t.client_id]}</Link></Td>
                  <Td className="max-w-md text-xs text-red-700">{t.error}</Td>
                  <Td>{t.attempts}</Td>
                  <Td className="whitespace-nowrap">
                    <form action={retryTask.bind(null, t.id)} className="inline"><Button size="sm" variant="secondary">Retry</Button></form>{" "}
                    <form action={cancelTask.bind(null, t.id)} className="inline"><Button size="sm" variant="ghost">Dismiss</Button></form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5"><EmptyState title="No failed tasks" /></div>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Failed runs" />
        <ul className="divide-y divide-slate-100">
          {(runs ?? []).map((r) => (
            <li key={r.id}>
              <Link href={`/agency/runs/${r.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium">{r.prompt || kindLabel(r.kind)}</p>
                  <p className="text-xs text-red-700">{r.error}</p>
                </div>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
          {!runs?.length && <li className="px-5 py-4 text-sm text-slate-500">No failed runs.</li>}
        </ul>
      </Card>
    </>
  );
}
