import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site/site-page";
import { getViewer } from "@/lib/auth";
import type { PageRow, Site } from "@/lib/db/types";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { PAGE_COLUMNS, toPageState } from "@/lib/site/load";
import { createClient } from "@/lib/supabase/server";

export const metadata = { robots: { index: false, follow: false } };

/** Staff/client preview of a site including draft pages. Access is enforced by RLS. */
export default async function PreviewPage({ params }: { params: Promise<{ siteId: string; slug?: string[] }> }) {
  const { siteId, slug } = await params;
  const viewer = await getViewer();
  if (!viewer) notFound();
  const supabase = await createClient();
  const [{ data: site }, { data: rows }] = await Promise.all([
    supabase.from("sites").select("*").eq("id", siteId).maybeSingle(),
    supabase.from("pages").select(PAGE_COLUMNS).eq("site_id", siteId).neq("status", "archived"),
  ]);
  if (!site) notFound();
  const pages = (rows ?? []).map((r) => toPageState(r as PageRow));
  const page = pages.find((p) => p.slug === (slug ?? []).join("/"));
  if (!page) notFound();
  const s = site as Site;
  const banner = (
    <div className="flex items-center justify-between bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>
        Preview · page is <b>{page.status}</b> · site is <b>{s.status}</b>
      </span>
      <Link href={`/agency/clients/${s.client_id}/site`} className="underline">Back to dashboard</Link>
    </div>
  );
  return <SitePage site={s} pages={pages} page={page} baseUrl={siteUrl(s, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL)} linkPrefix={`/preview/${siteId}`} banner={banner} />;
}
