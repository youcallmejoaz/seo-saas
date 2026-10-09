import { chromium } from "@playwright/test";
const B = "http://localhost:3000";
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const page = await (await b.newContext()).newPage();
await page.goto(`${B}/login`);
await page.getByLabel("Email").fill("owner@demo.test");
await page.getByLabel(/Password/).fill("demo-password-123");
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForURL(/agency/);
const brum = "ac52bd71-7def-5c98-a8c7-e50e7d20b7cd";
// Audit
await page.goto(`${B}/agency/clients/${brum}/audits`);
await page.getByRole("button", { name: "Run audit now" }).click();
// Campaign
await page.goto(`${B}/agency/clients/${brum}/seo`);
await page.getByLabel("Goal").fill("Improve rankings for emergency plumbing in Birmingham");
await page.getByLabel(/Target keywords/).fill("emergency plumber birmingham, 24 hour plumber birmingham");
await page.getByRole("button", { name: /Plan & run campaign/ }).click();
await page.waitForURL(/runs/);
// Opportunity scan for roofing
await page.goto(`${B}/agency/clients`);
await page.getByRole("link", { name: "Northern Roofing Ltd" }).click();
await page.getByRole("button", { name: "Find opportunities" }).click();
await page.waitForTimeout(15000);
// Command
await page.goto(`${B}/agency/command`);
await page.locator("textarea[name=prompt]").fill("Show me which clients have experienced ranking improvements this month.");
await page.getByRole("button", { name: "Run" }).click();
await page.waitForURL(/run=/);
await page.waitForTimeout(15000);
await b.close();
console.log("prep done");
