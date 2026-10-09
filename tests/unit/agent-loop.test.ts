import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { generateJson, runAgent, setProvider, tool } from "@/lib/ai";
import type { Conversation, GenerateResult, LLMProvider, ModelTurn } from "@/lib/ai/provider";
import { BudgetExceededError } from "@/lib/ai/usage";
import { resetEnvCache } from "@/lib/env";
import { memoryLogger } from "@/lib/runs";

function fakeProvider(opts: { texts?: string[]; turns?: ModelTurn[] }): LLMProvider {
  const texts = [...(opts.texts ?? [])];
  const turns = [...(opts.turns ?? [])];
  return {
    name: "fake",
    modelFor: () => "fake-model",
    async generate(): Promise<GenerateResult> {
      return { text: texts.shift() ?? "", model: "fake-model", usage: { inputTokens: 10, outputTokens: 5 }, sources: [], searchQueries: [] };
    },
    conversation(): Conversation {
      return { send: async () => turns.shift() ?? { text: "done", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: "fake-model" } };
    },
  };
}

describe("AI layer with a real (fake) provider", () => {
  beforeEach(() => {
    process.env.AI_MOCK = "0";
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCache();
  });
  afterEach(() => {
    process.env.AI_MOCK = "1";
    delete process.env.GEMINI_API_KEY;
    setProvider(undefined);
    resetEnvCache();
  });

  it("parses fenced JSON and repairs invalid output once", async () => {
    setProvider(fakeProvider({ texts: ['```json\n{"n": "not a number"}\n```', '{"n": 3}'] }));
    const log = memoryLogger();
    const { data } = await generateJson(log, { purpose: "t", tier: "fast", prompt: "p", schema: z.object({ n: z.number() }), mock: () => ({ n: 0 }) });
    expect(data.n).toBe(3);
    expect(log.usage).toHaveLength(2);
    expect(log.events.some((e) => e.message.includes("Repairing"))).toBe(true);
  });

  it("fails after a second invalid answer", async () => {
    setProvider(fakeProvider({ texts: ["nope", "still nope"] }));
    await expect(generateJson(memoryLogger(), { purpose: "t", tier: "fast", prompt: "p", schema: z.object({ n: z.number() }), mock: () => ({ n: 0 }) })).rejects.toThrow(/failed validation/);
  });

  it("validates tool args, reports tool errors back, and stops on a final answer", async () => {
    const calls: number[] = [];
    const add = tool({ name: "add", description: "add", schema: z.object({ a: z.number(), b: z.number() }), run: async ({ a, b }) => (calls.push(a + b), a + b) });
    const boom = tool({ name: "boom", description: "fails", schema: z.object({}), run: async () => { throw new Error("kaboom"); } });
    setProvider(
      fakeProvider({
        turns: [
          { text: "", toolCalls: [{ id: "1", name: "add", args: { a: 1, b: "x" } }, { id: "2", name: "boom", args: {} }, { id: "3", name: "nope", args: {} }], usage: { inputTokens: 1, outputTokens: 1 }, model: "m" },
          { text: "", toolCalls: [{ id: "4", name: "add", args: { a: 2, b: 3 } }], usage: { inputTokens: 1, outputTokens: 1 }, model: "m" },
          { text: "The answer is 5", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: "m" },
        ],
      }),
    );
    const log = memoryLogger();
    const r = await runAgent(log, { purpose: "t", tier: "fast", system: "s", prompt: "p", tools: [add, boom], mock: () => ({}) });
    expect(r.text).toBe("The answer is 5");
    expect(calls).toEqual([5]);
    expect(r.toolCalls.map((c) => `${c.name}:${c.ok}`)).toEqual(["add:false", "boom:false", "nope:false", "add:true"]);
    expect(log.events.filter((e) => e.type === "tool_call")).toHaveLength(4);
  });

  it("stops at maxSteps", async () => {
    const loop = tool({ name: "noop", description: "", schema: z.object({}), run: async () => "ok" });
    const turn = { text: "", toolCalls: [{ id: "x", name: "noop", args: {} }], usage: { inputTokens: 1, outputTokens: 1 }, model: "m" };
    setProvider(fakeProvider({ turns: [turn, turn, turn, turn] }));
    const r = await runAgent(memoryLogger(), { purpose: "t", tier: "fast", system: "s", prompt: "p", tools: [loop], maxSteps: 3, mock: () => ({}) });
    expect(r.stoppedEarly).toBe(true);
    expect(r.steps).toBe(3);
  });

  it("checks the budget before every model call", async () => {
    setProvider(fakeProvider({ texts: ['{"n":1}'] }));
    const log = memoryLogger({ checkBudget: async () => { throw new BudgetExceededError("over"); } });
    await expect(generateJson(log, { purpose: "t", tier: "fast", prompt: "p", schema: z.object({ n: z.number() }), mock: () => ({ n: 0 }) })).rejects.toThrow("over");
    expect(log.usage).toHaveLength(0);
  });
});
