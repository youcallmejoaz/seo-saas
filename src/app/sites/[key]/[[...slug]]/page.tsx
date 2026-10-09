import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { SitePage } from "@/components/site/site-page";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { loadPublishedSite, loadRedirect, resolveSiteKey } from "@/lib/site/load";
import { pathForSlug } from "@/lib/site/schema";

type Params = { params: Promise<{ key: string; slug?: string[] }> };

async function resolve({ params }: Params) {
  const { key, slug } = await params;
  const siteId = await resolveSiteKey(key);
  if (!siteId) return null;
  const bundle = await loadPublishedSite(siteId);
  if (!bundle) return null;
  const path = (slug ?? []).join("/");
  const page = bundle.pages.find((p) => p.slug === path) ?? null;
  const baseUrl = siteUrl({ ...bundle.site, domain_verified: !!bundle.site.custom_domain }, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL);
  return { ...bundle, page, path, baseUrl };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const r = await resolve(props);
  if (!r?.page) return { title: "Not found", robots: { index: false } };
  return {
    title: { absolute: r.page.title },
    description: r.page.meta_description,
    alternates: { canonical: `${r.baseUrl}${pathForSlug(r.page.slug)}` },
    robots: r.page.noindex ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { title: r.page.title, description: r.page.meta_description, url: `${r.baseUrl}${pathForSlug(r.page.slug)}`, siteName: r.site.business.name, type: "website" },
  };
}

export default async function PublicSitePage(props: Params) {
  const r = await resolve(props);
  if (!r) notFound();
  if (!r.page) {
    const to = await loadRedirect(r.site.id, `/${r.path}`);
    if (to) permanentRedirect(to);
    notFound();
  }
  return <SitePage site={r.site} pages={r.pages} page={r.page} baseUrl={r.baseUrl} />;
}
