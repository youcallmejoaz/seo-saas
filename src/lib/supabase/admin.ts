import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let admin: SupabaseClient | undefined;

/**
 * Service-role client: bypasses RLS. Only for background jobs, webhooks and the public
 * site renderer, and every query must filter by tenant explicitly.
 */
export function adminClient(): SupabaseClient {
  admin ??= createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
