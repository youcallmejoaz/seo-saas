import { NonRetriableError } from "inngest";
import { BudgetExceededError } from "@/lib/ai/usage";
import { setRunStatus } from "@/lib/runs";
import { errorMessage } from "@/lib/utils";

/** Shared limit on concurrent LLM-heavy jobs, to stay inside provider rate limits. */
export const LLM_CONCURRENCY = { scope: "account" as const, key: '"llm"', limit: 4 };

/** Budget overruns should stop immediately, not burn retries. */
export function rethrow(err: unknown): never {
  if (err instanceof BudgetExceededError) throw new NonRetriableError(err.message);
  throw err;
}

export async function failRun(runId: string | undefined, err: unknown) {
  if (!runId) return;
  await setRunStatus(runId, "failed", { error: errorMessage(err) }).catch(() => undefined);
}
