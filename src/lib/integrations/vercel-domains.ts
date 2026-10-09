import "server-only";
import { env } from "@/lib/env";

// Custom domains are attached to the Vercel project that serves all client sites.
// Without VERCEL_TOKEN this runs in "manual" mode and just returns DNS instructions.

export interface DomainStatus {
  domain: string;
  configured: boolean;
  verified: boolean;
  mode: "vercel" | "manual";
  instructions: { type: "A" | "CNAME" | "TXT"; name: string; value: string }[];
  error?: string;
}

function api(path: string) {
  const team = env().VERCEL_TEAM_ID ? `?teamId=${env().VERCEL_TEAM_ID}` : "";
  return `https://api.vercel.com${path}${team}`;
}

const defaultInstructions = (domain: string): DomainStatus["instructions"] =>
  domain.split(".").length > 2
    ? [{ type: "CNAME", name: domain.split(".")[0]!, value: "cname.vercel-dns.com" }]
    : [{ type: "A", name: "@", value: "76.76.21.21" }, { type: "CNAME", name: "www", value: "cname.vercel-dns.com" }];

export async function addDomain(domain: string): Promise<DomainStatus> {
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID } = env();
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) return { domain, configured: false, verified: false, mode: "manual", instructions: defaultInstructions(domain) };
  const res = await fetch(api(`/v10/projects/${VERCEL_PROJECT_ID}/domains`), {
    method: "POST",
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ name: domain }),
  });
  const body = (await res.json()) as { verified?: boolean; verification?: { type: string; domain: string; value: string }[]; error?: { code: string; message: string } };
  if (!res.ok && body.error?.code !== "domain_already_in_use") {
    return { domain, configured: false, verified: false, mode: "vercel", instructions: defaultInstructions(domain), error: body.error?.message ?? `Vercel error ${res.status}` };
  }
  return checkDomain(domain);
}

export async function checkDomain(domain: string): Promise<DomainStatus> {
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID } = env();
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) return { domain, configured: false, verified: false, mode: "manual", instructions: defaultInstructions(domain) };
  const headers = { Authorization: `Bearer ${VERCEL_TOKEN}` };
  const [projRes, cfgRes] = await Promise.all([
    fetch(api(`/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}`), { headers }),
    fetch(api(`/v6/domains/${domain}/config`), { headers }),
  ]);
  const proj = (await projRes.json()) as { verified?: boolean; verification?: { type: "TXT"; domain: string; value: string }[] };
  const cfg = (await cfgRes.json()) as { misconfigured?: boolean };
  const instructions = [...defaultInstructions(domain), ...(proj.verification ?? []).map((v) => ({ type: "TXT" as const, name: v.domain, value: v.value }))];
  return { domain, configured: cfg.misconfigured === false, verified: !!proj.verified && cfg.misconfigured === false, mode: "vercel", instructions };
}
