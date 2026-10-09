import { z } from "zod";
import { isAiMock } from "@/lib/env";
import type { RunLogger } from "@/lib/runs";
import { errorMessage } from "@/lib/utils";
import { GeminiProvider } from "./gemini";
import { toGeminiSchema } from "./json-schema";
import type { GenerateResult, GroundingSource, LLMProvider, ModelTier, ToolCall, ToolResult, Usage } from "./provider";
import { costUsd } from "./usage";

export type { ModelTier } from "./provider";

let provider: LLMProvider | undefined;

export function getProvider(): LLMProvider {
  provider ??= new GeminiProvider();
  return provider;
}

/** Test hook: inject a fake provider. */
export function setProvider(p: LLMProvider | undefined) {
  provider = p;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };

async function meter(log: RunLogger, purpose: string, model: string, usage: Usage) {
  await log.recordUsage({
    provider: isAiMock() ? "mock" : getProvider().name,
    model,
    purpose,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: costUsd(model, usage),
  });
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("no JSON found in model output");
  const open = body[start]!;
  const end = body.lastIndexOf(open === "{" ? "}" : "]");
  return JSON.parse(body.slice(start, end + 1));
}

export interface JsonCall<T> {
  purpose: string;
  tier: ModelTier;
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Ground the answer in Google Search; returns the sources alongside the data. */
  search?: boolean;
  temperature?: number;
  /** Deterministic stand-in used when AI_MOCK=1 or no API key is configured. */
  mock: () => T;
}

/**
 * Ask the model for JSON matching `schema`. Validates with Zod and gives the model one
 * chance to repair invalid output before failing.
 */
export async function generateJson<T>(log: RunLogger, call: JsonCall<T>): Promise<{ data: T; sources: GroundingSource[] }> {
  await log.checkBudget();
  if (isAiMock()) {
    await meter(log, call.purpose, "mock", ZERO);
    return { data: call.schema.parse(call.mock()), sources: [] };
  }
  const jsonSchema = toGeminiSchema(call.schema);
  const prompt = call.search
    ? `${call.prompt}\n\nRespond with ONLY a JSON value (no prose) that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`
    : call.prompt;
  const p = getProvider();
  let res: GenerateResult = await p.generate({ tier: call.tier, system: call.system, prompt, jsonSchema, search: call.search, temperature: call.temperature });
  await meter(log, call.purpose, res.model, res.usage);

  for (let attempt = 0; ; attempt++) {
    let issue: string;
    try {
      const parsed = call.schema.safeParse(extractJson(res.text));
      if (parsed.success) return { data: parsed.data, sources: res.sources };
      issue = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (err) {
      issue = errorMessage(err);
    }
    if (attempt >= 1) throw new Error(`${call.purpose}: model output failed validation: ${issue}`);
    await log.log("llm", `Repairing invalid ${call.purpose} output`, { issue }, "warn");
    await log.checkBudget();
    res = await p.generate({
      tier: call.tier,
      system: call.system,
      prompt: `${prompt}\n\nYour previous answer was invalid (${issue}). Previous answer:\n${res.text.slice(0, 12000)}\n\nReturn a corrected, complete JSON value only.`,
      jsonSchema,
      search: false,
    });
    await meter(log, `${call.purpose}:repair`, res.model, res.usage);
  }
}

export async function generateText(
  log: RunLogger,
  call: { purpose: string; tier: ModelTier; system?: string; prompt: string; search?: boolean; mock: () => string },
): Promise<{ text: string; sources: GroundingSource[]; searchQueries: string[] }> {
  await log.checkBudget();
  if (isAiMock()) {
    await meter(log, call.purpose, "mock", ZERO);
    return { text: call.mock(), sources: [], searchQueries: [] };
  }
  const res = await getProvider().generate({ tier: call.tier, system: call.system, prompt: call.prompt, search: call.search });
  await meter(log, call.purpose, res.model, res.usage);
  return { text: res.text, sources: res.sources, searchQueries: res.searchQueries };
}

// ---------------------------------------------------------------------------
// Tool-using agent loop
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: never) => Promise<unknown>;
}

