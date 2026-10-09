import { TimeSeriesChart } from "@/components/charts/time-series";
import { Card, CardBody, CardHeader, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { env } from "@/lib/env";
import { portfolio } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, formatUsd } from "@/lib/utils";

export const metadata = { title: "AI usage" };

export default async function UsagePage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: daily }, rows, { data: byPurpose }] = await Promise.all([
    supabase.rpc("agency_usage_daily", { p_agency: staff.agency.id, p_days: 30 }),
    portfolio(supabase, staff.agency.id),
    supabase.from("ai_usage").select("purpose, model, input_tokens, output_tokens, cost_usd").eq("agency_id", staff.agency.id).gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(5000),
  ]);
  const days = ((daily ?? []) as { day: string; requests: number; input_tokens: number; output_tokens: number; cost_usd: number }[]).map((d) => ({ date: d.day, requests: Number(d.requests), tokens: Number(d.input_tokens) + Number(d.output_tokens), cost: Number(d.cost_usd) }));
  const purposes = new Map<string, { requests: number; tokens: number; cost: number }>();
  for (const u of byPurpose ?? []) {
    const k = String(u.purpose).replace(/:repair$/, "");
    const p = purposes.get(k) ?? { requests: 0, tokens: 0, cost: 0 };
    p.requests++;
    p.tokens += Number(u.input_tokens) + Number(u.output_tokens);
    p.cost += Number(u.cost_usd);
    purposes.set(k, p);
  }
  const total = days.reduce((s, d) => ({ requests: s.requests + d.requests, tokens: s.tokens + d.tokens, cost: s.cost + d.cost }), { requests: 0, tokens: 0, cost: 0 });
  return (
    <>
      <PageHeader title="AI usage & cost" description={`Last 30 days · models: ${env().LLM_MODEL_PLANNER} (planning), ${env().LLM_MODEL_FAST} (bulk)`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Model requests" value={formatNumber(total.requests)} />
        <Stat label="Tokens" value={formatNumber(total.tokens)} />
        <Stat label="Cost" value={formatUsd(total.cost)} hint={total.cost === 0 ? "Free tier, or no prices set in AI_PRICES_JSON" : undefined} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Requests per day" />
          <CardBody><TimeSeriesChart data={days} dataKey="requests" label="Requests" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="By purpose" />
          <Table>
            <thead><tr><Th>Purpose</Th><Th className="text-right">Requests</Th><Th className="text-right">Tokens</Th><Th className="text-right">Cost</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...purposes.entries()].sort((a, b) => b[1].tokens - a[1].tokens).map(([k, v]) => (
                <tr key={k}><Td>{k.replace(/_/g, " ")}</Td><Td className="text-right tabular-nums">{v.requests}</Td><Td className="text-right tabular-nums">{formatNumber(v.tokens)}</Td><Td className="text-right tabular-nums">{formatUsd(v.cost)}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="By client (this month)" description="Budgets are enforced before every AI call; set them in each client's settings." />
        <Table>
          <thead><tr><Th>Client</Th><Th className="text-right">AI cost this month</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => <tr key={r.client_id}><Td>{r.name}</Td><Td className="text-right tabular-nums">{formatUsd(r.ai_cost_month)}</Td></tr>)}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
