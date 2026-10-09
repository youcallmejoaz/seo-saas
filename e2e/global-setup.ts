import { execSync } from "node:child_process";

// Fresh demo data for every run (the site renderer heals stale host mappings itself).
export default function globalSetup() {
  if (process.env.E2E_SEED === "0") return;
  execSync("pnpm seed", { stdio: "inherit" });
}
