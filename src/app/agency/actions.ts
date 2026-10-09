"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { assertClientStaff } from "@/lib/access";
import { requireAdmin, requireStaff } from "@/lib/auth";
import type { AutonomyPolicy, ChangeKind, ClientStatus } from "@/lib/db/types";
import { addDomain, checkDomain } from "@/lib/integrations/vercel-domains";
import { createRun } from "@/lib/runs";
import { publishSite, rollbackChangeSet } from "@/lib/site/repo";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const onboardSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: z.string().trim().min(2).max(80),
  services: z.array(z.string().max(80)).min(1).max(20),
  locations: z.array(z.string().max(80)).min(1).max(30),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(300).optional(),
  hours: z.string().max(120).optional(),
  usp: z.array(z.string().max(160)).max(10),
  instructions: z.string().max(4000).optional(),
  subdomain: z.string().optional(),
  publish: z.boolean(),
  budget: z.coerce.number().min(0).max(10000),
});

/** Onboard a client: create the client, its site, and kick off AI generation. */
export async function onboardClient(formData: FormData) {
  const staff = await requireStaff();
  const input = onboardSchema.parse({
    name: formData.get("name"),
    industry: formData.get("industry"),
    services: list(formData.get("services")),
    locations: list(formData.get("locations")),
    phone: String(formData.get("phone") ?? "") || undefined,
    email: String(formData.get("email") ?? ""),
    address: String(formData.get("address") ?? "") || undefined,
    hours: String(formData.get("hours") ?? "") || undefined,
    usp: list(formData.get("usp")),
    instructions: String(formData.get("instructions") ?? "") || undefined,
    subdomain: String(formData.get("subdomain") ?? "") || undefined,
    publish: formData.get("publish") === "on",
    budget: formData.get("budget") ?? 25,
  });
  const supabase = await createClient();
  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      agency_id: staff.agency.id,
      name: input.name,
      industry: input.industry,
      primary_location: input.locations[0],
      contact_email: input.email || null,
      phone: input.phone ?? null,
      monthly_ai_budget_usd: input.budget,
      status: "onboarding",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const db = adminClient();
  let sub = slugify(input.subdomain || input.name).slice(0, 50) || "site";
  for (let i = 0; i < 5; i++) {
    const { data: taken } = await db.from("sites").select("id").eq("subdomain", sub).maybeSingle();
    if (!taken) break;
    sub = `${sub.slice(0, 44)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const { data: site, error: siteErr } = await supabase
    .from("sites")
    .insert({
      client_id: client.id,
      subdomain: sub,
      status: "generating",
      instructions: input.instructions ?? null,
      business: {
        name: input.name,
        industry: input.industry,
        services: input.services,
        locations: input.locations,
        phone: input.phone,
        email: input.email || undefined,
        address: input.address,
        hours: input.hours,
        usp: input.usp,
      },
    })
    .select("id")
    .single();
  if (siteErr) throw new Error(siteErr.message);
  await supabase.from("subscriptions").insert({ client_id: client.id, status: "trialing" });

  const runId = await createRun({
    agencyId: staff.agency.id,
    clientId: client.id,
    kind: "site_generate",
    prompt: `Generate website for ${input.name}`,
    input: { siteId: site.id },
    createdBy: staff.userId,
  });
  await inngest.send({ name: "site/generate.requested", data: { runId, siteId: site.id, publish: input.publish } });
  redirect(`/agency/clients/${client.id}/site?run=${runId}`);
}

export async function regenerateSite(clientId: string, siteId: string) {
  const { staff, supabase } = await assertClientStaff(clientId);
  const { data: site } = await supabase.from("sites").select("status").eq("id", siteId).eq("client_id", clientId).single();
  if (!site || site.status === "published") throw new Error("Published sites are changed through edits, not regeneration.");
  const runId = await createRun({ agencyId: staff.agency.id, clientId, kind: "site_generate", prompt: "Regenerate website", input: { siteId }, createdBy: staff.userId });
  await inngest.send({ name: "site/generate.requested", data: { runId, siteId } });
  revalidatePath(`/agency/clients/${clientId}/site`);
}

export async function publishSiteAction(clientId: string, siteId: string) {
  await assertClientStaff(clientId);
  await publishSite(siteId);
  revalidatePath(`/agency/clients/${clientId}/site`);
}

export async function requestSiteEdit(clientId: string, siteId: string, formData: FormData) {
  const { staff } = await assertClientStaff(clientId);
  const instruction = String(formData.get("instruction") ?? "").trim();
  if (!instruction) return;
  const runId = await createRun({ agencyId: staff.agency.id, clientId, kind: "site_edit", prompt: instruction, input: { siteId }, createdBy: staff.userId });
  await inngest.send({ name: "site/edit.requested", data: { runId, siteId, instruction } });
  redirect(`/agency/runs/${runId}`);
}

export async function setCustomDomain(clientId: string, siteId: string, formData: FormData) {
  await assertClientStaff(clientId);
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) throw new Error("Enter a valid domain like example.co.uk");
  const status = await addDomain(domain);
  await adminClient().from("sites").update({ custom_domain: domain, domain_verified: status.verified }).eq("id", siteId);
  revalidatePath(`/agency/clients/${clientId}/site`);
}

export async function verifyDomain(clientId: string, siteId: string, domain: string) {
  await assertClientStaff(clientId);
  const status = await checkDomain(domain);
  await adminClient().from("sites").update({ domain_verified: status.verified }).eq("id", siteId);
  revalidatePath(`/agency/clients/${clientId}/site`);
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function decideChangeSet(changeSetId: string, decision: "approved" | "rejected") {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: cs } = await supabase.from("change_sets").select("id, client_id, status").eq("id", changeSetId).maybeSingle();
  if (!cs) throw new Error("Change set not found");
  if (cs.status !== "proposed") return;
  await adminClient().from("change_sets").update({ status: decision, decided_by: staff.userId, decided_at: new Date().toISOString() }).eq("id", changeSetId).eq("status", "proposed");
  await inngest.send({ name: "change/decided", data: { changeSetId, decision, userId: staff.userId } });
  revalidatePath("/agency/approvals");
  revalidatePath(`/agency/clients/${cs.client_id}`);
}

export async function rollbackAction(changeSetId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data: cs } = await supabase.from("change_sets").select("id, client_id").eq("id", changeSetId).maybeSingle();
  if (!cs) throw new Error("Change set not found");
  await rollbackChangeSet(changeSetId);
  revalidatePath(`/agency/clients/${cs.client_id}`);
  revalidatePath("/agency/approvals");
}

// ---------------------------------------------------------------------------
// Client lifecycle & settings
// ---------------------------------------------------------------------------

export async function setClientStatus(clientId: string, status: ClientStatus) {
  if (status === "offboarded") await requireAdmin();
  await assertClientStaff(clientId);
  const db = adminClient();
  await db.from("clients").update({ status, offboarded_at: status === "offboarded" ? new Date().toISOString() : null }).eq("id", clientId);
  if (status === "paused" || status === "offboarded") {
    await db.from("tasks").update({ status: "cancelled" }).eq("client_id", clientId).eq("status", "planned");
    await db.from("campaigns").update({ status: "paused" }).eq("client_id", clientId).eq("status", "active");
  }
  if (status === "offboarded") {
    await db.from("sites").update({ status: "archived" }).eq("client_id", clientId);
  }
  revalidatePath(`/agency/clients/${clientId}`);
  revalidatePath("/agency/clients");
}

const CHANGE_KINDS: ChangeKind[] = ["meta", "alt_text", "internal_links", "schema", "content_update", "content_rewrite", "new_page", "slug_change", "archive_page"];

export async function updateClientSettings(clientId: string, formData: FormData) {
  await assertClientStaff(clientId);
  const policy: AutonomyPolicy = {
    auto_apply: CHANGE_KINDS.filter((k) => formData.get(`auto_${k}`) === "on"),
    max_auto_risk: z.enum(["none", "low", "medium", "high"]).parse(formData.get("max_auto_risk") ?? "low"),
  };
  await adminClient()
    .from("clients")
    .update({
      autonomy_policy: policy,
      monthly_ai_budget_usd: Number(formData.get("budget") ?? 25),
      daily_ai_request_cap: Number(formData.get("daily_cap") ?? 200),
      notes: String(formData.get("notes") ?? "") || null,
    })
    .eq("id", clientId);
  revalidatePath(`/agency/clients/${clientId}/settings`);
}

export async function inviteClientUser(clientId: string, formData: FormData) {
  await assertClientStaff(clientId);
  const email = z.string().email().parse(String(formData.get("email") ?? "").trim());
  const db = adminClient();
  const { data: invited, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback?next=/portal` });
  let userId = invited?.user?.id;
  if (error) {
    // Already registered: look the user up instead.
    const { data: existing } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!existing) throw new Error(error.message);
    userId = existing.id as string;
  }
  await db.from("client_users").upsert({ client_id: clientId, user_id: userId }, { onConflict: "client_id,user_id" });
  revalidatePath(`/agency/clients/${clientId}/settings`);
}

