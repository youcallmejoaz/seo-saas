// Provider-neutral interface for the LLM. Agents only talk to this, so the backing model
// (Gemini today; Claude or others later) can be swapped in src/lib/ai/index.ts.

export type ModelTier = "planner" | "fast";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema (already sanitized for the provider) describing the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** JSON-serialisable result, or an error message for a failed call. */
  result: unknown;
  isError?: boolean;
}

export interface GenerateRequest {
  tier: ModelTier;
  system?: string;
  prompt: string;
  /** JSON Schema: when set the model must answer with a single JSON value matching it. */
  jsonSchema?: Record<string, unknown>;
  /** Ground the answer in live Google Search results. */
  search?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GroundingSource {
  title: string;
  uri: string;
  domain?: string;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage: Usage;
  sources: GroundingSource[];
  searchQueries: string[];
  finishReason?: string;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  finishReason?: string;
}

export interface Conversation {
  /** Send a user message or the results of the previous turn's tool calls. */
  send(input: string | ToolResult[]): Promise<ModelTurn>;
}

export interface ConversationOptions {
  tier: ModelTier;
  system: string;
  tools: ToolDef[];
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  modelFor(tier: ModelTier): string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  conversation(opts: ConversationOptions): Conversation;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}
