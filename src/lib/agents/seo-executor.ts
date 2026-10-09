import "server-only";
import { z } from "zod";
import { runAgent, tool, type MockAgent } from "@/lib/ai";
import type { Client, Site, Task } from "@/lib/db/types";
import type { RunLogger } from "@/lib/runs";
import type { ChangeOp } from "@/lib/site/changes";
import { loadPages } from "@/lib/site/repo";
import { pathForSlug, type PageState } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";
import { adminClient } from "@/lib/supabase/admin";
import { daysAgo, isoDate, slugify } from "@/lib/utils";
import { mockPageBlocks } from "./mocks";
import { fitMeta } from "./site-builder";
import { EDITOR_SYSTEM } from "./site-editor";
import { siteTools, type SiteToolContext } from "./site-tools";

const KIND_GUIDE: Record<string, string> = {
  meta_optimize:
    "Rewrite title tags / meta descriptions (and H1 if weak) for the target page(s). Use the page's Search Console queries: lead with the highest-impression relevant query, add a reason to click. Title 30-60 chars, meta 120-155.",
  internal_links:
    "Add 3-6 contextual internal links pointing at the target page from relevant pages, using descriptive anchor text that appears naturally in their copy (add_internal_link ops). Never link a page to itself.",
  content_expand:
    "Strengthen the target page for its keyword: add or improve sections (process, pricing factors, local relevance, FAQ answering real questions). Use insert_block / update_block. Keep it factual.",
  new_service_page: "Create one new service page (create_page, publish false) targeting the keyword, then link to it from the home page and a related page.",
  new_location_page: "Create one new location page (create_page, publish false) for the area, then link to it from the home page or an existing location page.",
  new_blog_post: "Create one helpful article (type blog, 700+ words, publish false) answering a real question, linking to the relevant service page.",
  schema_markup: "Add an FAQ block where questions are genuinely useful; structured data is generated from blocks automatically.",
  alt_text: "Set descriptive alt text on images missing it.",
  technical_fix: "Fix the on-page technical issue described (duplicate titles, missing H1, broken internal links, orphan pages).",
};

function dataTools(clientId: string) {
  return [
    tool({
      name: "page_search_performance",
      description: "Search Console queries for one page over the last 28 days (clicks, impressions, CTR, average position).",
      schema: z.object({ page_slug: z.string().describe("slug, '' for home") }),
      run: async ({ page_slug }) => {
        const { data } = await adminClient()
          .from("gsc_daily")
          .select("query, clicks, impressions, position")
          .eq("client_id", clientId)
          .gte("date", isoDate(daysAgo(28)))
          .like("page", page_slug ? `%/${page_slug}` : "%/")
          .limit(2000);
        const agg = new Map<string, { clicks: number; impressions: number; pos: number }>();
        for (const r of data ?? []) {
          const a = agg.get(r.query as string) ?? { clicks: 0, impressions: 0, pos: 0 };
          a.clicks += r.clicks as number;
          a.impressions += r.impressions as number;
          a.pos += Number(r.position) * (r.impressions as number);
          agg.set(r.query as string, a);
        }
        const rows = [...agg.entries()].map(([query, a]) => ({ query, clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? +(a.clicks / a.impressions).toFixed(3) : 0, position: a.impressions ? +(a.pos / a.impressions).toFixed(1) : null }));
        return rows.sort((a, b) => b.impressions - a.impressions).slice(0, 25);
      },
    }),
    tool({
      name: "keyword_data",
      description: "The client's researched keywords with (possibly estimated) volume, difficulty and intent.",
      schema: z.object({}),
      run: async () => {
        const { data } = await adminClient().from("keywords").select("keyword, location, search_volume, difficulty, intent, is_estimate, tracked").eq("client_id", clientId).order("search_volume", { ascending: false, nullsFirst: false }).limit(60);
        return data ?? [];
      },
    }),
    tool({
      name: "competitor_pages",
      description: "Competing pages found during research (domain, position, word count, notes).",
      schema: z.object({ keyword: z.string().optional() }),
      run: async ({ keyword }) => {
        let q = adminClient().from("competitors").select("keyword, domain, url, position, analysis").eq("client_id", clientId).order("found_at", { ascending: false }).limit(15);
        if (keyword) q = q.eq("keyword", keyword);
        return (await q).data ?? [];
      },
    }),
  ];
}

export async function executeTask(log: RunLogger, input: { task: Task; client: Client; site: Site }) {
  const { task, client, site } = input;
  const ctx: SiteToolContext = { site, client, runId: log.runId, taskId: task.id, changeSets: [] };
  const payload = task.payload as { target_page?: string | null; target_keyword?: string | null; new_page_slug?: string | null };
  await log.log("step", `Executing task: ${task.title}`);
  const pages = await loadPages(site.id);

  const result = await runAgent(log, {
    purpose: `task_${task.kind}`,
    tier: task.kind.startsWith("new_") || task.kind === "content_expand" ? "planner" : "fast",
    system: `${EDITOR_SYSTEM}\n\nYou are executing one SEO task from a campaign. Gather the data you need with the tools, then make the change with propose_changes. If the task turns out to be unnecessary (already done), make no change and explain why.`,
    prompt: `Task (${task.kind}): ${task.title}
Details: ${task.description ?? ""}
Target page: ${payload.target_page ?? "n/a"} · Target keyword: ${payload.target_keyword ?? "n/a"} · Suggested new slug: ${payload.new_page_slug ?? "n/a"}
How to do this kind of task: ${KIND_GUIDE[task.kind] ?? "Use your judgement."}
Business: ${JSON.stringify(site.business)}`,
    tools: [...siteTools(ctx), ...dataTools(client.id)],
    maxSteps: 12,
    mock: mockExecutor(task, site, pages),
  });
  return { summary: result.text, changeSets: ctx.changeSets, stoppedEarly: result.stoppedEarly, toolCalls: result.toolCalls.length };
}

