import "server-only";
import { z } from "zod";
import { generateJson } from "@/lib/ai";
import type { Campaign, Client, Site, TaskKind } from "@/lib/db/types";
import type { RunLogger } from "@/lib/runs";
import { loadPages } from "@/lib/site/repo";
import { pageText, pathForSlug, wordCount, type PageState } from "@/lib/site/schema";
import { lintSite } from "@/lib/site/seo-lint";
import { adminClient } from "@/lib/supabase/admin";
import { daysAgo, isoDate, slugify } from "@/lib/utils";
import { analyseCompetitors, keywordResearch, type CompetitorInsight, type ResearchedKeyword } from "./seo-research";

export const TASK_KINDS = [
  "meta_optimize",
  "content_expand",
  "new_service_page",
  "new_location_page",
  "new_blog_post",
  "internal_links",
  "schema_markup",
  "alt_text",
  "technical_fix",
] as const satisfies readonly TaskKind[];

/** Default risk per task kind; the change-set policy makes the final call per edit. */
export const TASK_RISK: Record<(typeof TASK_KINDS)[number], "low" | "medium" | "high"> = {
  meta_optimize: "low",
  internal_links: "low",
  alt_text: "low",
  schema_markup: "low",
  technical_fix: "medium",
  content_expand: "medium",
  new_service_page: "medium",
  new_location_page: "medium",
  new_blog_post: "medium",
};

export const campaignPlan = z.object({
  summary: z.string().max(1500).describe("Strategy in 3-5 sentences: where the site stands and how the plan wins"),
  insights: z.array(z.string().max(300)).max(10).describe("Key findings from the data (rankings, competitors, gaps)"),
  tasks: z
    .array(
      z.object({
        kind: z.enum(TASK_KINDS),
        title: z.string().max(140),
        description: z.string().max(1200).describe("Exactly what to do and why, with the data that justifies it"),
        target_page: z.string().nullable().describe("Existing page slug to change ('' = home), or null for new pages"),
        target_keyword: z.string().max(120).nullable(),
        new_page_slug: z.string().nullable().describe("For new_* tasks: proposed slug"),
        priority: z.number().int().min(1).max(100),
        start_in_days: z.number().int().min(0).max(90).describe("Stagger work: quick wins first, bigger content later"),
      }),
    )
    .min(1)
    .max(15),
});
export type CampaignPlan = z.infer<typeof campaignPlan>;

const PLANNER_SYSTEM = `You are the head of SEO at an agency, planning a campaign that AI agents will execute.
Plan concrete, high-leverage tasks grounded in the data provided. Prefer: fixing on-page basics on pages that
already have impressions (fast wins), expanding pages in striking distance (positions 5-20), creating missing
service/location pages for clear demand, and strengthening internal links to target pages. Avoid duplicate pages
that would cannibalise existing ones. Never plan link buying, fake reviews, doorway pages or keyword stuffing.
Each task must be executable by editing this website.`;

function pagesSummary(pages: PageState[]) {
  return pages.map((p) => ({ path: pathForSlug(p.slug), slug: p.slug, type: p.type, title: p.title, h1: p.h1, keyword: p.target_keyword, words: wordCount(pageText(p)), status: p.status }));
}

