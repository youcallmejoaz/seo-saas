import { ChangeSetCard } from "@/components/agency/change-set-card";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { ChangeSetRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id, name").eq("agency_id", staff.agency.id);
  const names = Object.fromEntries((clients ?? []).map((c) => [c.id, c.name as string]));
  const ids = Object.keys(names);
  const [{ data: pending }, { data: recent }] = await Promise.all([
    ids.length ? supabase.from("change_sets").select("*").in("client_id", ids).eq("status", "proposed").order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("change_sets").select("*").in("client_id", ids).neq("status", "proposed").order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <PageHeader title="Approvals" description="Changes the AI wants to make that are above each client's auto-apply policy." />
      <Card>
        <CardHeader title={`Waiting for review (${pending?.length ?? 0})`} />
        <div className="divide-y divide-slate-100">
          {((pending ?? []) as ChangeSetRow[]).map((cs) => <ChangeSetCard key={cs.id} cs={cs} clientName={names[cs.client_id]} previewHref={`/preview/${cs.site_id}`} />)}
        </div>
        {!pending?.length && <div className="p-5"><EmptyState title="Nothing to review">The AI will add items here when a change needs a human.</EmptyState></div>}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Recently decided or auto-applied" />
        <div className="divide-y divide-slate-100">
          {((recent ?? []) as ChangeSetRow[]).map((cs) => <ChangeSetCard key={cs.id} cs={cs} clientName={names[cs.client_id]} />)}
        </div>
      </Card>
    </>
  );
}
