import Link from "next/link";
import { cancelTask, retryTask, startCampaign } from "@/app/agency/actions";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";
import type { Campaign, Task } from "@/lib/db/types";

type ImpactCheckpoint = { verdict: string; clicksChangePct: number | null; positionChange: number | null };

function ImpactCell({ impact }: { impact: Task["measured_impact"] }) {
  const entries = Object.entries((impact ?? {}) as Record<string, ImpactCheckpoint>);
  if (!entries.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <p key={k} className="text-xs">
          <span className="text-slate-500">{k.replace("d", "")}d:</span>{" "}
          <Badge tone={v.verdict === "improved" ? "green" : v.verdict === "declined" ? "red" : "gray"}>{v.verdict.replace("_", " ")}</Badge>{" "}
          {v.clicksChangePct != null && `${v.clicksChangePct > 0 ? "+" : ""}${v.clicksChangePct.toFixed(0)}% clicks`}
        </p>
      ))}
    </div>
  );
}

export default async function SeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client } = await assertClientStaff(id);
  const [{ data: campaigns }, { data: tasks }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("client_id", id).order("scheduled_for", { ascending: false }).limit(100),
  ]);
  const list = (tasks ?? []) as Task[];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {((campaigns ?? []) as Campaign[]).map((c) => {
          const ct = list.filter((t) => t.campaign_id === c.id);
          const plan = c.plan as { summary?: string; insights?: string[] } | null;
          return (
            <Card key={c.id}>
              <CardHeader
                title={c.name}
                description={<><StatusBadge status={c.status} /> <span className="ml-2">{ct.filter((t) => t.status === "done").length}/{ct.length} tasks done</span></>}
                action={c.run_id && <Link href={`/agency/runs/${c.run_id}`} className="text-sm text-brand-600">Planning log →</Link>}
              />
              {plan?.summary && (
                <CardBody className="border-b border-slate-100 text-sm text-slate-700">
                  <p>{plan.summary}</p>
                  {!!plan.insights?.length && <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">{plan.insights.map((i, n) => <li key={n}>{i}</li>)}</ul>}
                </CardBody>
              )}
              <Table>
                <thead><tr><Th>Task</Th><Th>When</Th><Th>Status</Th><Th>Impact</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {ct.map((t) => (
                    <tr key={t.id}>
                      <Td>
                        <p className="font-medium text-slate-800">{t.title}</p>
                        <p className="text-xs text-slate-500">{t.kind.replace(/_/g, " ")} · {t.risk} risk</p>
                        {t.error && <p className="text-xs text-red-600">{t.error}</p>}
                        {(t.result as { summary?: string } | null)?.summary && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{(t.result as { summary: string }).summary}</p>}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">{new Date(t.completed_at ?? t.scheduled_for).toLocaleDateString("en-GB")}</Td>
                      <Td><StatusBadge status={t.status} /></Td>
                      <Td><ImpactCell impact={t.measured_impact} /></Td>
                      <Td className="whitespace-nowrap">
                        {t.status === "failed" && <form action={retryTask.bind(null, t.id)}><Button size="sm" variant="secondary">Retry</Button></form>}
                        {t.status === "planned" && <form action={cancelTask.bind(null, t.id)}><Button size="sm" variant="ghost">Cancel</Button></form>}
                        {(t.payload as { run_id?: string }).run_id && <Link href={`/agency/runs/${(t.payload as { run_id: string }).run_id}`} className="text-xs text-brand-600">log</Link>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })}
        {!campaigns?.length && <Card className="p-6 text-sm text-slate-500">No campaigns yet. Start one, or let the weekly opportunity scan create an always-on campaign.</Card>}
      </div>
      <Card className="h-fit">
        <CardHeader title="Start a campaign" description="The AI researches keywords and competitors, plans tasks and executes them." />
        <CardBody>
          {client.status === "active" ? (
            <form action={startCampaign.bind(null, id)} className="space-y-3">
              <div>
                <Label htmlFor="goal">Goal</Label>
                <Textarea id="goal" name="goal" rows={3} required placeholder="Improve rankings for emergency plumbing in Birmingham" />
              </div>
              <div>
                <Label htmlFor="keywords" hint="comma separated, optional">Target keywords</Label>
                <Input id="keywords" name="keywords" placeholder="emergency plumber birmingham, 24 hour plumber" />
              </div>
              <div>
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" defaultValue={client.primary_location ?? ""} />
              </div>
              <Button type="submit" className="w-full">Plan &amp; run campaign</Button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">Client is {client.status}. Activate it in Settings to run campaigns.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
