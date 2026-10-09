import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { loadPublishedSite, resolveSiteKey } from "@/lib/site/load";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const siteId = await resolveSiteKey(key);
  const bundle = siteId ? await loadPublishedSite(siteId) : null;
  if (!bundle) return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
  const base = siteUrl({ ...bundle.site, domain_verified: !!bundle.site.custom_domain }, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL);
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
}
