import { runAuditNow, sendCommand } from "@/app/agency/actions";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";

export default async function AuditsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client } = await assertClientStaff(id);
  const { data: audits } = await supabase.from("audits").select("*").eq("client_id", id).order("started_at", { ascending: false }).limit(10);
  const latest = audits?.[0];
  const { data: issues } = latest ? await supabase.from("audit_issues").select("*").eq("audit_id", latest.id).order("severity") : { data: [] };
  const psi = latest?.pagespeed as { performance?: number; seo?: number; accessibility?: number; lcpMs?: number } | null;
  const order = { critical: 0, warning: 1, notice: 2 } as Record<string, number>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <form action={sendCommand}>
          <input type="hidden" name="clientId" value={id} />
          <input type="hidden" name="prompt" value={`Fix the auto-fixable technical issues from ${client.name}'s latest audit.`} />
          <Button size="sm" variant="secondary" disabled={!latest}>Fix issues with AI</Button>
        </form>
        <form action={runAuditNow.bind(null, id)}><Button size="sm">Run audit now</Button></form>
      </div>
      {latest ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Audit score" value={latest.score ?? "—"} hint={`${new Date(latest.started_at).toLocaleString("en-GB")} · ${latest.status}`} />
            <Stat label="Pages crawled" value={latest.pages_crawled} />
            {psi ? (
              <>
                <Stat label="Mobile performance" value={psi.performance ?? "—"} hint={psi.lcpMs ? `LCP ${(psi.lcpMs / 1000).toFixed(1)}s` : undefined} />
                <Stat label="Lighthouse SEO" value={psi.seo ?? "—"} />
              </>
            ) : (
              <>
                <Stat label="Critical issues" value={(issues ?? []).filter((i) => i.severity === "critical").length} hint="PageSpeed runs once the site is on a public URL" />
                <Stat label="Auto-fixable" value={(issues ?? []).filter((i) => i.auto_fixable).length} hint="Fixed by the AI under the client's policy" />
              </>
            )}
          </div>
          <Card>
            <CardHeader title={`Findings (${issues?.length ?? 0})`} />
            <Table>
              <thead><tr><Th>Severity</Th><Th>Page</Th><Th>Issue</Th><Th>Auto-fix</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {[...(issues ?? [])].sort((a, b) => order[a.severity]! - order[b.severity]!).map((i) => (
                  <tr key={i.id}>
                    <Td><Badge tone={i.severity === "critical" ? "red" : i.severity === "warning" ? "yellow" : "gray"}>{i.severity}</Badge></Td>
                    <Td className="max-w-xs truncate text-xs">{i.page_url}</Td>
                    <Td className="text-sm">{i.message}</Td>
                    <Td>{i.auto_fixable ? <Badge tone="green">yes</Badge> : <span className="text-xs text-slate-400">manual</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ul className="space-y-1 text-sm">
                {(audits ?? []).map((a) => <li key={a.id}>{new Date(a.started_at).toLocaleDateString("en-GB")}: score {a.score ?? "—"} <StatusBadge status={a.status} /></li>)}
              </ul>
            </CardBody>
          </Card>
        </>
      ) : (
        <EmptyState title="No audits yet">Audits run weekly for active clients, or start one now.</EmptyState>
      )}
    </div>
  );
}
