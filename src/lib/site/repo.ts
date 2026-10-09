import "server-only";
import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { adminClient } from "@/lib/supabase/admin";
import type { ChangeSetRow, Client, PageRow, Site } from "@/lib/db/types";
import { decide, type PolicyDecision } from "@/lib/agents/policy";
import { applyOps, changeOps, classifyOps, ChangeError, describeOp, type ChangeOp } from "./changes";
import { PAGE_COLUMNS, siteTag, toPageState } from "./load";
import type { PageState } from "./schema";

// Persistence for sites and change sets (service role; callers enforce tenancy).

export async function getSite(siteId: string): Promise<Site> {
  const { data, error } = await adminClient().from("sites").select("*").eq("id", siteId).single();
  if (error || !data) throw new Error(`Site ${siteId} not found`);
  return data as Site;
}

export async function getClient(clientId: string): Promise<Client> {
  const { data, error } = await adminClient().from("clients").select("*").eq("id", clientId).single();
  if (error || !data) throw new Error(`Client ${clientId} not found`);
  return data as Client;
}

export async function primarySiteFor(clientId: string): Promise<Site | null> {
  const { data } = await adminClient().from("sites").select("*").eq("client_id", clientId).neq("status", "archived").order("created_at").limit(1).maybeSingle();
  return (data as Site | null) ?? null;
}

export async function loadPages(siteId: string, opts: { includeArchived?: boolean } = {}): Promise<PageState[]> {
  let q = adminClient().from("pages").select(PAGE_COLUMNS).eq("site_id", siteId);
  if (!opts.includeArchived) q = q.neq("status", "archived");
  const { data, error } = await q.order("slug");
  if (error) throw new Error(`loadPages: ${error.message}`);
  return (data ?? []).map((r) => toPageState(r as PageRow));
}

export function pageToRow(p: PageState) {
  return {
    id: p.id,
    slug: p.slug,
    type: p.type,
    title: p.title,
    meta_description: p.meta_description,
    h1: p.h1,
    target_keyword: p.target_keyword ?? null,
    blocks: p.blocks,
    status: p.status,
    noindex: p.noindex,
    version: p.version,
  };
}

/** Replace a site's pages wholesale (used by initial generation only). */
export async function replaceSitePages(site: Pick<Site, "id" | "client_id">, pages: PageState[]) {
  const db = adminClient();
  const { error: delErr } = await db.from("pages").delete().eq("site_id", site.id);
  if (delErr) throw new Error(delErr.message);
  const { error } = await db.from("pages").insert(pages.map((p) => ({ ...pageToRow(p), site_id: site.id, client_id: site.client_id })));
  if (error) throw new Error(`replaceSitePages: ${error.message}`);
  revalidateSite(site.id);
}

export function revalidateSite(siteId: string) {
  try {
    revalidateTag(siteTag(siteId));
  } catch {
    // Outside a Next.js request context (scripts/tests): nothing cached to invalidate.
  }
}

export function newPageId() {
  return randomUUID();
}

/**
 * Validate ops against the current site, store a change set, and decide whether it can be
 * auto-applied. Throws ChangeError if the ops cannot apply cleanly.
 */
export async function proposeChangeSet(input: {
  site: Site;
  client: Client;
  ops: unknown;
  summary: string;
  rationale?: string;
  runId?: string | null;
  taskId?: string | null;
}): Promise<{ changeSet: ChangeSetRow; decision: PolicyDecision }> {
  const ops = changeOps.parse(input.ops);
  const pages = await loadPages(input.site.id, { includeArchived: true });
  applyOps(pages, ops, newPageId); // dry run: fail fast on invalid ops
  const { risk } = classifyOps(ops);
  const decision = decide(ops, input.client.autonomy_policy, input.client.status);
  const { data, error } = await adminClient()
    .from("change_sets")
    .insert({
      client_id: input.client.id,
      site_id: input.site.id,
      task_id: input.taskId ?? null,
      run_id: input.runId ?? null,
      summary: input.summary.slice(0, 500),
      rationale: [input.rationale, decision.reason].filter(Boolean).join("\n\n"),
      risk,
      status: decision.action === "blocked" ? "rejected" : "proposed",
      ops,
    })
    .select("*")
    .single();
  if (error) throw new Error(`proposeChangeSet: ${error.message}`);
  return { changeSet: data as ChangeSetRow, decision };
}

/** Apply a stored change set (proposed or approved) atomically. */
export async function applyChangeSet(changeSetId: string): Promise<{ touched: number; created: number }> {
  const db = adminClient();
  const { data: cs, error } = await db.from("change_sets").select("*").eq("id", changeSetId).single();
  if (error || !cs) throw new Error(`Change set ${changeSetId} not found`);
  const row = cs as ChangeSetRow;
  const ops = changeOps.parse(row.ops) as ChangeOp[];
  const pages = await loadPages(row.site_id, { includeArchived: true });
  let result;
  try {
    result = applyOps(pages, ops, newPageId);
  } catch (err) {
    if (err instanceof ChangeError) {
      await db.from("change_sets").update({ status: "failed", error: err.message }).eq("id", changeSetId);
    }
    throw err;
  }
  const before = {
    pages: pages.filter((p) => result.touched.includes(p.id)).map(pageToRow),
    created: result.created.map((p) => p.id),
    redirects: result.redirects.map((r) => r.from),
  };
  const updates = result.pages.filter((p) => result.touched.includes(p.id)).map(pageToRow);
  const { error: rpcErr } = await db.rpc("apply_change_set", {
    p_change_set: changeSetId,
    p_updates: updates,
    p_creates: result.created.map(pageToRow),
    p_redirects: result.redirects,
    p_before: before,
  });
  if (rpcErr) {
    await db.from("change_sets").update({ status: "failed", error: rpcErr.message }).eq("id", changeSetId);
    throw new Error(`apply_change_set: ${rpcErr.message}`);
  }
  revalidateSite(row.site_id);
  return { touched: updates.length, created: result.created.length };
}

export async function rollbackChangeSet(changeSetId: string) {
  const db = adminClient();
  const { data: cs } = await db.from("change_sets").select("site_id").eq("id", changeSetId).single();
  const { error } = await db.rpc("rollback_change_set", { p_change_set: changeSetId });
  if (error) throw new Error(`rollback: ${error.message}`);
  if (cs) revalidateSite(cs.site_id as string);
}

export function summariseOps(ops: ChangeOp[]): string {
  const lines = ops.map(describeOp);
  return lines.length <= 3 ? lines.join("; ") : `${lines.slice(0, 3).join("; ")} and ${lines.length - 3} more`;
}

/** Publish a site and all of its non-archived pages. */
export async function publishSite(siteId: string) {
  const db = adminClient();
  const { error: pErr } = await db.from("pages").update({ status: "published" }).eq("site_id", siteId).eq("status", "draft");
  if (pErr) throw new Error(pErr.message);
  const { error } = await db.from("sites").update({ status: "published", published_at: new Date().toISOString() }).eq("id", siteId);
  if (error) throw new Error(error.message);
  revalidateSite(siteId);
}
