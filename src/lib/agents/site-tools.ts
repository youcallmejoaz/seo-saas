import "server-only";
import { z } from "zod";
import { tool, type AgentTool } from "@/lib/ai";
import type { Client, Site } from "@/lib/db/types";
import { changeOp } from "@/lib/site/changes";
import { applyChangeSet, loadPages, proposeChangeSet } from "@/lib/site/repo";
import { internalLinks, pageText, pathForSlug, wordCount } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";

export interface SiteToolContext {
  site: Site;
  client: Client;
  runId: string;
  taskId?: string | null;
  /** Change sets created during this agent run. */
  changeSets: { id: string; status: string; summary: string; autoApplied: boolean }[];
}

export function siteTools(ctx: SiteToolContext): AgentTool[] {
  return [
    tool({
      name: "list_pages",
      description: "List every page on the client's website with its slug, type, title, H1, target keyword, status and word count.",
      schema: z.object({}),
      run: async () =>
        (await loadPages(ctx.site.id)).map((p) => ({
          id: p.id,
          path: pathForSlug(p.slug),
          slug: p.slug,
          type: p.type,
          status: p.status,
          title: p.title,
          h1: p.h1,
          meta_description: p.meta_description,
          target_keyword: p.target_keyword,
          words: wordCount(pageText(p)),
          links_to: internalLinks(p),
        })),
    }),
    tool({
      name: "get_page",
      description: "Get the full content of one page (all blocks with their ids) by slug ('' for home) or id.",
      schema: z.object({ page: z.string().describe("slug or id") }),
      run: async ({ page }) => {
        const p = (await loadPages(ctx.site.id)).find((x) => x.id === page || x.slug === page.replace(/^\//, ""));
        if (!p) throw new Error(`No page "${page}". Call list_pages for valid slugs.`);
        return p;
      },
    }),
    tool({
      name: "lint_site",
      description: "Run on-page SEO checks across the site (titles, meta, H1s, thin content, orphan pages, broken links).",
      schema: z.object({}),
      run: async () => lintSite(await loadPages(ctx.site.id)).slice(0, 60),
    }),
    tool({
      name: "propose_changes",
      description:
        "Submit one coherent set of edits to the website. Ops are validated against the live site. Low-risk changes the client's policy allows are applied immediately; others go to the agency's approval queue. Returns the change set status.",
      schema: z.object({
        summary: z.string().min(5).max(300).describe("One line describing the change for the activity log"),
        rationale: z.string().max(2000).describe("Why this improves rankings or conversions, referencing the data you used"),
        ops: z.array(changeOp).min(1).max(30),
      }),
      run: async ({ summary, rationale, ops }) => {
        const { changeSet, decision } = await proposeChangeSet({
          site: ctx.site,
          client: ctx.client,
          ops,
          summary,
          rationale,
          runId: ctx.runId,
          taskId: ctx.taskId,
        });
        let status: string = changeSet.status;
        if (decision.action === "auto_apply") {
          await applyChangeSet(changeSet.id);
          status = "applied";
        }
        ctx.changeSets.push({ id: changeSet.id, status, summary, autoApplied: decision.action === "auto_apply" });
        return { change_set_id: changeSet.id, status, risk: decision.risk, policy: decision.reason };
      },
    }),
  ];
}
