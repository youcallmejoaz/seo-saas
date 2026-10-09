import { z } from "zod";
import { block, blockId, pageContent, slugSchema, type Block, type PageState } from "./schema";
import type { ChangeKind, Risk } from "@/lib/db/types";

// Every edit the AI (or a human via natural language) makes to a site is expressed as a
// list of typed operations. Ops are validated, risk-classified, applied atomically to a
// snapshot of the site's pages, and can be rolled back from the stored `before` state.

const pageRef = z.string().min(1).describe("page id, or the page slug ('' for home)");

export const changeOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set_meta"),
    page: pageRef,
    title: z.string().trim().min(10).max(70).optional(),
    meta_description: z.string().trim().min(50).max(170).optional(),
    h1: z.string().trim().min(3).max(120).optional(),
    target_keyword: z.string().trim().max(120).optional(),
  }),
  z.object({ op: z.literal("set_alt_text"), page: pageRef, block_id: blockId, alt: z.string().trim().min(3).max(200) }),
  z.object({
    op: z.literal("add_internal_link"),
    page: pageRef,
    anchor_text: z.string().trim().min(2).max(80),
    target_path: z.string().trim().regex(/^\/[a-z0-9/-]*$/),
    block_id: blockId.optional(),
  }),
  z.object({ op: z.literal("update_block"), page: pageRef, block }),
  z.object({ op: z.literal("insert_block"), page: pageRef, after_block_id: blockId.nullable().optional(), block }),
  z.object({ op: z.literal("remove_block"), page: pageRef, block_id: blockId }),
  z.object({ op: z.literal("create_page"), page: pageContent, publish: z.boolean().default(false) }),
  z.object({ op: z.literal("change_slug"), page: pageRef, new_slug: slugSchema }),
  z.object({ op: z.literal("set_status"), page: pageRef, status: z.enum(["draft", "published", "archived"]) }),
  z.object({ op: z.literal("set_noindex"), page: pageRef, noindex: z.boolean() }),
]);

export type ChangeOp = z.infer<typeof changeOp>;
export const changeOps = z.array(changeOp).min(1).max(50);

const RISK_ORDER: Record<Risk, number> = { low: 0, medium: 1, high: 2 };

export function maxRisk(a: Risk, b: Risk): Risk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function riskAtMost(r: Risk, limit: Risk | "none"): boolean {
  return limit !== "none" && RISK_ORDER[r] <= RISK_ORDER[limit];
}

/** Kind + inherent risk of a single op. */
export function classifyOp(op: ChangeOp): { kind: ChangeKind; risk: Risk } {
  switch (op.op) {
    case "set_meta":
      return { kind: "meta", risk: "low" };
    case "set_alt_text":
      return { kind: "alt_text", risk: "low" };
    case "add_internal_link":
      return { kind: "internal_links", risk: "low" };
    case "update_block":
    case "insert_block":
      return { kind: "content_update", risk: "medium" };
    case "remove_block":
      return { kind: "content_rewrite", risk: "medium" };
    case "create_page":
      return { kind: "new_page", risk: op.publish ? "high" : "medium" };
    case "change_slug":
      return { kind: "slug_change", risk: "high" };
    case "set_status":
      return op.status === "published" ? { kind: "new_page", risk: "medium" } : { kind: "archive_page", risk: "high" };
    case "set_noindex":
      return { kind: "archive_page", risk: "high" };
  }
}

export function classifyOps(ops: ChangeOp[]): { kinds: ChangeKind[]; risk: Risk } {
  let risk: Risk = "low";
  const kinds = new Set<ChangeKind>();
  for (const op of ops) {
    const c = classifyOp(op);
    kinds.add(c.kind);
    risk = maxRisk(risk, c.risk);
  }
  return { kinds: [...kinds], risk };
}

export class ChangeError extends Error {}

export interface ApplyResult {
  pages: PageState[];
  /** Ids of pages whose content changed (existing pages). */
  touched: string[];
  /** Pages created by this change set. */
  created: PageState[];
  /** 301s to add: from old path to new path. */
  redirects: { from: string; to: string }[];
}

