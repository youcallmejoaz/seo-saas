import Link from "next/link";
import { Button, Card, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { portfolio } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, formatUsd } from "@/lib/utils";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const staff = await requireStaff();
  const rows = await portfolio(await createClient(), staff.agency.id);
  return (
    <>
      <PageHeader title="Clients" description={`${rows.length} clients`} actions={<Link href="/agency/clients/new"><Button>Onboard client</Button></Link>} />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Client</Th><Th>Status</Th><Th>Website</Th><Th className="text-right">Clicks (28d)</Th><Th className="text-right">Leads</Th>
              <Th className="text-right">Tasks done</Th><Th>Billing</Th><Th className="text-right">AI this month</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.client_id} className="hover:bg-slate-50">
                <Td><Link href={`/agency/clients/${r.client_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link></Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td>{r.site_status ? <StatusBadge status={r.site_status} /> : <span className="text-slate-400">none</span>}</Td>
                <Td className="text-right tabular-nums">{formatNumber(r.clicks)}</Td>
                <Td className="text-right tabular-nums">{r.leads}</Td>
                <Td className="text-right tabular-nums">{r.tasks_done}</Td>
                <Td>{r.subscription_status ? <StatusBadge status={r.subscription_status} /> : "—"}{r.mrr_cents ? <span className="ml-2 text-xs text-slate-500">{formatUsd(r.mrr_cents / 100)}/mo</span> : null}</Td>
                <Td className="text-right tabular-nums">{formatUsd(r.ai_cost_month)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!rows.length && <p className="p-6 text-sm text-slate-500">No clients yet.</p>}
      </Card>
    </>
  );
}
