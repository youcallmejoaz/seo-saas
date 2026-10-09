import { inngest } from "../client";
import { LLM_CONCURRENCY, failRun, rethrow } from "./shared";
import { executeTask } from "@/lib/agents/seo-executor";
import { measureTask } from "@/lib/agents/measure";
import { findOpportunities, type GscPageQuery } from "@/lib/agents/opportunities";
import { planCampaign, saveCampaignTasks, TASK_RISK } from "@/lib/agents/seo-planner";
import { writeMonthlyReport } from "@/lib/agents/reports";
import type { Campaign, Task } from "@/lib/db/types";
import { createRun, runLogger, setRunStatus } from "@/lib/runs";
import { runAudit } from "@/lib/seo/audit";
import { syncClient, trackRanksWithSerp } from "@/lib/seo/sync";
import { applyChangeSet, getClient, loadPages, primarySiteFor } from "@/lib/site/repo";
import { adminClient } from "@/lib/supabase/admin";
import { daysAgo, errorMessage, isoDate } from "@/lib/utils";

const MEASURE_CHECKPOINTS = [14, 28];
const DAY = 86_400_000;

async function activeClientIds(): Promise<string[]> {
  const { data } = await adminClient().from("clients").select("id").eq("status", "active");
  return (data ?? []).map((c) => c.id as string);
}

async function agencyOf(clientId: string) {
  return (await getClient(clientId)).agency_id;
}

// ---------------------------------------------------------------------------
// Campaign planning
// ---------------------------------------------------------------------------

export const planCampaignFn = inngest.createFunction(
  {
    id: "campaign-plan",
    name: "Plan SEO campaign",
    retries: 2,
    concurrency: [{ key: "event.data.campaignId", limit: 1 }, LLM_CONCURRENCY],
    onFailure: async ({ event, error }) => {
      await failRun(event.data.event.data.runId, error);
      await adminClient().from("campaigns").update({ status: "failed" }).eq("id", event.data.event.data.campaignId);
    },
  },
  { event: "campaign/plan.requested" },
  async ({ event, step }) => {
    const { runId, campaignId } = event.data;
    const result = await step.run("research-and-plan", async () => {
      await setRunStatus(runId, "running");
      const log = await runLogger(runId);
      const { data: campaign } = await adminClient().from("campaigns").select("*").eq("id", campaignId).single();
      const c = campaign as Campaign;
      const client = await getClient(c.client_id);
      const site = await primarySiteFor(c.client_id);
      if (!site) throw new Error("Client has no website");
      try {
        const { plan } = await planCampaign(log, { campaign: c, client, site });
        const taskIds = await saveCampaignTasks(c, plan);
        await adminClient().from("campaigns").update({ status: "active", plan }).eq("id", campaignId);
        await log.log("step", `Plan ready: ${plan.tasks.length} tasks`, { summary: plan.summary, insights: plan.insights, tasks: plan.tasks.map((t) => `[${t.kind}] ${t.title} (day ${t.start_in_days})`) });
        return { taskIds, summary: plan.summary };
      } catch (err) {
        rethrow(err);
      }
    });
    // Due-now tasks start immediately; later ones are picked up by the dispatcher.
    const due = await step.run("claim-due-tasks", () => claimDueTasks({ campaignId }));
    if (due.length) await step.sendEvent("execute-due", due.map((data) => ({ name: "task/execute.requested" as const, data })));
    await step.run("finish", () => setRunStatus(runId, "succeeded", { output: { ...result, started: due.length } }));
    return result;
  },
);

