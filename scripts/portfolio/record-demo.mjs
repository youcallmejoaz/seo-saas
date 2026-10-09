import { chromium } from "@playwright/test";
const B = "http://localhost:3000";
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, slowMo: 60 });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Frames + an ffmpeg concat list go here; see portfolio/README.md for the encode commands.
const REC = process.env.REC_DIR ?? join(tmpdir(), "rankpilot-rec");
mkdirSync(REC, { recursive: true });

// Visible cursor + click ripple (headless recordings have no pointer).
await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;left:-40px;top:-40px;transform:translate(-3px,-2px);transition:left .25s ease, top .25s ease";
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1 3.8 7.4-2.6 1.3-3.8-7.5L4 19z" fill="#111" stroke="#fff" stroke-width="1.5"/></svg>';
    document.documentElement.appendChild(c);
    const st = document.createElement("style");
    st.textContent = "::-webkit-scrollbar{display:none} @keyframes __rip{from{transform:scale(.3);opacity:.6}to{transform:scale(2.2);opacity:0}}";
    document.documentElement.appendChild(st);
    const last = sessionStorage.getItem("__cur");
    if (last) { const [x, y] = last.split(","); c.style.transition = "none"; c.style.left = x + "px"; c.style.top = y + "px"; requestAnimationFrame(() => (c.style.transition = "left .25s ease, top .25s ease")); }
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; sessionStorage.setItem("__cur", e.clientX + "," + e.clientY); }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;background:rgba(47,111,237,.45);animation:__rip .5s ease-out forwards`;
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
});

const page = await ctx.newPage();
// Capture frames with Chrome's screencast (timestamps let ffmpeg rebuild real timing).
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  const name = join(REC, `f${String(frames.length).padStart(5, "0")}.jpg`);
  writeFileSync(name, Buffer.from(f.data, "base64"));
  frames.push({ name, t: f.metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
const pause = (ms) => page.waitForTimeout(ms);
async function moveTo(locator) {
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await pause(250);
}
async function click(locator) { await moveTo(locator); await locator.click(); }
async function type(locator, text, delay = 28) { await click(locator); await locator.pressSequentially(text, { delay }); }
async function smoothScroll(total, step = 90) { for (let y = 0; y < total; y += step) { await page.mouse.wheel(0, step); await pause(55); } }

// 1. Sign in
await page.goto(`${B}/login`);
await pause(600);
await type(page.getByLabel("Email"), "owner@demo.test", 22);
await type(page.getByLabel(/Password/), "demo-password-123", 18);
await click(page.getByRole("button", { name: "Continue" }));
await page.waitForURL(/agency/);
await pause(2200);

// 2. Onboard a client
await click(page.getByRole("button", { name: "Onboard client" }));
await page.waitForURL(/clients\/new/);
await pause(700);
await type(page.getByLabel("Business name"), "Peak Electrical Services");
await type(page.getByLabel("Industry"), "Electricians");
await type(page.getByLabel(/Services/), "Emergency electrician\nRewiring\nEV charger installation", 18);
await type(page.getByLabel(/Locations served/), "Leeds\nBradford\nWakefield", 22);
await type(page.getByLabel("Phone"), "0113 496 0123", 20);
await type(page.getByLabel(/Selling points/), "NICEIC approved contractor\nFree EV charger surveys", 18);
await pause(500);
await click(page.getByRole("button", { name: /Create client/ }));
await page.waitForURL(/\/site/);

// 3. Watch the AI build the site (live run log)
for (let i = 0; i < 40; i++) {
  await pause(1000);
  if (await page.getByRole("button", { name: "Publish site" }).isVisible().catch(() => false)) break;
  if (i % 4 === 3) await page.reload();
}
await page.reload();
await pause(1800);

// 4. Publish + view the generated site
await click(page.getByRole("button", { name: "Publish site" }));
await pause(1600);
await page.goto("http://peak-electrical-services.localhost:3000/");
await pause(1800);
await smoothScroll(2600);
await pause(800);
await page.goto("http://peak-electrical-services.localhost:3000/ev-charger-installation");
await pause(1500);
await smoothScroll(900);
await pause(700);

// 5. Approve an AI change
await page.goto(`${B}/agency/approvals`);
await pause(1800);
await click(page.getByRole("button", { name: /Approve & apply/ }).first());
await pause(2500);
await page.reload();
await pause(1500);

// 6. Ask the AI
await page.goto(`${B}/agency/command`);
await pause(800);
await type(page.locator("textarea[name=prompt]"), "Show me which clients have experienced ranking improvements this month.", 20);
await click(page.getByRole("button", { name: "Run" }));
await page.waitForURL(/run=/);
for (let i = 0; i < 20; i++) {
  await pause(1500);
  await page.reload();
  if (await page.locator("strong", { hasText: "Brum Plumbing Co" }).first().isVisible().catch(() => false)) break;
}
await moveTo(page.locator("strong", { hasText: "Brum Plumbing Co" }).first());
await pause(3500);

await cdp.send("Page.stopScreencast");
// ffmpeg concat list with per-frame durations (screencast only emits on change).
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(0.01, frames[i + 1].t - frames[i].t) : 1.5;
  lines.push(`file '${frames[i].name}'`, `duration ${d.toFixed(3)}`);
}
lines.push(`file '${frames.at(-1).name}'`);
writeFileSync(join(REC, "frames.txt"), lines.join("\n"));
console.log(`frames: ${join(REC, "frames.txt")}`);
await ctx.close();
await b.close();
console.log("recorded", frames.length, "frames over", (frames.at(-1).t - frames[0].t).toFixed(1), "s");
