"use server";
import { revalidatePath } from "next/cache";
import { assertClientStaff } from "@/lib/access";
import { adminClient } from "@/lib/supabase/admin";

export async function updateGoogleProperties(clientId: string, formData: FormData) {
  await assertClientStaff(clientId);
  await adminClient()
    .from("integrations")
    .update({
      gsc_property: String(formData.get("gsc_property") ?? "").trim() || null,
      ga4_property_id: String(formData.get("ga4_property_id") ?? "").trim().replace(/^properties\//, "") || null,
    })
    .eq("client_id", clientId)
    .eq("provider", "google");
  revalidatePath(`/agency/clients/${clientId}/settings`);
}
