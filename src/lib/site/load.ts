import "server-only";
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { requireEnv } from "@/lib/env";
import type { PageRow, Site } from "@/lib/db/types";
import { parseBlocks, type PageState } from "./schema";

export const SITE_COLUMNS = "id, client_id, subdomain, custom_domain, status, theme, business, published_at";

export function siteTag(siteId: string) {
  return `site:${siteId}`;
}

let anon: SupabaseClient | undefined;
/** Anonymous client: RLS only exposes published sites/pages to it. */
function publicClient() {
  anon ??= createSupabase(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return anon;
}

export function toPageState(row: Pick<PageRow, "id" | "slug" | "type" | "title" | "meta_description" | "h1" | "blocks" | "target_keyword" | "status" | "noindex" | "version">): PageState {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    meta_description: row.meta_description,
    h1: row.h1,
    blocks: parseBlocks(row.blocks),
    target_keyword: row.target_keyword,
    status: row.status,
    noindex: row.noindex,
    version: row.version,
  };
}

export const PAGE_COLUMNS = "id, slug, type, title, meta_description, h1, blocks, target_keyword, status, noindex, version";

export type SiteBundle = { site: Pick<Site, "id" | "client_id" | "subdomain" | "custom_domain" | "status" | "theme" | "business" | "published_at">; pages: PageState[] };

/** Resolve a rewritten host key (`sub~acme` / `dom~acme.co.uk`) to its published site id. */
export const resolveSiteKey = (key: string) =>
  unstable_cache(
    async () => {
      const decoded = decodeURIComponent(key);
      const [kind, value] = decoded.split("~") as [string, string];
      const q = publicClient().from("sites").select("id").eq("status", "published");
      const { data } = await (kind === "dom" ? q.eq("custom_domain", value) : q.eq("subdomain", value)).maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    ["site-key", key],
    { revalidate: 300, tags: [`site-key:${key}`] },
  )();

/** Published site + all published pages, cached until the site's tag is revalidated. */
export const loadPublishedSite = (siteId: string) =>
  unstable_cache(
    async (): Promise<SiteBundle | null> => {
      const db = publicClient();
      const [{ data: site }, { data: pages }] = await Promise.all([
        db.from("sites").select(SITE_COLUMNS).eq("id", siteId).eq("status", "published").maybeSingle(),
        db.from("pages").select(PAGE_COLUMNS).eq("site_id", siteId).eq("status", "published"),
      ]);
      if (!site) return null;
      return { site: site as SiteBundle["site"], pages: (pages ?? []).map((p) => toPageState(p as PageRow)) };
    },
    ["site-bundle", siteId],
    { revalidate: 3600, tags: [siteTag(siteId)] },
  )();

export const loadRedirect = (siteId: string, path: string) =>
  unstable_cache(
    async () => {
      const { data } = await publicClient().from("redirects").select("to_path").eq("site_id", siteId).eq("from_path", path).maybeSingle();
      return (data?.to_path as string | undefined) ?? null;
    },
    ["site-redirect", siteId, path],
    { revalidate: 3600, tags: [siteTag(siteId)] },
  )();
