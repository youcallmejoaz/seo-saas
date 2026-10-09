import "server-only";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db/types";

/** Ensures the signed-in staff member's agency owns the client (checked through RLS). */
export async function assertClientStaff(clientId: string) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("*").eq("id", clientId).eq("agency_id", staff.agency.id).maybeSingle();
  if (!data) throw new Error("Client not found");
  return { staff, client: data as Client, supabase };
}