/** Define a tool whose `run` receives arguments already validated against `schema`. */
export function tool<S extends z.ZodType>(def: { name: string; description: string; schema: S; run: (args: z.infer<S>) => Promise<unknown> }): AgentTool {
  return def as AgentTool;
}

export type MockTurn = { text?: string; toolCalls?: { name: string; args: Record<string, unknown> }[] };
/** Scripted model for AI_MOCK=1: receives the step number and the last tool results. */
export type MockAgent = (step: number, lastResults: ToolResult[]) => MockTurn;

export interface AgentResult {
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown; ok: boolean }[];
  stoppedEarly: boolean;
}

/**
 * Run a model with tools until it answers without calling a tool, or `maxSteps` is hit.
 * Tool arguments are validated with Zod before running; every call and result is logged
 * to the run so the full action history is auditable.
 */
export async function runAgent(
  log: RunLogger,
  opts: { purpose: string; tier: ModelTier; system: string; prompt: string; tools: AgentTool[]; maxSteps?: number; mock: MockAgent },
): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 12;
  const tools = new Map(opts.tools.map((t) => [t.name, t as unknown as { schema: z.ZodType; run: (a: unknown) => Promise<unknown> }]));
  const calls: AgentResult["toolCalls"] = [];
  const mock = isAiMock();
  const conv = mock
    ? null
    : getProvider().conversation({
        tier: opts.tier,
        system: opts.system,
        tools: opts.tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.schema) })),
      });

  let input: string | ToolResult[] = opts.prompt;
  let lastResults: ToolResult[] = [];
  for (let step = 0; step < maxSteps; step++) {
    await log.checkBudget();
    let text: string;
    let toolCalls: ToolCall[];
    if (conv) {
      const turn = await conv.send(input);
      await meter(log, opts.purpose, turn.model, turn.usage);
      text = turn.text;
      toolCalls = turn.toolCalls;
    } else {
      const t = opts.mock(step, lastResults);
      await meter(log, opts.purpose, "mock", ZERO);
      text = t.text ?? "";
      toolCalls = (t.toolCalls ?? []).map((c, i) => ({ id: `mock_${step}_${i}`, ...c }));
    }
    if (text.trim()) await log.log("message", text.trim().slice(0, 1500));
    if (!toolCalls.length) return { text, steps: step + 1, toolCalls: calls, stoppedEarly: false };

    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      const t = tools.get(call.name);
      await log.log("tool_call", `${call.name}`, call.args);
      if (!t) {
        results.push({ id: call.id, name: call.name, result: `Unknown tool "${call.name}"`, isError: true });
        calls.push({ name: call.name, args: call.args, ok: false });
        continue;
      }
      const parsed = t.schema.safeParse(call.args);
      if (!parsed.success) {
        const msg = `Invalid arguments: ${parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
        await log.log("tool_result", `${call.name} rejected`, { error: msg }, "warn");
        results.push({ id: call.id, name: call.name, result: msg, isError: true });
        calls.push({ name: call.name, args: call.args, ok: false });
        continue;
      }
      try {
        const out = await t.run(parsed.data);
        await log.log("tool_result", `${call.name} ok`, truncateForLog(out));
        results.push({ id: call.id, name: call.name, result: out });
        calls.push({ name: call.name, args: parsed.data, ok: true });
      } catch (err) {
        await log.log("tool_result", `${call.name} failed: ${errorMessage(err)}`, null, "warn");
        results.push({ id: call.id, name: call.name, result: errorMessage(err), isError: true });
        calls.push({ name: call.name, args: parsed.data, ok: false });
      }
    }
    input = results;
    lastResults = results;
  }
  await log.log("step", `Stopped after ${maxSteps} steps`, null, "warn");
  return { text: "", steps: maxSteps, toolCalls: calls, stoppedEarly: true };
}

function truncateForLog(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length > 4000 ? { truncated: true, preview: s.slice(0, 4000) } : v;
}
