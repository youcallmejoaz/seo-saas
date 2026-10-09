import { describe, expect, it } from "vitest";
import { expectedCtr, findOpportunities } from "@/lib/agents/opportunities";
import { site } from "./fixtures";

const business = { name: "Brum Plumbing Co", services: ["Emergency plumbing", "Boiler repair", "Bathroom installation"], locations: ["Birmingham", "Solihull"] };

describe("opportunity scanner", () => {
  it("finds low-CTR pages, striking-distance queries and coverage gaps", () => {
    const rows = [
      { page: "https://brum.test/boiler-repair", query: "boiler repair birmingham", clicks: 2, impressions: 900, position: 4.2 },
      { page: "https://brum.test/emergency-plumbing", query: "24 hour plumber birmingham", clicks: 3, impressions: 400, position: 12.5 },
    ];
    const ops = findOpportunities({ pages: site(), rows, business });
    const kinds = ops.map((o) => `${o.kind}:${o.payload.target_page ?? o.payload.new_page_slug}`);
    expect(kinds).toContain("meta_optimize:boiler-repair");
    expect(kinds).toContain("content_expand:emergency-plumbing");
    expect(kinds).toContain("new_service_page:bathroom-installation");
    expect(kinds).toContain("new_location_page:areas/solihull");
    expect(ops[0]!.priority).toBeGreaterThanOrEqual(ops.at(-1)!.priority);
  });

  it("does not flag healthy snippets", () => {
    const rows = [{ page: "https://brum.test/boiler-repair", query: "boiler repair birmingham", clicks: 200, impressions: 900, position: 3 }];
    expect(findOpportunities({ pages: site(), rows, business: { ...business, services: [], locations: [] } }).filter((o) => o.kind === "meta_optimize" && o.payload.target_page === "boiler-repair")).toEqual([]);
  });

  it("has a sane expected CTR curve", () => {
    expect(expectedCtr(1)).toBeGreaterThan(expectedCtr(5));
    expect(expectedCtr(40)).toBeGreaterThan(0);
  });
});
