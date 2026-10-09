import { chromium, devices } from "@playwright/test";
const B = "http://localhost:3000";
const OUT = "portfolio/screenshots";
const brum = "ac52bd71-7def-5c98-a8c7-e50e7d20b7cd";
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const ctxOpts = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const hideScrollbars = "::-webkit-scrollbar{display:none} html{scrollbar-width:none}";

async function login(ctx, email) {
  const p = await ctx.newPage();
  await p.goto(`${B}/login`);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel(/Password/).fill("demo-password-123");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL(/agency|portal/);
  return p;
}
async function shot(p, name, url, { full = false, before } = {}) {
  if (url) await p.goto(`${B}${url}`);
  await p.addStyleTag({ content: hideScrollbars });
  if (before) await before(p);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("✓", name);
}

// Agency
const agency = await b.newContext(ctxOpts);
const a = await login(agency, "owner@demo.test");
await shot(a, "01-agency-overview", "/agency");
const { data: cmdUrl } = { data: null };
await a.goto(`${B}/agency/command`);
const firstCmd = await a.locator("a[href*='/agency/command?run=']").first().getAttribute("href");
await shot(a, "02-ai-command-console", firstCmd);
await shot(a, "03-client-overview", `/agency/clients/${brum}`);
await shot(a, "04-client-overview-full", `/agency/clients/${brum}`, { full: true });
await shot(a, "05-website-pages-and-history", `/agency/clients/${brum}/site`);
await shot(a, "06-seo-campaign", `/agency/clients/${brum}/seo`);
await shot(a, "07-approval-queue", "/agency/approvals");
const campaignRun = await a.locator("a", { hasText: "Planning log" }).first().getAttribute("href").catch(() => null);
await a.goto(`${B}/agency/clients/${brum}/seo`);
const runHref = await a.getByRole("link", { name: /Planning log/ }).first().getAttribute("href");
await shot(a, "08-agent-run-log", runHref);
await shot(a, "09-technical-audit", `/agency/clients/${brum}/audits`);
await shot(a, "10-keywords-and-competitors", `/agency/clients/${brum}/keywords`);
await shot(a, "11-autonomy-policy-settings", `/agency/clients/${brum}/settings`);
await shot(a, "12-onboard-client", "/agency/clients/new");
await shot(a, "13-activity-history", "/agency/runs");
await shot(a, "14-ai-usage", "/agency/usage");

// Client portal
const portal = await b.newContext(ctxOpts);
const c = await login(portal, "client@brumplumbing.test");
await shot(c, "15-client-portal", "/portal");
await shot(c, "16-client-portal-full", "/portal", { full: true });

// Generated client website
const site = await b.newContext(ctxOpts);
const s = await site.newPage();
await shot(s, "17-generated-site-home", null, { before: async (p) => p.goto("http://brum-plumbing-co.localhost:3000/") });
await shot(s, "18-generated-site-home-full", null, { full: true, before: async (p) => p.goto("http://brum-plumbing-co.localhost:3000/") });
await shot(s, "19-generated-site-service-page", null, { before: async (p) => p.goto("http://brum-plumbing-co.localhost:3000/boiler-repair") });
const roof = await site.newPage();
await shot(roof, "20-generated-site-roofing", null, { before: async (p) => p.goto("http://northern-roofing-ltd.localhost:3000/") });

const mobile = await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 3 });
const m = await mobile.newPage();
await shot(m, "21-generated-site-mobile", null, { before: async (p) => p.goto("http://brum-plumbing-co.localhost:3000/emergency-plumbing") });
const mp = await login(mobile, "client@brumplumbing.test");
await shot(mp, "22-client-portal-mobile", "/portal");
await b.close();
