import { LeadsTable } from "@/components/dashboard/leads-table";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { assertClientStaff } from "@/lib/access";
import type { Lead } from "@/lib/db/types";

export default async function LeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await assertClientStaff(id);
  const { data } = await supabase.from("leads").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(200);
  const leads = (data ?? []) as Lead[];
  return (
    <Card>
      <CardHeader title={`Enquiries (${leads.length})`} description="Submitted through contact forms on the generated website." />
      {leads.length ? <LeadsTable leads={leads} /> : <div className="p-5"><EmptyState title="No enquiries yet" /></div>}
    </Card>
  );
}
