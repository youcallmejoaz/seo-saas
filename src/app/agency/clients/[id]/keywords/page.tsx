import { RankingsTable } from "@/components/dashboard/performance";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";
import type { Keyword } from "@/lib/db/types";
import { clientMetrics } from "@/lib/metrics";
import { formatNumber } from "@/lib/utils";

export default async function KeywordsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await assertClientStaff(id);
  const [m, { data: kws }, { data: competitors }] = await Promise.all([
    clientMetrics(supabase, id, 28),
    supabase.from("keywords").select("*").eq("client_id", id).order("search_volume", { ascending: false, nullsFirst: false }).limit(200),
    supabase.from("competitors").select("keyword, domain, url, position, analysis, found_at").eq("client_id", id).order("found_at", { ascending: false }).limit(30),
  ]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Tracked rankings" description="Position from Search Console (and SERP checks when DataForSEO is connected), vs 28 days ago." />
        <RankingsTable m={m} limit={100} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top search queries (28 days)" />
          <Table>
            <thead><tr><Th>Query</Th><Th className="text-right">Clicks</Th><Th className="text-right">Impr.</Th><Th className="text-right">Pos.</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {m.topQueries.map((q) => <tr key={q.query}><Td>{q.query}</Td><Td className="text-right tabular-nums">{q.clicks}</Td><Td className="text-right tabular-nums">{formatNumber(q.impressions)}</Td><Td className="text-right tabular-nums">{q.avg_position.toFixed(1)}</Td></tr>)}
            </tbody>
          </Table>
          {!m.topQueries.length && <p className="px-5 py-4 text-sm text-slate-500">No Search Console data yet.</p>}
        </Card>
        <Card>
          <CardHeader title="Keyword research" description="Volumes marked 'estimate' are AI estimates; real volumes come from DataForSEO." />
          <Table>
            <thead><tr><Th>Keyword</Th><Th className="text-right">Volume</Th><Th className="text-right">Difficulty</Th><Th>Intent</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {((kws ?? []) as Keyword[]).map((k) => (
                <tr key={k.id}>
                  <Td>{k.keyword} {k.tracked && <Badge tone="blue">tracked</Badge>}</Td>
                  <Td className="text-right tabular-nums">{k.search_volume ?? "—"} {k.is_estimate && k.search_volume != null && <Badge>est.</Badge>}</Td>
                  <Td className="text-right tabular-nums">{k.difficulty ?? "—"}</Td>
                  <Td className="text-xs">{k.intent ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <Card>
        <CardHeader title="Competitors found during research" />
        <Table>
          <thead><tr><Th>Keyword</Th><Th>Competitor</Th><Th className="text-right">Position</Th><Th className="text-right">Words</Th><Th>Notes</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(competitors ?? []).map((c, i) => {
              const a = c.analysis as { wordCount?: number | null; notes?: string } | null;
              return (
                <tr key={i}>
                  <Td className="text-xs">{c.keyword}</Td>
                  <Td><a href={c.url} target="_blank" rel="noreferrer" className="text-brand-600">{c.domain}</a></Td>
                  <Td className="text-right">{c.position ?? "—"}</Td>
                  <Td className="text-right">{a?.wordCount ?? "—"}</Td>
                  <Td className="max-w-md text-xs text-slate-500">{a?.notes}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {!competitors?.length && <p className="px-5 py-4 text-sm text-slate-500">Competitor analysis runs as part of each campaign.</p>}
      </Card>
    </div>
  );
}
