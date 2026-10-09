import Link from "next/link";
import { RunList } from "@/components/agency/run-list";
import { Card, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Run } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Activity" };

const FILTERS = ["all", "running", "awaiting_approval", "failed", "succeeded"] as const;

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const { status = "all", page = "0" } = await searchParams;
  const staff = await requireStaff();
  const supabase = await createClient();
  const p = Math.max(0, Number(page) || 0);
  let q = supabase.from("runs").select("*").eq("agency_id", staff.agency.id).order("created_at", { ascending: false }).range(p * 50, p * 50 + 49);
  if (status !== "all") q = q.eq("status", status);
  const [{ data: runs }, { data: clients }] = await Promise.all([q, supabase.from("clients").select("id, name").eq("agency_id", staff.agency.id)]);
  const names = Object.fromEntries((clients ?? []).map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader title="Activity" description="Complete history of everything the AI has done." />
      <div className="mb-4 flex gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f} href={`/agency/runs?status=${f}`} className={`rounded-full px-3 py-1 ${f === status ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            {f.replace("_", " ")}
          </Link>
        ))}
      </div>
      <Card>
        <RunList runs={(runs ?? []) as Run[]} clients={names} />
      </Card>
      <div className="mt-4 flex justify-between text-sm">
        {p > 0 ? <Link href={`/agency/runs?status=${status}&page=${p - 1}`} className="text-brand-600">← Newer</Link> : <span />}
        {(runs?.length ?? 0) === 50 && <Link href={`/agency/runs?status=${status}&page=${p + 1}`} className="text-brand-600">Older →</Link>}
      </div>
    </>
  );
}
