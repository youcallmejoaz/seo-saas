/**
 * Demo data for local development: an agency, two clients with AI-generated (mock) sites,
 * portal users, and ~90 days of synthetic Search Console / GA4 data so the dashboards
 * have something to show. All demo rows belong to the agency flagged settings.demo=true.
 *
 *   pnpm seed            (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
process.env.AI_MOCK = "1";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assemblePages, planSite, repairMeta, stripBrokenLinks, strengthenLinking, writePage } from "@/lib/agents/site-builder";
import type { BusinessInfo } from "@/lib/db/types";
import { memoryLogger } from "@/lib/runs";
import { pageToRow } from "@/lib/site/repo";
import { pathForSlug, type Block } from "@/lib/site/schema";
import { slugify } from "@/lib/utils";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";

async function user(email: string, name: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (data.user) return data.user.id;
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const found = list.users.find((u) => u.email === email);
  if (!found) throw error ?? new Error(`could not create ${email}`);
  return found.id;
}

function must<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error || r.data == null) throw new Error(`${what}: ${r.error?.message}`);
  return r.data as NonNullable<T>;
}

/** Stable ids, so reseeding keeps URLs, cached host mappings and bookmarks valid. */
function stableId(name: string): string {
  const h = createHash("sha1").update(`rankpilot-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Deterministic pseudo-random so reseeding gives the same charts.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

async function seedClient(agencyId: string, business: BusinessInfo, portalEmail: string, trend: number) {
  const client = must(
    await db.from("clients").insert({ id: stableId(`client:${business.name}`), agency_id: agencyId, name: business.name, industry: business.industry, primary_location: business.locations[0], phone: business.phone, contact_email: business.email, status: "active" }).select("*").single(),
    "client",
  );
  const site = must(
    await db.from("sites").insert({ id: stableId(`site:${business.name}`), client_id: client.id, subdomain: slugify(business.name).slice(0, 40), business, status: "published", published_at: new Date().toISOString() }).select("*").single(),
    "site",
  );

  // Generate the website with the real pipeline (mock model output).
  const log = memoryLogger({ clientId: client.id });
  const plan = await planSite(log, business, null, 4);
  const contents = new Map<string, Block[]>();
  for (const p of plan.pages) contents.set(p.slug, await writePage(log, business, plan, p));
  let pages = assemblePages(plan, contents, randomUUID);
  pages = stripBrokenLinks(strengthenLinking(pages, plan.pages));
  pages = await repairMeta(log, business, pages);
  must(await db.from("pages").insert(pages.map((p) => ({ ...pageToRow({ ...p, status: "published" }), site_id: site.id, client_id: client.id }))).select("id"), "pages");
  await db.from("sites").update({ theme: plan.theme }).eq("id", site.id);

  const portalUser = await user(portalEmail, `${business.name} owner`);
  await db.from("client_users").upsert({ client_id: client.id, user_id: portalUser });
  await db.from("subscriptions").insert({ client_id: client.id, status: "active", plan: "growth", mrr_cents: 49_900 });

  // Keywords + 90 days of Search Console / GA4 data with a gentle trend.
  const kws = [...new Map(plan.pages.filter((p) => p.target_keyword).map((p) => [p.target_keyword.toLowerCase(), { kw: p.target_keyword.toLowerCase(), slug: p.slug }])).values()];
  const keywordRows = must(
    await db.from("keywords").insert(kws.map((k, i) => ({ client_id: client.id, keyword: k.kw, location: business.locations[0], search_volume: 90 + ((i * 53) % 700), difficulty: 20 + ((i * 11) % 50), intent: "local", source: "ai_estimate", is_estimate: true, tracked: true }))).select("id, keyword"),
    "keywords",
  );
  const base = `https://${site.subdomain}.example`;
  const gsc: Record<string, unknown>[] = [];
  const ranks: Record<string, unknown>[] = [];
  const ga: Record<string, unknown>[] = [];
  for (let d = 90; d >= 1; d--) {
    const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const progress = (90 - d) / 90; // 0 → 1 over the window
    let dayClicks = 0;
    kws.forEach((k, i) => {
      const startPos = 9 + (i % 7) * 2.5;
      const position = Math.max(1.2, startPos - trend * progress * (3 + (i % 4)) + (rand() - 0.5) * 1.5);
      const impressions = Math.round((40 + ((i * 37) % 120)) * (1 + progress * trend * 0.6) * (0.8 + rand() * 0.4));
      const ctr = Math.max(0.005, 0.32 / position ** 1.1);
      const clicks = Math.round(impressions * ctr * (0.8 + rand() * 0.4));
      dayClicks += clicks;
      gsc.push({ client_id: client.id, date, query: k.kw, page: `${base}${pathForSlug(k.slug)}`, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: +position.toFixed(2) });
      gsc.push({ client_id: client.id, date, query: `${k.kw} near me`, page: `${base}${pathForSlug(k.slug)}`, clicks: Math.round(clicks * 0.3), impressions: Math.round(impressions * 0.5), ctr: 0.02, position: +(position + 4).toFixed(2) });
      const kwRow = keywordRows.find((r) => r.keyword === k.kw);
      if (kwRow) ranks.push({ client_id: client.id, keyword_id: kwRow.id, date, position: +position.toFixed(2), url: `${base}${pathForSlug(k.slug)}`, source: "gsc" });
    });
    const organic = Math.round(dayClicks * 1.15);
    ga.push({ client_id: client.id, date, sessions: organic + 20 + Math.round(rand() * 15), users: organic + 10, organic_sessions: organic, engaged_sessions: Math.round(organic * 0.6), conversions: Math.round(organic * 0.04) });
  }
  for (let i = 0; i < gsc.length; i += 1000) must(await db.from("gsc_daily").insert(gsc.slice(i, i + 1000)).select("client_id").limit(1), "gsc");
  for (let i = 0; i < ranks.length; i += 1000) must(await db.from("rank_snapshots").insert(ranks.slice(i, i + 1000)).select("id").limit(1), "ranks");
  must(await db.from("ga4_daily").insert(ga).select("client_id").limit(1), "ga4");

  // Leads
  const leads = Array.from({ length: 14 }, (_, i) => ({
    client_id: client.id,
    site_id: site.id,
    page_path: pathForSlug(plan.pages[(i % (plan.pages.length - 1)) + 1]!.slug),
    name: ["Sam Patel", "Jo Evans", "Alex Murphy", "Chris Lee", "Priya Shah", "Tom Walsh", "Hannah Price"][i % 7],
    email: `customer${i}@example.com`,
    message: "Could you give me a quote, please?",
    source: i % 3 === 0 ? "direct" : "organic",
    created_at: new Date(Date.now() - (i * 4 + 1) * 86_400_000).toISOString(),
  }));
  await db.from("leads").insert(leads);

  // A finished campaign with measured results, a planned task and an item awaiting approval.
  const run = must(await db.from("runs").insert({ agency_id: agencyId, client_id: client.id, kind: "campaign_plan", prompt: `Improve rankings for ${kws[3]?.kw ?? kws[0]!.kw}`, status: "succeeded", started_at: new Date().toISOString(), finished_at: new Date().toISOString() }).select("id").single(), "run");
  await db.from("run_events").insert([
    { run_id: run.id, agency_id: agencyId, client_id: client.id, type: "step", message: "Researching keywords" },
    { run_id: run.id, agency_id: agencyId, client_id: client.id, type: "step", message: "Plan ready: 3 tasks" },
  ]);
  const campaign = must(
    await db.from("campaigns").insert({ client_id: client.id, name: `Improve rankings for ${kws[3]?.kw ?? kws[0]!.kw}`, goal: `Improve rankings for ${kws[3]?.kw ?? kws[0]!.kw}`, target_keywords: [kws[3]?.kw ?? kws[0]!.kw], target_location: business.locations[0], status: "active", run_id: run.id, plan: { summary: "Quick on-page wins first, then deeper content and local pages.", insights: ["Main service pages rank on page two for their money terms."] } }).select("id").single(),
    "campaign",
  );
  const servicePage = pages.find((p) => p.type === "service")!;
  await db.from("tasks").insert([
    { client_id: client.id, campaign_id: campaign.id, kind: "meta_optimize", title: `Optimise title & meta on /${servicePage.slug}`, risk: "low", status: "done", completed_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), measured_impact: { d14: { verdict: "improved", clicksChangePct: 18.4, positionChange: 1.6 }, d28: { verdict: "improved", clicksChangePct: 31.2, positionChange: 2.3 } } },
    { client_id: client.id, campaign_id: campaign.id, kind: "internal_links", title: `Add internal links to /${servicePage.slug}`, risk: "low", status: "done", completed_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), measured_impact: { d14: { verdict: "flat", clicksChangePct: 3.1, positionChange: 0.4 } } },
    { client_id: client.id, campaign_id: campaign.id, kind: "content_expand", title: `Expand /${servicePage.slug} with an FAQ`, risk: "medium", status: "planned", scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString() },
  ]);
  const location = business.locations.at(-1)!;
  const proposedOps = [
    {
      op: "create_page",
      publish: false,
      page: {
        slug: `areas/${slugify(location)}-${business.services[0] ? slugify(business.services[0]) : "services"}`,
        type: "service_location",
        title: `${business.services[0]} in ${location} | ${business.name}`.slice(0, 60),
        meta_description: `Need ${business.services[0]?.toLowerCase()} in ${location}? ${business.name} offers fast, local help. Call today for a free quote.`.slice(0, 160),
        h1: `${business.services[0]} in ${location}`,
        target_keyword: `${business.services[0]?.toLowerCase()} ${location.toLowerCase()}`,
        blocks: contents.get(plan.pages.find((p) => p.type === "location")!.slug)!,
      },
    },
  ];
  await db.from("change_sets").insert({ client_id: client.id, site_id: site.id, run_id: run.id, summary: `Create a ${business.services[0]} page for ${location}`, rationale: "Search Console shows impressions for this service in this area but no page targets it.\n\nNeeds approval: new page changes are not on the auto-apply list.", risk: "medium", status: "proposed", ops: proposedOps });

  const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  await db.from("reports").insert({
    client_id: client.id,
    period_start: lastMonth,
    period_end: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0)).toISOString().slice(0, 10),
    summary_md: `## Headlines\n- More people found you on Google than the month before.\n- Several of your key services moved up in the rankings.\n- You received new enquiries through the website.\n\n## What we did\n- Improved how your main service page appears in Google\n- Connected related pages together\n\n## What's next\n- Add helpful questions and answers to your service pages\n- Create a page for ${location}`,
    metrics: {},
  });
  return { client, site };
}