export async function planCampaign(log: RunLogger, input: { campaign: Campaign; client: Client; site: Site }): Promise<{ plan: CampaignPlan; keywords: ResearchedKeyword[]; competitors: CompetitorInsight[] }> {
  const { campaign, client, site } = input;
  const location = campaign.target_location ?? client.primary_location ?? site.business.locations[0] ?? "";
  const pages = await loadPages(site.id);

  const keywords = await keywordResearch(log, { client, site, goal: campaign.goal, seeds: campaign.target_keywords, location });
  const focus = campaign.target_keywords[0] ?? keywords.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0]?.keyword ?? campaign.goal;
  const competitors = await analyseCompetitors(log, { client, site, keyword: focus, location, campaignId: campaign.id });

  const db = adminClient();
  const [{ data: topPages }, { data: audit }] = await Promise.all([
    db.rpc("client_top_pages", { p_client: client.id, p_from: isoDate(daysAgo(28)), p_to: isoDate(new Date()), p_limit: 20 }),
    db.from("audit_issues").select("page_url, check_id, severity, message").eq("client_id", client.id).is("resolved_at", null).limit(40),
  ]);
  const lint = lintSite(pages).slice(0, 40);

  await log.log("step", "Drafting campaign plan");
  const { data: plan } = await generateJson(log, {
    purpose: "campaign_plan",
    tier: "planner",
    system: PLANNER_SYSTEM,
    schema: campaignPlan,
    prompt: `Campaign goal: ${campaign.goal}
Target location: ${location}. Focus keyword: ${focus}.
Business: ${JSON.stringify(site.business)}

Website pages: ${JSON.stringify(pagesSummary(pages))}
Search Console (28 days, by page): ${JSON.stringify(topPages ?? [])}
Keyword research (volumes may be estimates): ${JSON.stringify(keywords.slice(0, 30))}
Competitors ranking for "${focus}": ${JSON.stringify(competitors)}
On-page issues: ${JSON.stringify(lint.map((i) => `${pathForSlug(i.page)}: ${i.message}`))}
Technical audit issues: ${JSON.stringify((audit ?? []).map((i) => `${i.page_url}: ${i.message}`))}

Produce 5-12 tasks.`,
    mock: () => mockPlan(campaign, pages, focus, location),
  });
  return { plan, keywords, competitors };
}

export function mockPlan(campaign: Campaign, pages: PageState[], focus: string, location: string): CampaignPlan {
  const service = pages.find((p) => p.type === "service" && focus.includes((p.target_keyword ?? "").split(" ")[0] ?? "")) ?? pages.find((p) => p.type === "service") ?? pages[0];
  const hasLocationPage = pages.some((p) => p.slug.includes(slugify(location)));
  const tasks: CampaignPlan["tasks"] = [
    { kind: "meta_optimize", title: `Optimise title & meta for "${focus}"`, description: `Rewrite the title and meta description of /${service?.slug ?? ""} to lead with "${focus}" and improve click-through.`, target_page: service?.slug ?? "", target_keyword: focus, new_page_slug: null, priority: 90, start_in_days: 0 },
    { kind: "internal_links", title: `Point internal links at /${service?.slug ?? ""}`, description: `Add contextual links with "${focus}"-style anchors from related pages.`, target_page: service?.slug ?? "", target_keyword: focus, new_page_slug: null, priority: 80, start_in_days: 0 },
    { kind: "content_expand", title: `Expand /${service?.slug ?? ""} with an FAQ`, description: `Competitors answer common questions; add an FAQ section covering ${focus}.`, target_page: service?.slug ?? "", target_keyword: focus, new_page_slug: null, priority: 70, start_in_days: 1 },
  ];
  if (!hasLocationPage && location)
    tasks.push({ kind: "new_location_page", title: `Create a ${location} page`, description: `There is demand in ${location} but no dedicated page.`, target_page: null, target_keyword: `${focus}`, new_page_slug: `areas/${slugify(location)}`, priority: 60, start_in_days: 2 });
  return { summary: `Start with quick on-page wins on /${service?.slug ?? ""}, the page closest to ranking for "${focus}", then add content depth and local coverage around ${location || "the service area"}.`, insights: [`Focus keyword: ${focus}`, `/${service?.slug ?? ""} is the strongest existing page for this topic.`], tasks };
}

/** Persist the plan's tasks, staggered by start_in_days. */
export async function saveCampaignTasks(campaign: Campaign, plan: CampaignPlan): Promise<string[]> {
  const now = Date.now();
  const rows = plan.tasks.map((t) => ({
    client_id: campaign.client_id,
    campaign_id: campaign.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    risk: TASK_RISK[t.kind],
    priority: t.priority,
    scheduled_for: new Date(now + t.start_in_days * 86_400_000).toISOString(),
    payload: { target_page: t.target_page, target_keyword: t.target_keyword, new_page_slug: t.new_page_slug },
  }));
  const { data, error } = await adminClient().from("tasks").insert(rows).select("id");
  if (error) throw new Error(`saveCampaignTasks: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}