export async function removeClientUser(clientId: string, userId: string) {
  await assertClientStaff(clientId);
  await adminClient().from("client_users").delete().eq("client_id", clientId).eq("user_id", userId);
  revalidatePath(`/agency/clients/${clientId}/settings`);
}

// ---------------------------------------------------------------------------
// SEO operations
// ---------------------------------------------------------------------------

export async function startCampaign(clientId: string, formData: FormData) {
  const { staff, client } = await assertClientStaff(clientId);
  if (client.status !== "active") throw new Error(`Client is ${client.status}`);
  const goal = String(formData.get("goal") ?? "").trim();
  if (!goal) throw new Error("Describe the campaign goal");
  const keywords = list(formData.get("keywords"));
  const location = String(formData.get("location") ?? "").trim() || client.primary_location;
  const db = adminClient();
  const runId = await createRun({ agencyId: staff.agency.id, clientId, kind: "campaign_plan", prompt: goal, input: { keywords, location }, createdBy: staff.userId });
  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({ client_id: clientId, name: goal.slice(0, 80), goal, target_keywords: keywords, target_location: location, run_id: runId, created_by: staff.userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await inngest.send({ name: "campaign/plan.requested", data: { runId, campaignId: campaign.id } });
  redirect(`/agency/runs/${runId}`);
}

export async function runAuditNow(clientId: string) {
  await assertClientStaff(clientId);
  await inngest.send({ name: "audit/requested", data: { clientId } });
  revalidatePath(`/agency/clients/${clientId}/audits`);
}

export async function syncNow(clientId: string) {
  await assertClientStaff(clientId);
  await inngest.send({ name: "sync/client.requested", data: { clientId } });
}

export async function scanNow(clientId: string) {
  await assertClientStaff(clientId);
  await inngest.send({ name: "scan/client.requested", data: { clientId } });
  revalidatePath(`/agency/clients/${clientId}`);
}

export async function retryTask(taskId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("id, client_id, status").eq("id", taskId).maybeSingle();
  if (!task) throw new Error("Task not found");
  await adminClient().from("tasks").update({ status: "planned", error: null, scheduled_for: new Date().toISOString() }).eq("id", taskId);
  await inngest.send({ name: "task/execute.requested", data: { taskId, clientId: task.client_id as string } });
  revalidatePath("/agency/failures");
}

export async function cancelTask(taskId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("id, client_id").eq("id", taskId).maybeSingle();
  if (!task) throw new Error("Task not found");
  await adminClient().from("tasks").update({ status: "cancelled" }).eq("id", taskId);
  revalidatePath(`/agency/clients/${task.client_id}/seo`);
}

export async function sendCommand(formData: FormData) {
  const staff = await requireStaff();
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return;
  const clientId = String(formData.get("clientId") ?? "") || null;
  if (clientId) await assertClientStaff(clientId);
  const runId = await createRun({ agencyId: staff.agency.id, clientId, kind: "command", prompt, createdBy: staff.userId });
  await inngest.send({ name: "command/requested", data: { runId } });
  redirect(`/agency/command?run=${runId}`);
}
