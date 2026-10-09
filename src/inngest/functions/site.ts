import { inngest } from "../client";
import { LLM_CONCURRENCY, failRun, rethrow } from "./shared";
import { assemblePages, planSite, repairMeta, stripBrokenLinks, strengthenLinking, writePage, type SitePlan } from "@/lib/agents/site-builder";
import { runSiteEditAgent } from "@/lib/agents/site-editor";
import { runLogger, setRunStatus } from "@/lib/runs";
import { getClient, getSite, newPageId, publishSite, replaceSitePages } from "@/lib/site/repo";
import { lintSite, lintScore } from "@/lib/site/seo-lint";
import { adminClient } from "@/lib/supabase/admin";
import type { Block } from "@/lib/site/schema";

export const generateSite = inngest.createFunction(
  {
    id: "site-generate",
    name: "Generate website",
    retries: 2,
    concurrency: [{ key: "event.data.siteId", limit: 1 }, LLM_CONCURRENCY],
    onFailure: async ({ event, error }) => {
      const { runId, siteId } = event.data.event.data;
      await failRun(runId, error);
      await adminClient().from("sites").update({ status: "failed" }).eq("id", siteId);
    },
  },
  { event: "site/generate.requested" },
  async ({ event, step }) => {
    const { runId, siteId } = event.data;

    const site = await step.run("start", async () => {
      await setRunStatus(runId, "running");
      await adminClient().from("sites").update({ status: "generating" }).eq("id", siteId);
      return getSite(siteId);
    });

    const plan: SitePlan = await step.run("plan-site", async () => {
      const log = await runLogger(runId);
      try {
        const p = await planSite(log, site.business, site.instructions);
        await log.log("step", `Planned ${p.pages.length} pages`, { pages: p.pages.map((x) => `/${x.slug} → ${x.target_keyword}`) });
        return p;
      } catch (err) {
        rethrow(err);
      }
    });

    // Write pages in small batches: each page is its own retryable, memoised step.
    const contents = new Map<string, Block[]>();
    const BATCH = 3;
    for (let i = 0; i < plan.pages.length; i += BATCH) {
      const batch = plan.pages.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((page) =>
          step.run(`write-page-${page.slug || "home"}`, async () => {
            const log = await runLogger(runId);
            try {
              const blocks = await writePage(log, site.business, plan, page);
              await log.log("step", `Wrote /${page.slug}`, { blocks: blocks.length });
              return blocks;
            } catch (err) {
              rethrow(err);
            }
          }),
        ),
      );
      batch.forEach((page, j) => contents.set(page.slug, results[j] as Block[]));
    }

    const summary = await step.run("assemble-and-save", async () => {
      const log = await runLogger(runId);
      let pages = assemblePages(plan, contents, newPageId);
      pages = stripBrokenLinks(strengthenLinking(pages, plan.pages));
      pages = await repairMeta(log, site.business, pages);
      await replaceSitePages(site, pages);
      await adminClient().from("sites").update({ status: "draft", theme: plan.theme }).eq("id", siteId);
      const issues = lintSite(pages.map((p) => ({ ...p, status: "published" as const })));
      const score = lintScore(issues, pages.length);
      await log.log("step", `Saved ${pages.length} draft pages (on-page SEO score ${score})`, { issues: issues.slice(0, 20) });
      // Seed the keyword list from the plan so tracking starts immediately.
      const location = site.business.locations[0] ?? "";
      await adminClient()
        .from("keywords")
        .upsert(
          plan.pages.filter((p) => p.target_keyword).map((p) => ({ client_id: site.client_id, keyword: p.target_keyword.toLowerCase(), location, source: "ai_estimate", is_estimate: true, tracked: true })),
          { onConflict: "client_id,keyword,location", ignoreDuplicates: true },
        );
      return { pages: pages.length, score, issues: issues.length };
    });

    if (event.data.publish) {
      await step.run("publish", async () => {
        await publishSite(siteId);
        await (await runLogger(runId)).log("status", "Site published");
      });
    }

    await step.run("finish", async () => {
      const client = await getClient(site.client_id);
      if (client.status === "onboarding") await adminClient().from("clients").update({ status: "active" }).eq("id", client.id);
      await setRunStatus(runId, "succeeded", { output: summary });
    });
    return summary;
  },
);

export const editSite = inngest.createFunction(
  {
    id: "site-edit",
    name: "Edit website from instruction",
    retries: 1,
    concurrency: [{ key: "event.data.siteId", limit: 1 }, LLM_CONCURRENCY],
    onFailure: async ({ event, error }) => failRun(event.data.event.data.runId, error),
  },
  { event: "site/edit.requested" },
  async ({ event, step }) => {
    const { runId, siteId, instruction } = event.data;
    return step.run("edit", async () => {
      await setRunStatus(runId, "running");
      const log = await runLogger(runId);
      const site = await getSite(siteId);
      const client = await getClient(site.client_id);
      try {
        const out = await runSiteEditAgent(log, { site, client, instruction });
        const pending = out.changeSets.filter((c) => c.status === "proposed").length;
        await setRunStatus(runId, pending ? "awaiting_approval" : "succeeded", { output: out });
        return out;
      } catch (err) {
        rethrow(err);
      }
    });
  },
);
