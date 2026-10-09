import Link from "next/link";
import { notFound } from "next/navigation";
import { TabLink } from "@/components/agency/nav";
import { StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Client } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("*").eq("id", id).eq("agency_id", staff.agency.id).maybeSingle();
  if (!data) notFound();
  const client = data as Client;
  const base = `/agency/clients/${id}`;
  return (
    <>
      <div className="mb-6">
        <Link href="/agency/clients" className="text-sm text-slate-500 hover:text-slate-800">← Clients</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{client.name}</h1>
          <StatusBadge status={client.status} />
          <span className="text-sm text-slate-500">{[client.industry, client.primary_location].filter(Boolean).join(" · ")}</span>
        </div>
        <nav className="mt-5 flex gap-6 overflow-x-auto border-b border-slate-200">
          <TabLink href={base} exact>Overview</TabLink>
          <TabLink href={`${base}/site`}>Website</TabLink>
          <TabLink href={`${base}/seo`}>SEO campaign</TabLink>
          <TabLink href={`${base}/keywords`}>Keywords</TabLink>
          <TabLink href={`${base}/audits`}>Audits</TabLink>
          <TabLink href={`${base}/leads`}>Leads</TabLink>
          <TabLink href={`${base}/settings`}>Settings</TabLink>
        </nav>
      </div>
      {children}
    </>
  );
}
