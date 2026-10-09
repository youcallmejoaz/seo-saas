import { TimeSeriesChart } from "@/components/charts/time-series";
import { Badge, Card, CardBody, CardHeader, Stat, Table, Td, Th } from "@/components/ui";
import { pctChange, type ClientMetrics } from "@/lib/metrics";
import { formatNumber } from "@/lib/utils";

/** Shared by the agency client overview and the client portal. */
export function PerformanceKpis({ m }: { m: ClientMetrics }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Visits from Google" value={formatNumber(m.totals.clicks)} delta={pctChange(m.totals.clicks, m.previous.clicks)} hint={`Last ${m.days} days`} />
      <Stat label="Times shown in Google" value={formatNumber(m.totals.impressions)} delta={pctChange(m.totals.impressions, m.previous.impressions)} />
      <Stat label="Average position" value={m.totals.position ? m.totals.position.toFixed(1) : "—"} hint="Lower is better" />
      <Stat label="Website enquiries" value={formatNumber(m.totals.leads)} delta={pctChange(m.totals.leads, m.previous.leads)} />
    </div>
  );
}

export function PerformanceCharts({ m }: { m: ClientMetrics }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Visits from Google search" description="Clicks per day (Search Console)" />
        <CardBody><TimeSeriesChart data={m.daily} dataKey="clicks" label="Clicks" /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Search impressions" description="How often the site appeared in results" />
        <CardBody><TimeSeriesChart data={m.daily} dataKey="impressions" label="Impressions" /></CardBody>
      </Card>
      {m.traffic.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader title="Organic website visits" description="Sessions from organic search (Google Analytics)" />
          <CardBody><TimeSeriesChart data={m.traffic} dataKey="organic" label="Organic sessions" /></CardBody>
        </Card>
      )}
    </div>
  );
}

export function RankingsTable({ m, limit = 25 }: { m: ClientMetrics; limit?: number }) {
  if (!m.rankings.length) return <p className="px-5 py-6 text-sm text-slate-500">Keyword tracking starts once Search Console data is available.</p>;
  return (
    <Table>
      <thead>
        <tr><Th>Keyword</Th><Th className="text-right">Position</Th><Th className="text-right">Change</Th><Th className="text-right">Monthly searches</Th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {m.rankings.slice(0, limit).map((r) => (
          <tr key={r.keyword_id}>
            <Td className="font-medium text-slate-800">{r.keyword}</Td>
            <Td className="text-right tabular-nums">{r.current_position ? r.current_position.toFixed(1) : <span className="text-slate-400">not ranking</span>}</Td>
            <Td className="text-right tabular-nums">
              {r.change == null ? <span className="text-slate-400">—</span> : r.change > 0 ? <span className="text-emerald-600">▲ {r.change.toFixed(1)}</span> : r.change < 0 ? <span className="text-red-600">▼ {Math.abs(r.change).toFixed(1)}</span> : <span className="text-slate-400">0</span>}
            </Td>
            <Td className="text-right tabular-nums">
              {r.search_volume ?? "—"} {r.search_volume != null && r.is_estimate && <Badge tone="gray" className="ml-1">estimate</Badge>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