/** Atomically move due, planned tasks of active clients to running so each runs once. */
async function claimDueTasks(filter: { campaignId?: string; limit?: number } = {}): Promise<{ taskId: string; clientId: string }[]> {
  const db = adminClient();
  const active = new Set(await activeClientIds());
  let q = db.from("tasks").select("id, client_id").eq("status", "planned").lte("scheduled_for", new Date().toISOString()).order("priority", { ascending: false }).limit(filter.limit ?? 50);
  if (filter.campaignId) q = q.eq("campaign_id", filter.campaignId);
  const { data } = await q;
  const ids = (data ?? []).filter((t) => active.has(t.client_id as string)).map((t) => t.id as string);
  if (!ids.length) return [];
  const { data: claimed } = await db.from("tasks").update({ status: "running", started_at: new Date().toISOString() }).in("id", ids).eq("status", "planned").select("id, client_id");
  return (claimed ?? []).map((t) => ({ taskId: t.id as string, clientId: t.client_id as string }));
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

export const executeTaskFn = inngest.createFunction(
  {
    id: "task-execute",
    name: "Execute SEO task",
    retries: 2,
    // One task per client at a time keeps edits to a site sequential.
    concurrency: [{ key: "event.data.clientId", limit: 1 }, LLM_CONCURRENCY],
    onFailure: async ({ event, error }) => {
      const { taskId } = event.data.event.data;
      const db = adminClient();
      const { data: task } = await db.from("tasks").select("payload").eq("id", taskId).single();
      await db.from("tasks").update({ status: "failed", error: errorMessage(error) }).eq("id", taskId);
      await failRun((task?.payload as { run_id?: string } | undefined)?.run_id, error);
    },
  },
  { event: "task/execute.requested" },
  async ({ event, step }) => {
    const { taskId } = event.data;
    const outcome = await step.run("execute", async () => {
      const db = adminClient();
      const { data } = await db.from("tasks").select("*").eq("id", taskId).single();
      const task = data as Task;
      if (!["planned", "running"].includes(task.status)) return { skipped: `task is ${task.status}` };
      const client = await getClient(task.client_id);
      if (client.status !== "active") {
        await db.from("tasks").update({ status: "cancelled", error: `Client is ${client.status}` }).eq("id", taskId);
        return { skipped: `client is ${client.status}` };
      }
      const site = await primarySiteFor(task.client_id);
      if (!site) throw new Error("Client has no website");

      const { data: campaign } = task.campaign_id ? await db.from("campaigns").select("run_id").eq("id", task.campaign_id).single() : { data: null };
      const runId =
        (task.payload as { run_id?: string }).run_id ??
        (await createRun({ agencyId: client.agency_id, clientId: client.id, kind: "task_execute", prompt: task.title, input: { taskId }, parentRunId: (campaign?.run_id as string | null) ?? null }));
      await db.from("tasks").update({ status: "running", attempts: task.attempts + 1, started_at: new Date().toISOString(), payload: { ...task.payload, run_id: runId } }).eq("id", taskId);
      await setRunStatus(runId, "running");
      const log = await runLogger(runId);
      try {
        const out = await executeTask(log, { task, client, site });
        const pending = out.changeSets.find((c) => c.status === "proposed");
        const applied = out.changeSets.find((c) => c.status === "applied");
        const status = pending ? "awaiting_approval" : out.changeSets.length || !out.stoppedEarly ? "done" : "failed";
        await db
          .from("tasks")
          .update({
            status,
            change_set_id: (pending ?? applied ?? out.changeSets[0])?.id ?? null,
            result: { summary: out.summary, change_sets: out.changeSets },
            error: status === "failed" ? "Agent stopped without making a change" : null,
            completed_at: status === "done" ? new Date().toISOString() : null,
          })
          .eq("id", taskId);
        await setRunStatus(runId, pending ? "awaiting_approval" : status === "failed" ? "failed" : "succeeded", { output: out });
        return { status, measure: !!applied && status === "done" };
      } catch (err) {
        rethrow(err);
      }
    });
    if ("measure" in outcome && outcome.measure) await step.sendEvent("schedule-measurement", measurementEvents(taskId));
    return outcome;
  },
);

function measurementEvents(taskId: string) {
  return MEASURE_CHECKPOINTS.map((d) => ({ name: "task/measure.requested" as const, data: { taskId, checkpointDays: d }, ts: Date.now() + d * DAY }));
}

// ---------------------------------------------------------------------------
// Human approval decisions
// ---------------------------------------------------------------------------

export const changeDecidedFn = inngest.createFunction(
  { id: "change-decided", name: "Apply approved change", retries: 3, concurrency: [{ key: "event.data.changeSetId", limit: 1 }] },
  { event: "change/decided" },
  async ({ event, step }) => {
    const { changeSetId, decision } = event.data;
    const res = await step.run("apply", async () => {
      const db = adminClient();
      const { data: cs } = await db.from("change_sets").select("id, status, task_id, run_id, summary").eq("id", changeSetId).single();
      if (!cs) return { skipped: true };
      const log = cs.run_id ? await runLogger(cs.run_id as string) : null;
      if (decision === "approved" && cs.status === "approved") {
        const r = await applyChangeSet(changeSetId);
        await log?.log("status", `Approved and applied: ${cs.summary}`, r);
      } else {
        await log?.log("status", `Rejected: ${cs.summary}`);
      }
      if (cs.task_id) {
        await db
          .from("tasks")
          .update(decision === "approved" ? { status: "done", completed_at: new Date().toISOString() } : { status: "skipped", error: "Change rejected by reviewer" })
          .eq("id", cs.task_id)
          .eq("status", "awaiting_approval");
      }
      if (cs.run_id) {
        const { count } = await db.from("change_sets").select("id", { count: "exact", head: true }).eq("run_id", cs.run_id).eq("status", "proposed");
        if (!count) await setRunStatus(cs.run_id as string, "succeeded");
      }
      return { taskId: (cs.task_id as string | null) ?? null, applied: decision === "approved" };
    });
    if ("applied" in res && res.applied && res.taskId) await step.sendEvent("schedule-measurement", measurementEvents(res.taskId));
    return res;
  },
);

export const measureTaskFn = inngest.createFunction(
  { id: "task-measure", name: "Measure task impact", retries: 2 },
  { event: "task/measure.requested" },
  async ({ event, step }) => {
    const { taskId, checkpointDays } = event.data;
    await step.run("measure", async () => {
      const impact = await measureTask(taskId, checkpointDays);
      return impact ?? { skipped: true };
    });
  },
);

// ---------------------------------------------------------------------------
// Recurring work
// ---------------------------------------------------------------------------

export const dispatchTasksCron = inngest.createFunction(
  { id: "dispatch-due-tasks", name: "Dispatch due SEO tasks" },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    const ids = await step.run("claim", () => claimDueTasks({ limit: 40 }));
    if (ids.length) await step.sendEvent("execute", ids.map((data) => ({ name: "task/execute.requested" as const, data })));
    return { dispatched: ids.length };
  },
);