/** Deterministic executor used in mock mode: one representative change per task kind. */
export function mockOpsFor(task: Pick<Task, "kind" | "payload" | "title">, site: Pick<Site, "business">, pages: PageState[]): ChangeOp[] {
  const payload = task.payload as { target_page?: string | null; target_keyword?: string | null; new_page_slug?: string | null };
  const target = pages.find((p) => p.slug === (payload.target_page ?? "")) ?? pages.find((p) => p.type === "service") ?? pages[0]!;
  const kw = payload.target_keyword ?? target.target_keyword ?? target.h1;
  switch (task.kind) {
    case "meta_optimize": {
      const m = fitMeta({ ...target, target_keyword: kw }, site.business.name);
      return [{ op: "set_meta", page: target.slug, title: m.title, meta_description: m.meta_description.length >= 50 ? m.meta_description : `${m.meta_description} Call today for a free, no-obligation quote.` }];
    }
    case "internal_links": {
      const sources = pages.filter((p) => p.id !== target.id && p.blocks.some((b) => b.type === "rich_text")).slice(0, 2);
      return sources.map((s) => ({ op: "add_internal_link" as const, page: s.slug, anchor_text: (kw ?? "our services").slice(0, 60), target_path: pathForSlug(target.slug) === "/" ? "/" : pathForSlug(target.slug) })).filter((o) => o.target_path !== "/");
    }
    case "new_location_page":
    case "new_service_page":
    case "new_blog_post": {
      const location = site.business.locations.find((l) => (payload.new_page_slug ?? "").includes(slugify(l))) ?? site.business.locations[0] ?? "the area";
      const slug = payload.new_page_slug && !pages.some((p) => p.slug === payload.new_page_slug) ? payload.new_page_slug : `areas/${slugify(location)}-${Date.now().toString(36)}`;
      const plan = { theme: { primary: "#000000", accent: "#000000", font: "sans" as const, logoText: "" }, pages: pages.map((p) => ({ slug: p.slug, type: p.type, title: p.title, h1: p.h1, meta_description: p.meta_description, target_keyword: p.target_keyword ?? "", brief: "" })) };
      const pagePlan = { slug, type: (task.kind === "new_blog_post" ? "blog" : task.kind === "new_service_page" ? "service" : "location") as "location", title: `${kw} | ${site.business.name}`.slice(0, 60), h1: `${kw}`.slice(0, 120), meta_description: `Looking for ${kw}? ${site.business.name} offers fast, friendly local service. Call today for a free quote.`.slice(0, 160), target_keyword: kw ?? "", location, brief: "" };
      return [
        { op: "create_page", publish: false, page: { slug, type: pagePlan.type, title: pagePlan.title.length >= 10 ? pagePlan.title : `${pagePlan.title} services`, meta_description: pagePlan.meta_description, h1: pagePlan.h1, target_keyword: kw, blocks: mockPageBlocks(site.business, plan, pagePlan) } },
      ];
    }
    case "alt_text":
    case "technical_fix":
    case "schema_markup":
    case "content_expand":
    default: {
      const has = target.blocks.some((b) => b.id === "faq-extra");
      if (has) return [];
      return [
        {
          op: "insert_block",
          page: target.slug,
          after_block_id: null,
          block: {
            id: "faq-extra",
            type: "faq",
            heading: `More questions about ${kw}`,
            items: [
              { question: `How much does ${kw} cost?`, answer: "Every job is different, so we give a clear written quote before any work starts. There are no call-out surprises." },
              { question: `Can you help today?`, answer: "Call us and we'll tell you the earliest slot available; urgent jobs are prioritised." },
            ],
          },
        },
      ];
    }
  }
}

function mockExecutor(task: Task, site: Site, pages: PageState[]): MockAgent {
  return (step) => {
    if (step === 0) return { toolCalls: [{ name: "list_pages", args: {} }, { name: "page_search_performance", args: { page_slug: (task.payload as { target_page?: string }).target_page ?? "" } }] };
    if (step === 1) {
      const ops = mockOpsFor(task, site, pages);
      if (!ops.length) return { text: "No change needed: the page already covers this." };
      return { toolCalls: [{ name: "propose_changes", args: { summary: task.title, rationale: `${KIND_GUIDE[task.kind]?.split(".")[0] ?? "Planned campaign task"}. The site currently has ${lintSite(pages).length} on-page findings.`, ops } }] };
    }
    return { text: `Completed: ${task.title}` };
  };
}
