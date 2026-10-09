import { classifyOps, riskAtMost, type ChangeOp } from "@/lib/site/changes";
import type { AutonomyPolicy, ClientStatus, Risk } from "@/lib/db/types";

export const DEFAULT_POLICY: AutonomyPolicy = {
  auto_apply: ["meta", "alt_text", "internal_links", "schema"],
  max_auto_risk: "low",
};

export type PolicyDecision =
  | { action: "auto_apply"; risk: Risk; reason: string }
  | { action: "require_approval"; risk: Risk; reason: string }
  | { action: "blocked"; risk: Risk; reason: string };

/**
 * Decide whether a proposed change set may be applied without a human.
 * Rules: the client must be active, every op kind must be on the client's auto-apply
 * list, and the combined risk must not exceed the client's max auto risk.
 */
export function decide(ops: ChangeOp[], policy: AutonomyPolicy | null | undefined, clientStatus: ClientStatus): PolicyDecision {
  const p = { ...DEFAULT_POLICY, ...(policy ?? {}) };
  const { kinds, risk } = classifyOps(ops);
  if (clientStatus === "paused" || clientStatus === "offboarded")
    return { action: "blocked", risk, reason: `Client is ${clientStatus}; no changes are made.` };
  const notAllowed = kinds.filter((k) => !p.auto_apply.includes(k));
  if (notAllowed.length)
    return { action: "require_approval", risk, reason: `Needs approval: ${notAllowed.join(", ").replace(/_/g, " ")} changes are not on the auto-apply list.` };
  if (!riskAtMost(risk, p.max_auto_risk))
    return { action: "require_approval", risk, reason: `Needs approval: ${risk} risk exceeds the auto-apply limit (${p.max_auto_risk}).` };
  return { action: "auto_apply", risk, reason: `Auto-applied: ${kinds.join(", ").replace(/_/g, " ")} (${risk} risk) is within policy.` };
}