export const dailySyncCron = inngest.createFunction(
  { id: "daily-sync", name: "Daily data sync" },
  { cron: "TZ=Europe/London 15 5 * * *" },
  async ({ step }) => {
    const ids = await step.run("clients", activeClientIds);
    if (ids.length) await step.sendEvent("fan-out", ids.map((clientId) => ({ name: "sync/client.requested" as const, data: { clientId } })));
    return { clients: ids.length };
  },
);

export const syncClientFn = inngest.createFunction(
  { id: "sync-client", name: "Sync Google data", retries: 3, concurrency: [{ key: "event.data.clientId", limit: 1 }], throttle: { limit: 20, period: "1m" } },
  { event: "sync/client.requested" },
  async ({ event, step }) => {
    const { clientId } = event.data;
    return step.run("sync", async () => {
      const runId = await createRun({ agencyId: await agencyOf(clientId), clientId, kind: "sync", prompt: "Sync Search Console & GA4", status: "running" });
      try {
        const log = await runLogger(runId);
        const out = await syncClient(log, clientId);
        // Weekly SERP checks on Mondays when DataForSEO is configured.
        if (new Date().getUTCDay() === 1) await trackRanksWithSerp(log, clientId);
        await setRunStatus(runId, "succeeded", { output: out });
        return out;
      } catch (err) {
        await failRun(runId, err);
        throw err;
      }
    });
  },
);

