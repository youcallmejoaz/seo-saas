import "server-only";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { runAgent, tool, type MockAgent } from "@/lib/ai";
import type { Client } from "@/lib/db/types";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/hosts";
import { clientMetrics, pctChange, portfolio } from "@/lib/metrics";
import { createRun, type RunLogger } from "@/lib/runs";
import { adminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";

const SYSTEM = `You are the operations AI for a digital marketing agency that builds websites and runs SEO for
local businesses. Staff give you instructions in plain English. You act through tools; long jobs (website
generation, campaigns, edits, audits) start background runs, so report that they have started and what will
happen next, never claim they are already finished.

Rules:
- Resolve client names with list_clients before acting on a client. If a name is ambiguous, ask.
- For questions about performance, use the metrics tools and quote real numbers. Never invent data.
- Prefer one clear action per client. For "all clients" requests, act on each active client.
- Website changes go through the client's approval policy automatically; mention when approval may be needed.
- Finish with a concise summary for the staff member (Markdown, bullet points where helpful).`;

export async function runCommand(log: RunLogger, prompt: string, scopedClientId: string | null, createdBy: string | null) {
  const agencyId = log.agencyId;
  const db = adminClient();
  const children: string[] = [];

  async function clientInAgency(clientId: string): Promise<Client> {
    const { data } = await db.from("clients").select("*").eq("id", clientId).eq("agency_id", agencyId).maybeSingle();
    if (!data) throw new Error(`No client with id ${clientId} in this agency. Use list_clients.`);
    return data as Client;
  }
  async function siteOf(clientId: string) {
    const { data } = await db.from("sites").select("*").eq("client_id", clientId).neq("status", "archived").order("created_at").limit(1).maybeSingle();
    return data;
  }
  async function child(kind: "site_generate" | "site_edit" | "campaign_plan" | "audit", clientId: string, childPrompt: string, input: Record<string, unknown> = {}) {
    const id = await createRun({ agencyId, clientId, kind, prompt: childPrompt, input, createdBy, parentRunId: log.runId });
    children.push(id);
    return id;
  }

  const tools = [
    tool({
      name: "list_clients",
      description: "List the agency's clients with status, location, website status/URL and 28-day organic clicks and leads.",
      schema: z.object({ status: z.enum(["any", "active", "paused", "onboarding", "offboarded"]).default("any") }),
      run: async ({ status }) => {
        const rows = await portfolio(db, agencyId);
        return rows
          .filter((r) => status === "any" || r.status === status)
          .map((r) => ({ client_id: r.client_id, name: r.name, status: r.status, website: r.site_status, url: r.subdomain ? siteUrl({ subdomain: r.subdomain, custom_domain: null, domain_verified: false }, env().ROOT_DOMAIN, env().NEXT_PUBLIC_APP_URL) : null, clicks_28d: r.clicks, clicks_prev_28d: r.clicks_prev, leads_28d: r.leads, pending_approvals: r.pending_approvals, failed_tasks: r.failed_tasks }));
      },
    }),
    tool({
      name: "get_client_metrics",
      description: "Detailed Search Console / analytics / ranking metrics for one client over a period.",
      schema: z.object({ client_id: z.string(), days: z.number().int().min(7).max(180).default(28) }),
      run: async ({ client_id, days }) => {
        await clientInAgency(client_id);
        const m = await clientMetrics(db, client_id, days);
        return {
          period_days: days,
          totals: m.totals,
          previous_period: m.previous,
          clicks_change_pct: pctChange(m.totals.clicks, m.previous.clicks),
          top_queries: m.topQueries.slice(0, 10),
          top_pages: m.topPages.slice(0, 8),
          ranking_movers: m.rankings.filter((r) => r.change).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 10),
        };
      },
    }),
    tool({
      name: "compare_clients",
      description: "Rank every client by change in organic clicks, leads and keyword movements between this period and the previous one. Use for 'which clients improved' questions.",
      schema: z.object({ days: z.number().int().min(7).max(90).default(28) }),
      run: async ({ days }) => {
        const rows = await portfolio(db, agencyId, days);
        const out = [];
        for (const r of rows.filter((x) => x.status !== "offboarded")) {
          const { data: ranks } = await db.rpc("client_rank_movements", { p_client: r.client_id, p_days: days });
          const moves = ((ranks ?? []) as { change: number | null }[]).filter((x) => x.change !== null);
          out.push({
            client_id: r.client_id,
            name: r.name,
            clicks: r.clicks,
            clicks_prev: r.clicks_prev,
            clicks_change_pct: pctChange(r.clicks, r.clicks_prev),
            leads: r.leads,
            leads_prev: r.leads_prev,
            keywords_up: moves.filter((x) => (x.change ?? 0) > 0).length,
            keywords_down: moves.filter((x) => (x.change ?? 0) < 0).length,
          });
        }
        return out.sort((a, b) => (b.clicks_change_pct ?? -1e9) - (a.clicks_change_pct ?? -1e9));
      },
    }),
    tool({
      name: "create_client_and_website",
      description: "Onboard a new client and start AI generation of their website (runs in the background, ~2-10 minutes).",
      schema: z.object({
        name: z.string().min(2).max(120),
        industry: z.string().min(2).max(80),
        services: z.array(z.string().max(80)).min(1).max(15),
        locations: z.array(z.string().max(80)).min(1).max(20),
        phone: z.string().max(40).optional(),
        email: z.string().max(200).optional(),
        instructions: z.string().max(2000).optional(),
      }),
      run: async (a) => {
        const { data: client, error } = await db
          .from("clients")
          .insert({ agency_id: agencyId, name: a.name, industry: a.industry, primary_location: a.locations[0], phone: a.phone ?? null, contact_email: a.email ?? null, status: "onboarding" })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        const sub = `${slugify(a.name).slice(0, 40) || "site"}-${Math.random().toString(36).slice(2, 6)}`;
        const { data: site, error: sErr } = await db
          .from("sites")
          .insert({ client_id: client.id, subdomain: sub, status: "generating", instructions: a.instructions ?? null, business: { name: a.name, industry: a.industry, services: a.services, locations: a.locations, phone: a.phone, email: a.email } })
          .select("id")
          .single();
        if (sErr) throw new Error(sErr.message);
        await db.from("subscriptions").insert({ client_id: client.id, status: "trialing" });
        const runId = await child("site_generate", client.id, `Generate website for ${a.name}`, { siteId: site.id });
        await inngest.send({ name: "site/generate.requested", data: { runId, siteId: site.id } });
        return { client_id: client.id, site_id: site.id, run_id: runId, preview: `/preview/${site.id}`, note: "Website generation started; it will be saved as a draft for review." };
      },
    }),
    tool({
      name: "edit_website",
      description: "Ask the website editor agent to make a change to a client's site (new pages, rewrites, metadata, links).",
      schema: z.object({ client_id: z.string(), instruction: z.string().min(5).max(2000) }),
      run: async ({ client_id, instruction }) => {
        await clientInAgency(client_id);
        const site = await siteOf(client_id);
        if (!site) throw new Error("Client has no website");
        const runId = await child("site_edit", client_id, instruction, { siteId: site.id });
        await inngest.send({ name: "site/edit.requested", data: { runId, siteId: site.id as string, instruction } });
        return { run_id: runId, status: "started" };
      },
    }),
    tool({
      name: "start_seo_campaign",
      description: "Start an SEO campaign for a goal (e.g. 'rank for roofing in Manchester'): research keywords and competitors, plan tasks, and execute them under the approval policy.",
      schema: z.object({ client_id: z.string(), goal: z.string().min(5).max(500), keywords: z.array(z.string().max(120)).max(20).default([]), location: z.string().max(120).optional() }),
      run: async ({ client_id, goal, keywords, location }) => {
        const client = await clientInAgency(client_id);
        if (client.status !== "active") throw new Error(`Client is ${client.status}; activate it first.`);
        const runId = await child("campaign_plan", client_id, goal, { keywords, location });
        const { data: campaign, error } = await db
          .from("campaigns")
          .insert({ client_id, name: goal.slice(0, 80), goal, target_keywords: keywords, target_location: location ?? client.primary_location, run_id: runId, created_by: createdBy })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        await inngest.send({ name: "campaign/plan.requested", data: { runId, campaignId: campaign.id } });
        return { run_id: runId, campaign_id: campaign.id, status: "planning started" };
      },
    }),
    tool({
      name: "run_audit",
      description: "Run a technical SEO audit (crawl, on-page checks, PageSpeed, indexing) for a client.",
      schema: z.object({ client_id: z.string() }),
      run: async ({ client_id }) => {
        await clientInAgency(client_id);
        const runId = await child("audit", client_id, "Technical SEO audit");
        await inngest.send({ name: "audit/requested", data: { clientId: client_id, runId } });
        return { run_id: runId, status: "started" };
      },
    }),
    tool({
      name: "fix_audit_issues",
      description: "Queue tasks that fix the auto-fixable issues from a client's latest audit (titles, meta, H1s, alt text, links).",
      schema: z.object({ client_id: z.string() }),
      run: async ({ client_id }) => {
        const client = await clientInAgency(client_id);
        const { data: audit } = await db.from("audits").select("id, finished_at").eq("client_id", client_id).eq("status", "completed").order("started_at", { ascending: false }).limit(1).maybeSingle();
        if (!audit) return { error: "No completed audit yet. Run run_audit first." };
        const { data: issues } = await db.from("audit_issues").select("check_id, page_url, message, auto_fixable").eq("audit_id", audit.id).eq("auto_fixable", true);
        const byPage = new Map<string, string[]>();
        for (const i of issues ?? []) byPage.set(i.page_url as string, [...(byPage.get(i.page_url as string) ?? []), i.message as string]);
        if (!byPage.size) return { message: "No auto-fixable issues in the latest audit." };
        const rows = [...byPage.entries()].slice(0, 15).map(([url, msgs], i) => {
          const slug = (() => {
            try {
              return new URL(url).pathname.replace(/^\//, "").replace(/\/$/, "");
            } catch {
              return "";
            }
          })();
          return { client_id, kind: "technical_fix", title: `Fix on-page issues on /${slug}`, description: msgs.join(" "), risk: "low", priority: 70 - i, payload: { target_page: slug, target_keyword: null, new_page_slug: null } };
        });
        await db.from("tasks").insert(rows);
        void client;
        return { queued_tasks: rows.length, note: "Tasks run within ~30 minutes; low-risk fixes apply automatically per policy." };
      },
    }),
    tool({
      name: "scan_for_opportunities",
      description: "Scan Search Console data and site structure for SEO opportunities and queue improvement tasks. Pass client_ids or all=true.",
      schema: z.object({ client_ids: z.array(z.string()).max(500).default([]), all: z.boolean().default(false) }),
      run: async ({ client_ids, all }) => {
        let ids = client_ids;
        if (all) ids = (await portfolio(db, agencyId)).filter((r) => r.status === "active").map((r) => r.client_id);
        for (const id of ids) await clientInAgency(id);
        if (ids.length) await inngest.send(ids.map((clientId) => ({ name: "scan/client.requested" as const, data: { clientId } })));
        return { scanning: ids.length };
      },
    }),
    tool({
      name: "list_tasks",
      description: "List SEO tasks for a client (optionally by status) with results.",
      schema: z.object({ client_id: z.string(), status: z.enum(["any", "planned", "running", "awaiting_approval", "done", "failed"]).default("any") }),
      run: async ({ client_id, status }) => {
        await clientInAgency(client_id);
        let q = db.from("tasks").select("title, kind, status, risk, scheduled_for, completed_at, error, measured_impact").eq("client_id", client_id).order("created_at", { ascending: false }).limit(30);
        if (status !== "any") q = q.eq("status", status);
        return (await q).data ?? [];
      },
    }),
    tool({
      name: "list_pending_approvals",
      description: "Change sets waiting for human approval, optionally for one client.",
      schema: z.object({ client_id: z.string().optional() }),
      run: async ({ client_id }) => {
        const clients = await portfolio(db, agencyId);
        const names = new Map(clients.map((c) => [c.client_id, c.name]));
        let q = db.from("change_sets").select("id, client_id, summary, risk, created_at").eq("status", "proposed").in("client_id", [...names.keys()]);
        if (client_id) q = q.eq("client_id", client_id);
        return ((await q).data ?? []).map((c) => ({ ...c, client: names.get(c.client_id as string) }));
      },
    }),
  ];

  const result = await runAgent(log, {
    purpose: "command",
    tier: "planner",
    system: SYSTEM,
    prompt: scopedClientId ? `(Context: the staff member is looking at client ${scopedClientId}.)\n\n${prompt}` : prompt,
    tools,
    maxSteps: 14,
    mock: mockCommand(prompt, scopedClientId),
  });
  return { answer: result.text, children, steps: result.steps };
}

/** Keyword-routed mock so the console works end to end without an API key. */
function mockCommand(prompt: string, scopedClientId: string | null): MockAgent {
  const p = prompt.toLowerCase();
  return (step, last) => {
    if (step === 0) {
      if (/improv|best|ranking|compare|which clients/.test(p)) return { toolCalls: [{ name: "compare_clients", args: { days: 28 } }] };
      return { toolCalls: [{ name: "list_clients", args: { status: "any" } }] };
    }
    if (step === 1) {
      const rows = (last[0]?.result ?? []) as { client_id: string; name: string; clicks_change_pct?: number | null; status?: string }[];
      if (/improv|best|ranking|compare|which clients/.test(p))
        return { text: rows.length ? `Clients by change in organic clicks (28 days):\n${rows.map((r) => `- **${r.name}**: ${r.clicks_change_pct == null ? "no prior data" : `${r.clicks_change_pct.toFixed(1)}%`}`).join("\n")}` : "No clients yet." };
      const target = rows.find((r) => r.client_id === scopedClientId) ?? rows.find((r) => p.includes(r.name.toLowerCase())) ?? rows.find((r) => r.status === "active");
      if (!target) return { text: "I couldn't find a matching client." };
      if (/audit/.test(p)) return { toolCalls: [{ name: "run_audit", args: { client_id: target.client_id } }] };
      if (/optimi|rank|campaign|improve/.test(p)) return { toolCalls: [{ name: "start_seo_campaign", args: { client_id: target.client_id, goal: prompt, keywords: [] } }] };
      if (/page|edit|add|change|website/.test(p)) return { toolCalls: [{ name: "edit_website", args: { client_id: target.client_id, instruction: prompt } }] };
      return { toolCalls: [{ name: "get_client_metrics", args: { client_id: target.client_id, days: 28 } }] };
    }
    return { text: `Done. ${JSON.stringify(last[0]?.result ?? {}).slice(0, 300)}` };
  };
}
