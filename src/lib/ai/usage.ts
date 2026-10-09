import { env } from "@/lib/env";
import type { Usage } from "./provider";

type PriceTable = Record<string, { input: number; output: number }>;

let prices: PriceTable | undefined;

/** USD per 1M tokens by model prefix, from AI_PRICES_JSON. Unlisted models cost $0 (free tier). */
export function priceTable(): PriceTable {
  if (!prices) {
    try {
      prices = env().AI_PRICES_JSON ? (JSON.parse(env().AI_PRICES_JSON!) as PriceTable) : {};
    } catch {
      prices = {};
    }
  }
  return prices;
}

export function resetPriceCache() {
  prices = undefined;
}

export function costUsd(model: string, usage: Usage, table: PriceTable = priceTable()): number {
  // Longest matching prefix wins, so "gemini-2.5-flash-lite" can differ from "gemini-2.5-flash".
  const key = Object.keys(table)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return 0;
  const p = table[key]!;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

export class BudgetExceededError extends Error {
  readonly retryable = false;
}

export interface BudgetStatus {
  monthCostUsd: number;
  monthlyBudgetUsd: number;
  requestsToday: number;
  dailyRequestCap: number;
}

export function assertWithinBudget(s: BudgetStatus) {
  if (s.monthlyBudgetUsd > 0 && s.monthCostUsd >= s.monthlyBudgetUsd)
    throw new BudgetExceededError(`Monthly AI budget reached ($${s.monthCostUsd.toFixed(2)} of $${s.monthlyBudgetUsd.toFixed(2)}).`);
  if (s.dailyRequestCap > 0 && s.requestsToday >= s.dailyRequestCap)
    throw new BudgetExceededError(`Daily AI request cap reached (${s.requestsToday}/${s.dailyRequestCap}).`);
}
