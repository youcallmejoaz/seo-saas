/**
 * Verifies the Gemini setup: lists available models, checks the configured planner/fast
 * models exist, and makes one tiny structured-output call. Never prints the API key.
 *
 *   pnpm ai:check
 */
import { z } from "zod";
import { GeminiProvider } from "@/lib/ai/gemini";
import { toGeminiSchema } from "@/lib/ai/json-schema";
import { env } from "@/lib/env";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. Add it to .env.local or your environment's secrets.");
    process.exit(1);
  }
  const p = new GeminiProvider();
  const models = await p.listModels();
  console.log(`${models.length} models support generateContent. Gemini models:`);
  console.log(models.filter((m) => m.startsWith("gemini")).map((m) => `  - ${m}`).join("\n"));

  for (const [label, model] of [["LLM_MODEL_PLANNER", env().LLM_MODEL_PLANNER], ["LLM_MODEL_FAST", env().LLM_MODEL_FAST]] as const) {
    console.log(`${models.includes(model) ? "✓" : "✗ NOT AVAILABLE:"} ${label}=${model}`);
  }

  const schema = z.object({ city: z.string(), keywords: z.array(z.string()).min(2).max(3) });
  const res = await p.generate({
    tier: "fast",
    prompt: "Give two short local-SEO keywords for a plumber in Birmingham, UK.",
    jsonSchema: toGeminiSchema(schema),
  });
  const parsed = schema.safeParse(JSON.parse(res.text));
  console.log(parsed.success ? `✓ Structured output works (${res.model}):` : "✗ Structured output did not validate:", res.text);
  console.log(`  usage: ${res.usage.inputTokens} input / ${res.usage.outputTokens} output tokens`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