async function main() {
  const owner = await user("owner@demo.test", "Demo Owner");
  const { data: existing } = await db.from("agencies").select("id").eq("slug", "demo-agency").maybeSingle();
  if (existing) {
    console.log("Demo agency exists; deleting it to reseed.");
    await db.from("agencies").delete().eq("id", existing.id);
  }
  const agency = must(await db.from("agencies").insert({ id: stableId("agency"), name: "Demo Agency", slug: "demo-agency", settings: { demo: true } }).select("id").single(), "agency");
  await db.from("memberships").insert({ agency_id: agency.id, user_id: owner, role: "owner" });
  const staff = await user("staff@demo.test", "Demo Staff");
  await db.from("memberships").insert({ agency_id: agency.id, user_id: staff, role: "member" });

  const a = await seedClient(
    agency.id,
    { name: "Brum Plumbing Co", industry: "Plumbing & heating", services: ["Emergency plumbing", "Boiler repair", "Bathroom installation"], locations: ["Birmingham", "Solihull", "Sutton Coldfield"], phone: "0121 555 0100", email: "hello@brumplumbing.example", address: "12 Digbeth High St, Birmingham", hours: "Mon–Sat 8am–6pm, 24/7 emergencies", usp: ["Gas Safe registered engineers", "Fixed prices quoted upfront"] },
    "client@brumplumbing.test",
    1,
  );
  const b = await seedClient(
    agency.id,
    { name: "Northern Roofing Ltd", industry: "Roofing", services: ["Roof repairs", "Flat roofing", "Guttering"], locations: ["Manchester", "Salford", "Stockport"], phone: "0161 555 0199", email: "info@northernroofing.example", usp: ["Insurance-backed guarantees"] },
    "client@northernroofing.test",
    0.4,
  );
  console.log(`Seeded. Sign in with owner@demo.test / ${PASSWORD} (agency) or client@brumplumbing.test (portal).`);
  console.log(`Sites: /sites/sub~${a.site.subdomain}  /sites/sub~${b.site.subdomain}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
