import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { loadSiteByKey } from "@/lib/site/load";
import { pathForSlug } from "@/lib/site/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const bundle = await loadSiteByKey(key);
  if (!bundle) return new Response("Not found", { status: 404 });
  const base = siteUrl({ ...bundle.site, domain_verified: !!bundle.site.custom_domain }, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL);
  const urls = bundle.pages
    .filter((p) => !p.noindex)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => `  <url><loc>${base}${pathForSlug(p.slug)}</loc><priority>${p.type === "home" ? "1.0" : p.type === "blog" ? "0.5" : "0.8"}</priority></url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
