import "server-only";
import { runAgent } from "@/lib/ai";
import type { Client, Site } from "@/lib/db/types";
import type { RunLogger } from "@/lib/runs";
import { BLOCK_GUIDE, fitMeta } from "./site-builder";
import { siteTools, type SiteToolContext } from "./site-tools";

export const EDITOR_SYSTEM = `You are the website editor for a digital marketing agency. You change client websites
by calling tools; you never just describe changes. Workflow: call list_pages, read the pages you need with get_page,
then submit ONE propose_changes call containing all ops for the request (split only if they are unrelated).

Content rules:
- Facts must come from the business information or the existing site. Never invent prices, awards, reviews,
  accreditations or years of experience.
- Keep each page focused on its target keyword; do not create pages that compete with existing ones.
- New pages need a hero, substantial rich_text copy (400+ words), an FAQ and a CTA, plus internal links.
- Inline links use markdown [anchor](/path) and must point to existing pages.
- update_block replaces the whole block: include every field of the block, not just the changed parts.

${BLOCK_GUIDE}

When done, reply with a short plain-English summary of what changed and what (if anything) awaits approval.`;

export async function runSiteEditAgent(log: RunLogger, input: { site: Site; client: Client; instruction: string }) {
  const ctx: SiteToolContext = { site: input.site, client: input.client, runId: log.runId, changeSets: [] };
  await log.log("step", `Editing site: ${input.instruction}`);
  const result = await runAgent(log, {
    purpose: "site_edit",
    tier: "planner",
    system: EDITOR_SYSTEM,
    prompt: `Business: ${JSON.stringify(input.site.business)}\n\nInstruction from the agency: ${input.instruction}`,
    tools: siteTools(ctx),
    maxSteps: 10,
    mock: (step, last) => {
      if (step === 0) return { toolCalls: [{ name: "list_pages", args: {} }] };
      if (step === 1) {
        const pages = (last[0]?.result ?? []) as { slug: string; title: string; meta_description: string; h1: string; target_keyword: string | null }[];
        const target = pages.find((p) => p.slug !== "") ?? pages[0];
        if (!target) return { text: "The site has no pages yet." };
        const meta = fitMeta(target, input.site.business.name);
        return {
          toolCalls: [
            {
              name: "propose_changes",
              args: {
                summary: `Tighten title and meta description on /${target.slug}`,
                rationale: `Requested by the agency: ${input.instruction}`,
                ops: [{ op: "set_meta", page: target.slug, title: meta.title, meta_description: meta.meta_description }],
              },
            },
          ],
        };
      }
      return { text: "Updated the page metadata as requested." };
    },
  });
  return { summary: result.text, changeSets: ctx.changeSets, steps: result.steps };
}