export const weeklyAuditCron = inngest.createFunction(
  { id: "weekly-audit", name: "Weekly technical audits" },
  { cron: "TZ=Europe/London 0 3 * * 1" },
  async ({ step }) => {
    const ids = await step.run("clients", activeClientIds);
    if (ids.length) await step.sendEvent("fan-out", ids.map((clientId) => ({ name: "audit/requested" as const, data: { clientId } })));
    return { clients: ids.length };
  },
);

export const auditFn = inngest.createFunction(
  { id: "audit-client", name: "Technical SEO audit", retries: 1, concurrency: [{ key: "event.data.clientId", limit: 1 }, { limit: 5 }] },
  { event: "audit/requested" },
  async ({ event, step }) => {
    const { clientId } = event.data;
    return step.run("audit", async () => {
      const runId = event.data.runId ?? (await createRun({ agencyId: await agencyOf(clientId), clientId, kind: "audit", prompt: "Technical SEO audit", status: "running" }));
      await setRunStatus(runId, "running");
      try {
        const out = await runAudit(await runLogger(runId), clientId);
        await setRunStatus(runId, "succeeded", { output: out });
        return out;
      } catch (err) {
        await failRun(runId, err);
        throw err;
      }
    });
  },
);

export const weeklyScanCron = inngest.createFunction(
  { id: "weekly-opportunity-scan", name: "Weekly opportunity scan" },
  { cron: "TZ=Europe/London 0 7 * * 2" },
  async ({ step }) => {
    const ids = await step.run("clients", activeClientIds);
    if (ids.length) await step.sendEvent("fan-out", ids.map((clientId) => ({ name: "scan/client.requested" as const, data: { clientId } })));
    return { clients: ids.length };
  },
);

/** Turn data-driven opportunities into tasks on the client's always-on campaign. */
export const scanClientFn = inngest.createFunction(
  { id: "scan-client", name: "Find SEO opportunities", retries: 2, concurrency: [{ key: "event.data.clientId", limit: 1 }] },
  { event: "scan/client.requested" },
  async ({ event, step }) => {
    const { clientId } = event.data;
    const created = await step.run("scan", async () => {
      const db = adminClient();
      const client = await getClient(clientId);
      if (client.status !== "active") return [];
      const site = await primarySiteFor(clientId);
      if (!site) return [];
      const runId = await createRun({ agencyId: client.agency_id, clientId, kind: "scan", prompt: "Scan for SEO opportunities", status: "running" });
      const log = await runLogger(runId);
      const [pages, { data: rows }] = await Promise.all([
        loadPages(site.id),
        db.from("gsc_daily").select("page, query, clicks, impressions, position").eq("client_id", clientId).gte("date", isoDate(daysAgo(28))).limit(20_000),
      ]);
      // Aggregate to page x query over the window.
      const agg = new Map<string, GscPageQuery & { w: number }>();
      for (const r of rows ?? []) {
        const k = `${r.page}\u0000${r.query}`;
        const a = agg.get(k) ?? { page: r.page as string, query: r.query as string, clicks: 0, impressions: 0, position: 0, w: 0 };
        a.clicks += r.clicks as number;
        a.impressions += r.impressions as number;
        a.w += Number(r.position) * (r.impressions as number);
        agg.set(k, a);
      }
      const opportunities = findOpportunities({
        pages,
        business: site.business,
        rows: [...agg.values()].map((a) => ({ ...a, position: a.impressions ? a.w / a.impressions : 0 })),
      });

      // Skip anything already planned/running/awaiting approval or done in the last 21 days.
      const { data: recent } = await db.from("tasks").select("kind, payload, status, created_at").eq("client_id", clientId).or(`status.in.(planned,running,awaiting_approval),created_at.gte.${new Date(Date.now() - 21 * DAY).toISOString()}`);
      const key = (kind: string, p: { target_page?: string | null; new_page_slug?: string | null }) => `${kind}|${p.target_page ?? ""}|${p.new_page_slug ?? ""}`;
      const existing = new Set((recent ?? []).map((t) => key(t.kind as string, t.payload as { target_page?: string | null })));
      const fresh = opportunities.filter((o) => !existing.has(key(o.kind, o.payload))).slice(0, 6);

      const campaignId = await ensureAlwaysOnCampaign(clientId, runId);
      if (fresh.length) {
        await db.from("tasks").insert(
          fresh.map((o, i) => ({
            client_id: clientId,
            campaign_id: campaignId,
            kind: o.kind,
            title: o.title,
            description: o.description,
            risk: TASK_RISK[o.kind as keyof typeof TASK_RISK] ?? "medium",
            priority: o.priority,
            scheduled_for: new Date(Date.now() + i * 6 * 3_600_000).toISOString(), // spread over the day
            payload: o.payload,
          })),
        );
      }
      await log.log("step", `Found ${opportunities.length} opportunities, queued ${fresh.length} new tasks`, fresh.map((o) => `[${o.kind}] ${o.title}`));
      await setRunStatus(runId, "succeeded", { output: { found: opportunities.length, queued: fresh.length } });
      return fresh.map((f) => f.title);
    });
    return { queued: created.length };
  },
);

