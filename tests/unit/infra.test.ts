import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { toGeminiSchema } from "@/lib/ai/json-schema";
import { assertWithinBudget, BudgetExceededError, costUsd } from "@/lib/ai/usage";
import { auditScore, technicalIssues } from "@/lib/audit/checks";
import { parsePage } from "@/lib/audit/crawler";
import { decrypt, encrypt, sign, verify } from "@/lib/crypto";
import { resetEnvCache } from "@/lib/env";
import { classifyHost, fetchableUrl } from "@/lib/hosts";
import { changeOp } from "@/lib/site/changes";

describe("host routing", () => {
  it("separates the app, subdomain sites and custom domains", () => {
    expect(classifyHost("localhost:3000", "localhost:3000")).toEqual({ kind: "app" });
    expect(classifyHost("acme.localhost:3000", "localhost:3000")).toEqual({ kind: "site", subdomain: "acme" });
    expect(classifyHost("app.rankpilot.io", "rankpilot.io")).toEqual({ kind: "app" });
    expect(classifyHost("brum.rankpilot.io", "rankpilot.io")).toEqual({ kind: "site", subdomain: "brum" });
    expect(classifyHost("www.brumplumbing.co.uk", "rankpilot.io")).toEqual({ kind: "custom", domain: "brumplumbing.co.uk" });
    expect(classifyHost("my-app.vercel.app", "rankpilot.io")).toEqual({ kind: "app" });
  });
  it("maps dev subdomain URLs to the internal renderer", () => {
    expect(fetchableUrl("http://acme.localhost:3000/boiler-repair", "localhost:3000", "http://localhost:3000")).toBe("http://localhost:3000/sites/sub~acme/boiler-repair");
    expect(fetchableUrl("https://acme.co.uk/x", "rankpilot.io", "https://rankpilot.io")).toBe("https://acme.co.uk/x");
  });
});

describe("crypto", () => {
  afterEach(() => resetEnvCache());
  it("round-trips encryption and rejects tampering", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    resetEnvCache();
    const c = encrypt(JSON.stringify({ refresh_token: "secret" }));
    expect(c).not.toContain("secret");
    expect(JSON.parse(decrypt(c)).refresh_token).toBe("secret");
    const parts = c.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
    const s = sign("hello");
    expect(verify(s)).toBe("hello");
    expect(verify(s.replace(/.$/, s.endsWith("a") ? "b" : "a"))).toBeNull();
  });
});

describe("cost metering", () => {
  it("prices by longest model prefix and enforces budgets", () => {
    const table = { "gemini-2.5-flash": { input: 0.3, output: 2.5 }, "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 } };
    expect(costUsd("gemini-2.5-flash-001", { inputTokens: 1_000_000, outputTokens: 0 }, table)).toBeCloseTo(0.3);
    expect(costUsd("gemini-2.5-flash-lite", { inputTokens: 0, outputTokens: 1_000_000 }, table)).toBeCloseTo(0.4);
    expect(costUsd("unknown", { inputTokens: 5, outputTokens: 5 }, table)).toBe(0);
    expect(() => assertWithinBudget({ monthCostUsd: 25, monthlyBudgetUsd: 25, requestsToday: 0, dailyRequestCap: 10 })).toThrow(BudgetExceededError);
    expect(() => assertWithinBudget({ monthCostUsd: 0, monthlyBudgetUsd: 25, requestsToday: 10, dailyRequestCap: 10 })).toThrow(/Daily/);
    expect(() => assertWithinBudget({ monthCostUsd: 1, monthlyBudgetUsd: 25, requestsToday: 1, dailyRequestCap: 10 })).not.toThrow();
  });
});

describe("gemini schema conversion", () => {
  it("keeps only supported keywords and maps const to enum", () => {
    const s = toGeminiSchema(z.object({ kind: z.literal("x"), name: z.string().max(10).regex(/^a/) }));
    const json = JSON.stringify(s);
    expect(json).not.toContain('"const"');
    expect(json).not.toContain('"pattern"');
    expect(json).not.toContain('"$schema"');
    expect(json).toContain('"enum":["x"]');
    expect(json).toContain("max 10 characters");
  });
  it("converts the full change-op union", () => {
    const s = toGeminiSchema(changeOp);
    expect(JSON.stringify(s).length).toBeGreaterThan(1000);
    expect(s.anyOf ?? s.oneOf).toBeTruthy();
  });
});

describe("crawler checks", () => {
  it("parses on-page signals", () => {
    const p = parsePage("https://a.test/x", `<html><head><title>T</title><meta name="description" content="D"></head><body><h1>One</h1><h1>Two</h1><img src="a.png"><a href="/y">y</a><a href="https://other.test/">o</a><script type="application/ld+json">{}</script></body></html>`);
    expect(p.title).toBe("T");
    expect(p.h1s).toHaveLength(2);
    expect(p.imagesMissingAlt).toBe(1);
    expect(p.internalLinks).toEqual(["https://a.test/y"]);
    expect(p.hasJsonLd).toBe(true);
  });
  it("reports technical issues and scores", () => {
    const base = { ms: 100, redirectedTo: null, contentType: "text/html", canonical: "x", robots: null, wordCount: 500, imagesMissingAlt: 0, internalLinks: [], hasJsonLd: true, bytes: 1 };
    const issues = technicalIssues({
      pages: [
        { ...base, url: "https://a.test", status: 200, title: "Same", metaDescription: "d", h1s: ["h"] },
        { ...base, url: "https://a.test/b", status: 200, title: "Same", metaDescription: null, h1s: [] },
        { ...base, url: "https://a.test/c", status: 404, title: null, metaDescription: null, h1s: [] },
      ],
      robotsTxt: { status: 200, body: "User-agent: *\nDisallow: /\n" },
      sitemap: null,
    });
    const ids = issues.map((i) => i.check);
    expect(ids).toEqual(expect.arrayContaining(["duplicate_title", "meta_missing", "h1_missing", "broken_page", "robots_blocks_all", "sitemap_missing"]));
    expect(auditScore(issues, 3)).toBeLessThan(100);
  });
});
