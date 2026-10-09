import Link from "next/link";
import { NavLink } from "@/components/agency/nav";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ count: approvals }, { count: failures }] = await Promise.all([
    supabase.from("change_sets").select("id", { count: "exact", head: true }).eq("status", "proposed"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 md:flex">
        <Link href="/agency" className="px-3 text-lg font-bold tracking-tight text-brand-700">RankPilot</Link>
        <p className="mt-1 truncate px-3 text-xs text-slate-500">{staff.agency.name}</p>
        <nav className="mt-6 space-y-1">
          <NavLink href="/agency" exact>Overview</NavLink>
          <NavLink href="/agency/command">AI command</NavLink>
          <NavLink href="/agency/clients">Clients</NavLink>
          <NavLink href="/agency/approvals" badge={approvals ?? 0}>Approvals</NavLink>
          <NavLink href="/agency/runs">Activity</NavLink>
          <NavLink href="/agency/failures" badge={failures ?? 0}>Failures</NavLink>
          <NavLink href="/agency/usage">AI usage</NavLink>
        </nav>
        <div className="mt-auto border-t border-slate-100 px-3 pt-4">
          <p className="truncate text-xs text-slate-500">{staff.email}</p>
          <form action="/auth/signout" method="post">
            <button className="mt-1 text-xs text-slate-500 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <Link href="/agency" className="font-bold text-brand-700">RankPilot</Link>
          <div className="flex gap-3 text-sm">
            <Link href="/agency/command">Command</Link>
            <Link href="/agency/clients">Clients</Link>
            <Link href="/agency/approvals">Approvals</Link>
          </div>
        </div>
        <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
