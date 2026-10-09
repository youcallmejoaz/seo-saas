import { ApiError, GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse, type Part } from "@google/genai";
import { env, requireEnv } from "@/lib/env";
import {
  LLMError,
  type Conversation,
  type ConversationOptions,
  type GenerateRequest,
  type GenerateResult,
  type LLMProvider,
  type ModelTier,
  type ModelTurn,
  type ToolResult,
  type Usage,
} from "./provider";

const MAX_ATTEMPTS = 5;

function usageOf(res: GenerateContentResponse): Usage {
  const u = res.usageMetadata;
  return {
    inputTokens: (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0),
    // Thinking tokens are billed as output.
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status === 408 || err.status >= 500;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg);
}

/** Server-suggested delay from a 429 body ("retryDelay": "17s"), if present. */
function suggestedDelayMs(err: unknown): number | null {
  const m = (err instanceof Error ? err.message : "").match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.min(60_000, Math.ceil(Number(m[1]) * 1000)) : null;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;
      const backoff = suggestedDelayMs(err) ?? Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  const status = lastErr instanceof ApiError ? lastErr.status : undefined;
  throw new LLMError(`Gemini request failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, status, isRetryable(lastErr));
}

function checkBlocked(res: GenerateContentResponse) {
  const reason = res.promptFeedback?.blockReason;
  if (reason) throw new LLMError(`Gemini blocked the prompt (${reason})`);
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST")
    throw new LLMError(`Gemini stopped for ${finish}`);
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey = requireEnv("GEMINI_API_KEY")) {
    this.client = new GoogleGenAI({ apiKey });
  }

  modelFor(tier: ModelTier): string {
    return tier === "planner" ? env().LLM_MODEL_PLANNER : env().LLM_MODEL_FAST;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const model = this.modelFor(req.tier);
    const config: GenerateContentConfig = {
      systemInstruction: req.system,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
    };
    if (req.search) config.tools = [{ googleSearch: {} }];
    // Grounded search and JSON mode cannot be combined on every model, so a searched
    // request asks for JSON in the prompt and the caller parses it.
    if (req.jsonSchema && !req.search) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = req.jsonSchema;
    }
    const res = await withRetry(() => this.client.models.generateContent({ model, contents: req.prompt, config }));
    checkBlocked(res);
    const grounding = res.candidates?.[0]?.groundingMetadata;
    return {
      text: res.text ?? "",
      model: res.modelVersion ?? model,
      usage: usageOf(res),
      finishReason: res.candidates?.[0]?.finishReason,
      searchQueries: grounding?.webSearchQueries ?? [],
      sources: (grounding?.groundingChunks ?? [])
        .map((c) => c.web)
        .filter((w): w is NonNullable<typeof w> => !!w?.uri)
        .map((w) => ({ title: w.title ?? w.domain ?? w.uri!, uri: w.uri!, domain: w.domain })),
    };
  }

  conversation(opts: ConversationOptions): Conversation {
    const model = this.modelFor(opts.tier);
    const history: Content[] = [];
    const config: GenerateContentConfig = {
      systemInstruction: opts.system,
      temperature: opts.temperature,
      tools: opts.tools.length
        ? [{ functionDeclarations: opts.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]
        : undefined,
      // We run tools ourselves (approval gates, logging), never the SDK's auto-calling.
      automaticFunctionCalling: { disable: true },
    };
    const client = this.client;

    return {
      async send(input: string | ToolResult[]): Promise<ModelTurn> {
        const parts: Part[] =
          typeof input === "string"
            ? [{ text: input }]
            : input.map((r) => ({
                functionResponse: {
                  id: r.id,
                  name: r.name,
                  response: r.isError ? { error: String(r.result) } : { output: r.result },
                },
              }));
        history.push({ role: "user", parts });
        const res = await withRetry(() => client.models.generateContent({ model, contents: history, config }));
        checkBlocked(res);
        // Append the model's content verbatim: it carries thought signatures that Gemini
        // requires on the next turn of a function-calling conversation.
        const content = res.candidates?.[0]?.content ?? { role: "model", parts: [] };
        history.push({ role: "model", parts: content.parts ?? [] });
        const calls = (res.functionCalls ?? []).map((c, i) => ({
          id: c.id ?? `call_${history.length}_${i}`,
          name: c.name ?? "",
          args: (c.args ?? {}) as Record<string, unknown>,
        }));
        const text = (content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
        return { text, toolCalls: calls, usage: usageOf(res), model: res.modelVersion ?? model, finishReason: res.candidates?.[0]?.finishReason };
      },
    };
  }

  async listModels(): Promise<string[]> {
    const pager = await this.client.models.list();
    const names: string[] = [];
    for await (const m of pager) {
      if (m.supportedActions?.includes("generateContent") && m.name) names.push(m.name.replace(/^models\//, ""));
    }
    return names;
  }
}
