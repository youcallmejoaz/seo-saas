import { z } from "zod";

// Parsed lazily so `next build` and unit tests work without every secret present.
// Each integration checks for its own keys and falls back to a mock when absent.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  // Generated sites are served at <subdomain>.<ROOT_DOMAIN>.
  ROOT_DOMAIN: z.string().default("localhost:3000"),

  GEMINI_API_KEY: z.string().optional(),
  LLM_MODEL_PLANNER: z.string().default("gemini-2.5-pro"),
  LLM_MODEL_FAST: z.string().default("gemini-2.5-flash"),
  AI_MOCK: z.enum(["0", "1"]).default("0"),
  // JSON map of model -> {input, output} USD per 1M tokens. Free tier = 0.
  AI_PRICES_JSON: z.string().optional(),

  ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  PAGESPEED_API_KEY: z.string().optional(),
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** Test helper: forget the parsed env so changes to process.env are picked up. */
export function resetEnvCache() {
  cached = undefined;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === "") throw new Error(`Missing required environment variable ${key}`);
  return value as NonNullable<Env[K]>;
}

export const isAiMock = () => env().AI_MOCK === "1" || !env().GEMINI_API_KEY;
