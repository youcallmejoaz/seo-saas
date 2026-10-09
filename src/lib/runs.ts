import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import type { RunEvent, RunKind, RunStatus } from "@/lib/db/types";
import { assertWithinBudget, type BudgetStatus } from "@/lib/ai/usage";

// A Run is one unit of AI work (a command, a site generation, a task execution...).
// Everything it does is logged to run_events, which the dashboards stream live.

export interface RunLogger {
  readonly runId: string;
  readonly agencyId: string;
  readonly clientId: string | null;
  log(type: RunEvent["type"], message: string, data?: unknown, level?: RunEvent["level"]): Promise<void>;
  recordUsage(u: { provider: string; model: string; purpose: string; inputTokens: number; outputTokens: number; costUsd: number }): Promise<void>;
  checkBudget(): Promise<void>;
}

export async function createRun(input: {
  agencyId: string;
  clientId?: string | null;
  kind: RunKind;
  prompt?: string;
  input?: Record<string, unknown>;
  createdBy?: string | null;
  parentRunId?: string | null;
  status?: RunStatus;
}): Promise<string> {
  const { data, error } = await adminClient()
    .from("runs")
    .insert({
      agency_id: input.agencyId,
      client_id: input.clientId ?? null,
      kind: input.kind,
      prompt: input.prompt ?? null,
      input: input.input ?? {},
      created_by: input.createdBy ?? null,
      parent_run_id: input.parentRunId ?? null,
      status: input.status ?? "queued",
    })
    .select("id")
    .single();
  if (error) throw new Error(`createRun: ${error.message}`);
  return data.id as string;
}

export async function setRunStatus(runId: string, status: RunStatus, extra: { output?: unknown; error?: string | null } = {}) {
  const patch: Record<string, unknown> = { status };
  if (status === "running") patch.started_at = new Date().toISOString();
  if (["succeeded", "failed", "cancelled"].includes(status)) patch.finished_at = new Date().toISOString();
  if (extra.output !== undefined) patch.output = extra.output;
  if (extra.error !== undefined) patch.error = extra.error;
  const { error } = await adminClient().from("runs").update(patch).eq("id", runId);
  if (error) throw new Error(`setRunStatus: ${error.message}`);
}

export async function runLogger(runId: string): Promise<RunLogger> {
  const db = adminClient();
  const { data: run, error } = await db.from("runs").select("id, agency_id, client_id").eq("id", runId).single();
  if (error || !run) throw new Error(`Run ${runId} not found`);
  const agencyId = run.agency_id as string;
  const clientId = (run.client_id as string | null) ?? null;

  return {
    runId,
    agencyId,
    clientId,
    async log(type, message, data, level = type === "error" ? "error" : "info") {
      await db.from("run_events").insert({ run_id: runId, agency_id: agencyId, client_id: clientId, type, message: message.slice(0, 2000), data: data ?? null, level });
    },
    async recordUsage(u) {
      await db.from("ai_usage").insert({
        agency_id: agencyId,
        client_id: clientId,
        run_id: runId,
        provider: u.provider,
        model: u.model,
        purpose: u.purpose,
        input_tokens: u.inputTokens,
        output_tokens: u.outputTokens,
        cost_usd: u.costUsd,
      });
      await db.rpc("increment_run_usage", { p_run: runId, p_in: u.inputTokens, p_out: u.outputTokens, p_cost: u.costUsd });
    },
    async checkBudget() {
      if (!clientId) return;
      assertWithinBudget(await budgetStatus(clientId));
    },
  };
}

export async function budgetStatus(clientId: string): Promise<BudgetStatus> {
  const db = adminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [{ data: client }, { data: month }, { count }] = await Promise.all([
    db.from("clients").select("monthly_ai_budget_usd, daily_ai_request_cap").eq("id", clientId).single(),
    db.from("ai_usage").select("cost_usd").eq("client_id", clientId).gte("created_at", monthStart),
    db.from("ai_usage").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", dayStart),
  ]);
  return {
    monthCostUsd: (month ?? []).reduce((s, r) => s + Number(r.cost_usd), 0),
    monthlyBudgetUsd: Number(client?.monthly_ai_budget_usd ?? 0),
    requestsToday: count ?? 0,
    dailyRequestCap: Number(client?.daily_ai_request_cap ?? 0),
  };
}

/** In-memory logger for tests and scripts. */
export function memoryLogger(overrides: Partial<RunLogger> = {}): RunLogger & { events: { type: string; message: string; data?: unknown }[]; usage: unknown[] } {
  const events: { type: string; message: string; data?: unknown }[] = [];
  const usage: unknown[] = [];
  return {
    runId: "run-test",
    agencyId: "agency-test",
    clientId: "client-test",
    events,
    usage,
    async log(type, message, data) {
      events.push({ type, message, data });
    },
    async recordUsage(u) {
      usage.push(u);
    },
    async checkBudget() {},
    ...overrides,
  };
}
