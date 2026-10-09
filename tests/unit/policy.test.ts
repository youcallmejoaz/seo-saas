import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, decide } from "@/lib/agents/policy";
import type { ChangeOp } from "@/lib/site/changes";

const meta: ChangeOp = { op: "set_meta", page: "", title: "A brand new title for the page" };
const newPage: ChangeOp = { op: "create_page", publish: false, page: { slug: "x", type: "service", title: "A new service page", meta_description: "m".repeat(80), h1: "New", blocks: [] } };

describe("autonomy policy", () => {
  it("auto-applies low-risk allowed kinds for active clients", () => {
    expect(decide([meta], DEFAULT_POLICY, "active").action).toBe("auto_apply");
  });
  it("requires approval for kinds not on the list", () => {
    const d = decide([meta, newPage], DEFAULT_POLICY, "active");
    expect(d.action).toBe("require_approval");
    expect(d.risk).toBe("medium");
  });
  it("respects the max auto risk even if the kind is allowed", () => {
    expect(decide([newPage], { auto_apply: ["new_page"], max_auto_risk: "low" }, "active").action).toBe("require_approval");
    expect(decide([newPage], { auto_apply: ["new_page"], max_auto_risk: "medium" }, "active").action).toBe("auto_apply");
    expect(decide([meta], { auto_apply: ["meta"], max_auto_risk: "none" }, "active").action).toBe("require_approval");
  });
  it("blocks all changes for paused and offboarded clients", () => {
    expect(decide([meta], DEFAULT_POLICY, "paused").action).toBe("blocked");
    expect(decide([meta], DEFAULT_POLICY, "offboarded").action).toBe("blocked");
  });
});
