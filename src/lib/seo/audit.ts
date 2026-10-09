import "server-only";
import { crawlSite } from "@/lib/audit/crawler";
import { auditScore, technicalIssues } from "@/lib/audit/checks";
import { env } from "@/lib/env";
import { fetchableUrl, siteUrl } from "@/lib/hosts";
import { accessToken, getGoogleIntegration, inspectUrl } from "@/lib/integrations/google";
import { pageSpeed } from "@/lib/integrations/pagespeed";
import type { RunLogger } from "@/lib/runs";
import { getSite, loadPages, primarySiteFor } from "@/lib/site/repo";
import { pathForSlug } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";
import { adminClient } from "@/lib/supabase/admin";
import { errorMessage } from "@/lib/utils";

export interface AuditSummary {
  auditId: string;
  score: number;
  pagesCrawled: number;
  critical: number;
  warnings: number;
  autoFixable: number;
}

/**
 * Full technical + on-page audit: live crawl, structured-content lint, PageSpeed for the
 * home page, and Search Console URL inspection (indexing) when Google is connected.
 */
export async function runAudit(log: RunLogger, clientId: string): Promise<AuditSummary> {
  const db = adminClient();
  const siteRow = await primarySiteFor(clientId);
  if (!siteRow) throw new Error("Client has no website to audit");
  const site = await getSite(siteRow.id);
  const base = siteUrl(site, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL);
  const { data: audit, error } = await db.from("audits").insert({ client_id: clientId, site_id: site.id, run_id: log.runId, status: "running" }).select("id").single();
  if (error) throw new Error(error.message);

  try {
    await log.log("step", `Crawling ${base}`);
    const pages = await loadPages(site.id);
    const crawl =
      site.status === "published"
        ? await crawlSite({ startUrl: base, maxPages: 60, mapUrl: (u) => fetchableUrl(u, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL) })
        : { pages: [], robotsTxt: null, sitemap: null };
    const tech = technicalIssues(crawl);
    const lint = lintSite(pages);
    await log.log("step", `Crawled ${crawl.pages.length} URLs: ${tech.length} technical and ${lint.length} on-page findings`);

    let psi = null;
    try {
      psi = await pageSpeed(base);
      if (psi) await log.log("step", `PageSpeed (mobile): performance ${psi.performance}, SEO ${psi.seo}`);
    } catch (err) {
      await log.log("step", `PageSpeed unavailable: ${errorMessage(err)}`, null, "warn");
    }

    const indexing: { url: string; verdict?: string; coverage?: string }[] = [];
    const google = await getGoogleIntegration(clientId);
    if (google?.gsc_property && google.status === "connected") {
      try {
        const token = await accessToken(google.id);
        for (const p of pages.filter((x) => x.status === "published").slice(0, 10)) {
          const url = `${base}${pathForSlug(p.slug)}`;
          const r = await inspectUrl(token, google.gsc_property, url);
          indexing.push({ url, verdict: r?.verdict, coverage: r?.coverageState });
        }
        await log.log("step", `Checked indexing for ${indexing.length} pages`, indexing);
      } catch (err) {
        await log.log("step", `Indexing check failed: ${errorMessage(err)}`, null, "warn");
      }
    }

    const pageIdByPath = new Map(pages.map((p) => [pathForSlug(p.slug), p.id]));
    const rows = [
      ...tech.map((i) => ({ page_url: i.url, check_id: i.check, severity: i.severity, message: i.message, auto_fixable: i.autoFixable, page_id: pageIdByPath.get(safePath(i.url)) ?? null })),
      ...lint.map((i) => ({ page_url: `${base}${pathForSlug(i.page)}`, check_id: i.check, severity: i.severity, message: i.message, auto_fixable: i.autoFixable, page_id: i.pageId ?? null })),
      ...indexing
        .filter((i) => i.verdict && i.verdict !== "PASS")
        .map((i) => ({ page_url: i.url, check_id: "not_indexed", severity: "warning" as const, message: `Not indexed: ${i.coverage ?? i.verdict}`, auto_fixable: false, page_id: pageIdByPath.get(safePath(i.url)) ?? null })),
    ].map((r) => ({ ...r, audit_id: audit.id, client_id: clientId }));
    if (rows.length) await db.from("audit_issues").insert(rows);

    const score = Math.round((auditScore(tech, Math.max(1, crawl.pages.length)) + auditScore(lint, Math.max(1, pages.length))) / 2);
    const summary = {
      critical: rows.filter((r) => r.severity === "critical").length,
      warnings: rows.filter((r) => r.severity === "warning").length,
      autoFixable: rows.filter((r) => r.auto_fixable).length,
      indexing,
    };
    await db.from("audits").update({ status: "completed", score, pages_crawled: crawl.pages.length, summary, pagespeed: psi, finished_at: new Date().toISOString() }).eq("id", audit.id);
    // Older findings are superseded by this audit.
    await db.from("audit_issues").update({ resolved_at: new Date().toISOString() }).eq("client_id", clientId).neq("audit_id", audit.id).is("resolved_at", null);
    await log.log("step", `Audit complete: score ${score}/100`, summary);
    return { auditId: audit.id as string, score, pagesCrawled: crawl.pages.length, critical: summary.critical, warnings: summary.warnings, autoFixable: summary.autoFixable };
  } catch (err) {
    await db.from("audits").update({ status: "failed", finished_at: new Date().toISOString(), summary: { error: errorMessage(err) } }).eq("id", audit.id);
    throw err;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return url;
  }
}