function findPage(pages: PageState[], ref: string): PageState {
  const page = pages.find((p) => p.id === ref) ?? pages.find((p) => p.slug === ref.replace(/^\//, ""));
  if (!page) throw new ChangeError(`Page not found: "${ref}"`);
  return page;
}

function findBlockIndex(page: PageState, id: string): number {
  const i = page.blocks.findIndex((b) => b.id === id);
  if (i < 0) throw new ChangeError(`Block "${id}" not found on page "/${page.slug}"`);
  return i;
}

function uniqueBlockId(page: PageState, wanted: string): string {
  const ids = new Set(page.blocks.map((b) => b.id));
  if (!ids.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!ids.has(`${wanted}-${n}`.slice(0, 40))) return `${wanted}-${n}`.slice(0, 40);
}

/**
 * Insert a markdown link for `anchor` into the first paragraph that mentions it (or the
 * named block). Returns false when no suitable unlinked mention exists.
 */
export function linkifyFirstMention(page: PageState, anchor: string, target: string, blockIdHint?: string): boolean {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the anchor only where it is not already inside [...] link text.
  const re = new RegExp(`(?<!\\[[^\\]]*)\\b(${escaped})\\b(?![^\\[]*\\])`, "i");
  const candidates = blockIdHint ? page.blocks.filter((b) => b.id === blockIdHint) : page.blocks;
  for (const b of candidates) {
    if (b.type !== "rich_text") continue;
    for (let i = 0; i < b.paragraphs.length; i++) {
      const p = b.paragraphs[i]!;
      if (p.includes(`](${target})`)) return true; // already links there
      if (re.test(p)) {
        b.paragraphs[i] = p.replace(re, `[$1](${target})`);
        return true;
      }
    }
  }
  return false;
}

/**
 * Apply ops to an in-memory copy of the site's pages. Pure: inputs are not mutated.
 * Throws ChangeError on the first invalid op so a change set applies all-or-nothing.
 */
export function applyOps(input: PageState[], ops: ChangeOp[], newId: () => string): ApplyResult {
  const pages: PageState[] = structuredClone(input);
  const touched = new Set<string>();
  const created: PageState[] = [];
  const redirects: { from: string; to: string }[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "set_meta": {
        const p = findPage(pages, op.page);
        if (op.title !== undefined) p.title = op.title;
        if (op.meta_description !== undefined) p.meta_description = op.meta_description;
        if (op.h1 !== undefined) p.h1 = op.h1;
        if (op.target_keyword !== undefined) p.target_keyword = op.target_keyword;
        touched.add(p.id);
        break;
      }
      case "set_alt_text": {
        const p = findPage(pages, op.page);
        const b = p.blocks[findBlockIndex(p, op.block_id)]!;
        if (b.type === "image") b.alt = op.alt;
        else if (b.type === "hero" && b.image) b.image.alt = op.alt;
        else throw new ChangeError(`Block "${op.block_id}" has no image`);
        touched.add(p.id);
        break;
      }
      case "add_internal_link": {
        const p = findPage(pages, op.page);
        const targetSlug = op.target_path.replace(/^\//, "").replace(/\/$/, "");
        if (!pages.some((x) => x.slug === targetSlug && x.status !== "archived"))
          throw new ChangeError(`Link target ${op.target_path} does not exist`);
        if (targetSlug === p.slug) throw new ChangeError("A page cannot link to itself");
        if (!linkifyFirstMention(p, op.anchor_text, op.target_path, op.block_id)) {
          // No natural mention: add a short related-link sentence to the last text block.
          const textBlock = [...p.blocks].reverse().find((b) => b.type === "rich_text");
          if (!textBlock || textBlock.type !== "rich_text") throw new ChangeError(`No text block on "/${p.slug}" to place a link in`);
          textBlock.paragraphs.push(`Related: [${op.anchor_text}](${op.target_path}).`);
        }
        touched.add(p.id);
        break;
      }
      case "update_block": {
        const p = findPage(pages, op.page);
        const i = findBlockIndex(p, op.block.id);
        p.blocks[i] = op.block as Block;
        touched.add(p.id);
        break;
      }
      case "insert_block": {
        const p = findPage(pages, op.page);
        const b = { ...op.block, id: uniqueBlockId(p, op.block.id) } as Block;
        const at = op.after_block_id ? findBlockIndex(p, op.after_block_id) + 1 : p.blocks.length;
        p.blocks.splice(at, 0, b);
        touched.add(p.id);
        break;
      }
      case "remove_block": {
        const p = findPage(pages, op.page);
        p.blocks.splice(findBlockIndex(p, op.block_id), 1);
        if (p.blocks.length === 0) throw new ChangeError(`Removing "${op.block_id}" would leave "/${p.slug}" empty`);
        touched.add(p.id);
        break;
      }
      case "create_page": {
        if (pages.some((x) => x.slug === op.page.slug)) throw new ChangeError(`A page with slug "/${op.page.slug}" already exists`);
        const page: PageState = {
          ...structuredClone(op.page),
          target_keyword: op.page.target_keyword ?? null,
          id: newId(),
          status: op.publish ? "published" : "draft",
          noindex: false,
          version: 1,
        };
        pages.push(page);
        created.push(page);
        break;
      }
      case "change_slug": {
        const p = findPage(pages, op.page);
        if (p.type === "home") throw new ChangeError("The home page slug cannot change");
        if (pages.some((x) => x.slug === op.new_slug && x.id !== p.id)) throw new ChangeError(`Slug "/${op.new_slug}" is taken`);
        const from = `/${p.slug}`;
        const to = `/${op.new_slug}`;
        // Keep internal links pointing at the live URL.
        for (const other of pages) {
          let changed = false;
          for (const b of other.blocks) {
            if (b.type === "rich_text") {
              b.paragraphs = b.paragraphs.map((s) => {
                const r = s.split(`](${from})`).join(`](${to})`);
                if (r !== s) changed = true;
                return r;
              });
            }
          }
          if (changed) touched.add(other.id);
        }
        p.slug = op.new_slug;
        redirects.push({ from, to });
        touched.add(p.id);
        break;
      }
      case "set_status": {
        const p = findPage(pages, op.page);
        if (p.type === "home" && op.status !== "published") throw new ChangeError("The home page cannot be unpublished");
        p.status = op.status;
        touched.add(p.id);
        break;
      }
      case "set_noindex": {
        const p = findPage(pages, op.page);
        p.noindex = op.noindex;
        touched.add(p.id);
        break;
      }
    }
  }

  for (const p of pages) {
    const check = pageContent.safeParse(p);
    if (!check.success) throw new ChangeError(`Page "/${p.slug}" would be invalid: ${check.error.issues[0]?.message}`);
  }

  for (const p of pages) if (touched.has(p.id)) p.version += 1;
  return { pages, touched: [...touched].filter((id) => !created.some((c) => c.id === id)), created, redirects };
}

/** Human-readable one-liner per op, for approval screens and activity logs. */
export function describeOp(op: ChangeOp): string {
  switch (op.op) {
    case "set_meta":
      return `Update ${[op.title && "title", op.meta_description && "meta description", op.h1 && "H1"].filter(Boolean).join(", ") || "metadata"} on ${ref(op.page)}`;
    case "set_alt_text":
      return `Set image alt text on ${ref(op.page)}`;
    case "add_internal_link":
      return `Link "${op.anchor_text}" → ${op.target_path} on ${ref(op.page)}`;
    case "update_block":
      return `Rewrite ${op.block.type.replace("_", " ")} section "${op.block.id}" on ${ref(op.page)}`;
    case "insert_block":
      return `Add ${op.block.type.replace("_", " ")} section to ${ref(op.page)}`;
    case "remove_block":
      return `Remove section "${op.block_id}" from ${ref(op.page)}`;
    case "create_page":
      return `Create ${op.page.type.replace("_", " ")} page /${op.page.slug}${op.publish ? " (publish)" : " (draft)"}`;
    case "change_slug":
      return `Move ${ref(op.page)} to /${op.new_slug} (with 301 redirect)`;
    case "set_status":
      return `Set ${ref(op.page)} to ${op.status}`;
    case "set_noindex":
      return `${op.noindex ? "Hide" : "Show"} ${ref(op.page)} ${op.noindex ? "from" : "to"} search engines`;
  }
}

function ref(page: string) {
  return /^[0-9a-f-]{36}$/.test(page) ? "page" : `/${page.replace(/^\//, "")}`;
}