async function ensureAlwaysOnCampaign(clientId: string, runId: string): Promise<string> {
  const db = adminClient();
  const { data } = await db.from("campaigns").select("id").eq("client_id", clientId).eq("name", "Always-on optimisation").maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await db
    .from("campaigns")
    .insert({ client_id: clientId, name: "Always-on optimisation", goal: "Continuously find and fix SEO opportunities from Search Console data and site checks.", status: "active", run_id: runId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

export const monthlyReportCron = inngest.createFunction(
  { id: "monthly-reports", name: "Monthly client reports" },
  { cron: "TZ=Europe/London 0 8 1 * *" },
  async ({ step }) => {
    const ids = await step.run("clients", activeClientIds);
    const now = new Date();
    const periodStart = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    if (ids.length) await step.sendEvent("fan-out", ids.map((clientId) => ({ name: "report/client.requested" as const, data: { clientId, periodStart } })));
    return { clients: ids.length };
  },
);

export const reportFn = inngest.createFunction(
  { id: "client-report", name: "Write monthly report", retries: 2, concurrency: [LLM_CONCURRENCY] },
  { event: "report/client.requested" },
  async ({ event, step }) => {
    const { clientId, periodStart } = event.data;
    return step.run("write", async () => {
      const runId = await createRun({ agencyId: await agencyOf(clientId), clientId, kind: "report", prompt: `Monthly report ${periodStart}`, status: "running" });
      try {
        const out = await writeMonthlyReport(await runLogger(runId), clientId, periodStart);
        await setRunStatus(runId, "succeeded", { output: out });
        return out;
      } catch (err) {
        await failRun(runId, err);
        rethrow(err);
      }
    });
  },
);

/** Proposals nobody reviewed in 14 days are closed so the queue stays meaningful. */
export const expireProposalsCron = inngest.createFunction(
  { id: "expire-proposals", name: "Expire stale proposals" },
  { cron: "TZ=Europe/London 30 2 * * *" },
  async ({ step }) =>
    step.run("expire", async () => {
      const db = adminClient();
      const cutoff = new Date(Date.now() - 14 * DAY).toISOString();
      const { data } = await db.from("change_sets").update({ status: "rejected", error: "Expired after 14 days without review" }).eq("status", "proposed").lt("created_at", cutoff).select("task_id");
      const taskIds = (data ?? []).map((r) => r.task_id).filter(Boolean) as string[];
      if (taskIds.length) await db.from("tasks").update({ status: "skipped", error: "Approval expired" }).in("id", taskIds);
      return { expired: data?.length ?? 0 };
    }),
);
