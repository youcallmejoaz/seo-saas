import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/(agency|portal)/);
}

/** Poll a run page until it reaches a terminal status. */
async function waitForRun(page: Page, runUrl: string, statuses = /succeeded|awaiting approval|failed/) {
  await page.goto(runUrl);
  await expect(async () => {
    await page.reload();
    await expect(page.locator("p", { hasText: "Status:" }).getByText(statuses)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 120_000, intervals: [2000] });
}

test.describe.serial("platform smoke", () => {
  test("published demo site renders with SEO essentials", async ({ page, request }) => {
    await page.goto("/sites/sub~brum-plumbing-co");
    await expect(page.locator("h1")).toContainText("Birmingham");
    await expect(page).toHaveTitle(/Brum Plumbing Co/);
    expect(await page.locator('script[type="application/ld+json"]').count()).toBeGreaterThan(0);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain("brum-plumbing-co.");
    const sitemap = await request.get("/sites/sub~brum-plumbing-co/sitemap.xml");
    expect(await sitemap.text()).toContain("<urlset");

    // Real subdomain routing (Chromium resolves *.localhost to loopback).
    await page.goto("http://brum-plumbing-co.localhost:3000/emergency-plumbing");
    await expect(page.locator("h1")).toContainText(/Emergency Plumbing/i);
  });

  test("lead form submissions reach the client", async ({ page }) => {
    await page.goto("/sites/sub~brum-plumbing-co/contact");
    await page.getByLabel("Name").fill("E2E Tester");
    await page.getByLabel("Email").fill("e2e@example.com");
    await page.getByLabel("How can we help?").fill("Leaking tap");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(page.getByText("we'll be in touch")).toBeVisible();
  });

  test("agency owner sees the portfolio and approves a change", async ({ page }) => {
    await login(page, "owner@demo.test");
    await expect(page.getByRole("heading", { name: "Agency overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Brum Plumbing Co" }).first()).toBeVisible();

    await page.goto("/agency/approvals");
    const card = page.locator("div.px-5.py-4").filter({ hasText: "Brum Plumbing Co" }).filter({ hasText: "proposed" }).first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /Approve/ }).click();
    await expect(async () => {
      await page.goto("/agency/approvals");
      await expect(page.locator("div.px-5.py-4").filter({ hasText: "Brum Plumbing Co" }).filter({ hasText: "applied" }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000, intervals: [2000] });
  });

  test("onboarding generates a website that can be published", async ({ page }) => {
    await login(page, "owner@demo.test");
    await page.goto("/agency/clients/new");
    const name = `Smoke Test Plumbing ${Date.now().toString(36)}`;
    await page.getByLabel("Business name").fill(name);
    await page.getByLabel("Industry").fill("Plumbing");
    await page.getByLabel(/Services/).fill("Emergency plumbing\nBoiler repair");
    await page.getByLabel(/Locations served/).fill("Birmingham\nSolihull");
    await page.getByLabel("Phone").fill("0121 000 0000");
    await page.getByRole("button", { name: /Create client/ }).click();
    await page.waitForURL(/\/agency\/clients\/[^/]+\/site/);
    const siteUrl = page.url().split("?")[0]!;

    await expect(async () => {
      await page.goto(siteUrl);
      await expect(page.getByRole("button", { name: "Publish site" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 120_000, intervals: [3000] });
    await expect(page.getByRole("cell", { name: /^Boiler Repair in Birmingham \/boiler-repair ·/ })).toBeVisible();
    await page.getByRole("button", { name: "Publish site" }).click();
    await expect(page.getByText("published").first()).toBeVisible();
  });

  test("campaign plans tasks and auto-applies low-risk work", async ({ page }) => {
    await login(page, "owner@demo.test");
    await page.goto("/agency/clients");
    await page.getByRole("link", { name: "Northern Roofing Ltd" }).click();
    await page.getByRole("link", { name: "SEO campaign" }).click();
    await page.getByLabel("Goal").fill("Improve rankings for roof repairs in Manchester");
    await page.getByLabel(/Target keywords/).fill("roof repairs manchester");
    await page.getByRole("button", { name: /Plan & run campaign/ }).click();
    await page.waitForURL(/\/agency\/runs\//);
    await waitForRun(page, page.url(), /succeeded/);
    await expect(page.getByText(/Plan ready/)).toBeVisible();

    // Executed tasks: low-risk changes are applied, others wait for approval.
    await expect(async () => {
      await page.goto("/agency/approvals");
      await expect(page.getByText(/Northern Roofing Ltd/).first()).toBeVisible({ timeout: 2000 });
      await expect(page.locator("div.px-5.py-4").filter({ hasText: "Northern Roofing Ltd" }).filter({ hasText: "applied" }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 120_000, intervals: [3000] });
  });

  test("natural-language command answers portfolio questions", async ({ page }) => {
    await login(page, "owner@demo.test");
    await page.goto("/agency/command");
    await page.locator("textarea[name=prompt]").fill("Show me which clients have experienced ranking improvements this month.");
    await page.getByRole("button", { name: "Run" }).click();
    await page.waitForURL(/run=/);
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/Clients by change in organic clicks/).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 90_000, intervals: [2000] });
    await expect(page.locator("strong", { hasText: "Brum Plumbing Co" }).first()).toBeVisible();
  });

  test("client portal shows only the client's own data", async ({ page }) => {
    await login(page, "client@brumplumbing.test");
    await expect(page).toHaveURL(/\/portal/);
    await expect(page.getByRole("heading", { name: "Brum Plumbing Co" })).toBeVisible();
    await expect(page.getByText("Visits from Google").first()).toBeVisible();
    await expect(page.getByText("E2E Tester")).toBeVisible();
    await expect(page.getByText("Northern Roofing")).toHaveCount(0);
    await page.goto("/agency");
    await expect(page).toHaveURL(/\/portal/);
  });
});
