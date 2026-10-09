import { describe, expect, it } from "vitest";
import { applyOps, changeOps, ChangeError, classifyOps, describeOp, linkifyFirstMention } from "@/lib/site/changes";
import { site } from "./fixtures";

let n = 100;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("change engine", () => {
  it("applies meta changes without mutating input and bumps version", () => {
    const pages = site();
    const r = applyOps(pages, [{ op: "set_meta", page: "boiler-repair", title: "Boiler Repair in Birmingham – Same Day | Brum" }], newId);
    expect(r.pages.find((p) => p.slug === "boiler-repair")!.title).toBe("Boiler Repair in Birmingham – Same Day | Brum");
    expect(r.pages.find((p) => p.slug === "boiler-repair")!.version).toBe(2);
    expect(pages.find((p) => p.slug === "boiler-repair")!.version).toBe(1);
    expect(r.touched).toEqual(["00000000-0000-4000-8000-000000000003"]);
  });

  it("links the first natural mention, otherwise appends a related link", () => {
    const r = applyOps(site(), [{ op: "add_internal_link", page: "emergency-plumbing", anchor_text: "boiler repair", target_path: "/boiler-repair" }], newId);
    const text = r.pages.find((p) => p.slug === "emergency-plumbing")!.blocks.find((b) => b.type === "rich_text");
    expect(text && text.type === "rich_text" && text.paragraphs[0]).toContain("[boiler repair](/boiler-repair)");

    const r2 = applyOps(site(), [{ op: "add_internal_link", page: "boiler-repair", anchor_text: "emergency callouts", target_path: "/emergency-plumbing" }], newId);
    const t2 = r2.pages.find((p) => p.slug === "boiler-repair")!.blocks.find((b) => b.type === "rich_text");
    expect(t2 && t2.type === "rich_text" && t2.paragraphs.at(-1)).toBe("Related: [emergency callouts](/emergency-plumbing).");
  });

  it("does not double-link text that is already a link", () => {
    const p = site()[1]!;
    const tb = p.blocks[1]!;
    if (tb.type === "rich_text") tb.paragraphs = ["See our [boiler repair](/boiler-repair) page. Boiler repair is quick."];
    expect(linkifyFirstMention(p, "boiler repair", "/boiler-repair")).toBe(true);
    expect(tb.type === "rich_text" && tb.paragraphs[0]).toBe("See our [boiler repair](/boiler-repair) page. Boiler repair is quick.");
  });

  it("rejects links to missing pages, self links and duplicate slugs", () => {
    expect(() => applyOps(site(), [{ op: "add_internal_link", page: "boiler-repair", anchor_text: "x", target_path: "/nope" }], newId)).toThrow(ChangeError);
    expect(() => applyOps(site(), [{ op: "add_internal_link", page: "boiler-repair", anchor_text: "boiler", target_path: "/boiler-repair" }], newId)).toThrow(/itself/);
    const pageContent = { slug: "boiler-repair", type: "service" as const, title: "Boiler repair page title", meta_description: "x".repeat(80), h1: "Boiler", blocks: site()[1]!.blocks };
    expect(() => applyOps(site(), [{ op: "create_page", publish: false, page: pageContent }], newId)).toThrow(/already exists/);
  });

  it("changes slugs with a redirect and rewrites inbound links", () => {
    const pages = site();
    const intro = pages[1]!.blocks[1]!;
    if (intro.type === "rich_text") intro.paragraphs.push("Read about [boilers](/boiler-repair).");
    const r = applyOps(pages, [{ op: "change_slug", page: "boiler-repair", new_slug: "boiler-repairs" }], newId);
    expect(r.redirects).toEqual([{ from: "/boiler-repair", to: "/boiler-repairs" }]);
    const t = r.pages[1]!.blocks[1]!;
    expect(t.type === "rich_text" && t.paragraphs.at(-1)).toBe("Read about [boilers](/boiler-repairs).");
    expect(r.touched).toContain(pages[1]!.id);
  });

  it("is all-or-nothing: an invalid later op fails the whole set", () => {
    expect(() =>
      applyOps(site(), [
        { op: "set_meta", page: "boiler-repair", title: "A perfectly valid new title here" },
        { op: "remove_block", page: "boiler-repair", block_id: "does-not-exist" },
      ], newId),
    ).toThrow(ChangeError);
  });

  it("creates pages as drafts unless publish is requested, and classifies risk", () => {
    const op = { op: "create_page" as const, publish: false, page: { slug: "areas/solihull", type: "location" as const, title: "Plumbers in Solihull | Brum", meta_description: "Local plumbers covering Solihull with fast response times and fixed prices. Call now.", h1: "Plumbers in Solihull", blocks: site()[1]!.blocks } };
    const r = applyOps(site(), [op], newId);
    expect(r.created).toHaveLength(1);
    expect(r.created[0]!.status).toBe("draft");
    expect(classifyOps([op]).risk).toBe("medium");
    expect(classifyOps([{ ...op, publish: true }]).risk).toBe("high");
    expect(classifyOps([{ op: "set_meta", page: "", title: "Some new title for home" }])).toEqual({ kinds: ["meta"], risk: "low" });
    expect(describeOp(op)).toContain("/areas/solihull");
  });

  it("validates op shapes with zod", () => {
    expect(changeOps.safeParse([{ op: "set_meta", page: "x", title: "short" }]).success).toBe(false);
    expect(changeOps.safeParse([{ op: "explode", page: "x" }]).success).toBe(false);
  });
});
