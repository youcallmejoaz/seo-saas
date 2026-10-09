import { describe, expect, it } from "vitest";
import { aggregate, compareWindows } from "@/lib/agents/measure";

describe("impact measurement", () => {
  it("weights position by impressions", () => {
    expect(aggregate([{ clicks: 1, impressions: 100, position: 10 }, { clicks: 1, impressions: 300, position: 2 }]).position).toBe(4);
  });
  it("labels improvements, declines and thin data", () => {
    const before = { clicks: 50, impressions: 1000, ctr: 0.05, position: 9 };
    expect(compareWindows(before, { clicks: 70, impressions: 1100, ctr: 0.06, position: 7 }, 14, ["/x"]).verdict).toBe("improved");
    expect(compareWindows(before, { clicks: 30, impressions: 900, ctr: 0.03, position: 11 }, 14, ["/x"]).verdict).toBe("declined");
    expect(compareWindows({ clicks: 0, impressions: 5, ctr: 0, position: 30 }, { clicks: 0, impressions: 4, ctr: 0, position: 28 }, 14, []).verdict).toBe("insufficient_data");
  });
});
