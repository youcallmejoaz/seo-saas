import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { env, requireEnv } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";

// Google OAuth + Search Console + GA4 Data API via plain REST (no heavy SDK).
// Tokens are stored encrypted in integration_secrets (service-role only).

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters", // read performance data + submit sitemaps
  "https://www.googleapis.com/auth/analytics.readonly",
];

export const googleConfigured = () => !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);

export function redirectUri() {
  return `${env().NEXT_PUBLIC_APP_URL}/api/google/oauth/callback`;
}

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), ...body }),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new GoogleError(json.error_description ?? json.error ?? `token error ${res.status}`, res.status, json.error === "invalid_grant");
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000, scope: json.scope, id_token: json.id_token };
}

export class GoogleError extends Error {
  constructor(message: string, readonly status?: number, readonly revoked = false) {
    super(message);
  }
}

export async function exchangeCode(code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  let email: string | null = null;
  if (tokens.id_token) {
    try {
      email = JSON.parse(Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString()).email ?? null;
    } catch {
      email = null;
    }
  }
  return { tokens, email };
}

export async function saveGoogleIntegration(clientId: string, tokens: TokenSet, email: string | null) {
  const db = adminClient();
  const { data: integ, error } = await db
    .from("integrations")
    .upsert({ client_id: clientId, provider: "google", account_email: email, scopes: tokens.scope?.split(" ") ?? GOOGLE_SCOPES, status: "connected", last_error: null, connected_at: new Date().toISOString() }, { onConflict: "client_id,provider" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { data: existing } = await db.from("integration_secrets").select("ciphertext").eq("integration_id", integ.id).maybeSingle();
  // Google only returns a refresh token on first consent; keep the old one otherwise.
  const prev = existing ? (JSON.parse(decrypt(existing.ciphertext as string)) as TokenSet) : null;
  const merged = { ...tokens, refresh_token: tokens.refresh_token ?? prev?.refresh_token };
  await db.from("integration_secrets").upsert({ integration_id: integ.id, ciphertext: encrypt(JSON.stringify(merged)), updated_at: new Date().toISOString() });
  return integ.id as string;
}

export interface GoogleIntegration {
  id: string;
  client_id: string;
  gsc_property: string | null;
  ga4_property_id: string | null;
  status: string;
}

export async function getGoogleIntegration(clientId: string): Promise<GoogleIntegration | null> {
  const { data } = await adminClient().from("integrations").select("id, client_id, gsc_property, ga4_property_id, status").eq("client_id", clientId).eq("provider", "google").maybeSingle();
  return (data as GoogleIntegration | null) ?? null;
}

/** Valid access token for a client's Google connection, refreshing when needed. */
export async function accessToken(integrationId: string): Promise<string> {
  const db = adminClient();
  const { data } = await db.from("integration_secrets").select("ciphertext").eq("integration_id", integrationId).single();
  if (!data) throw new GoogleError("Google is not connected");
  const tokens = JSON.parse(decrypt(data.ciphertext as string)) as TokenSet;
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new GoogleError("No refresh token; reconnect Google", 401, true);
  try {
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    const merged = { ...tokens, ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token };
    await db.from("integration_secrets").update({ ciphertext: encrypt(JSON.stringify(merged)), updated_at: new Date().toISOString() }).eq("integration_id", integrationId);
    return merged.access_token;
  } catch (err) {
    if (err instanceof GoogleError && err.revoked) {
      await db.from("integrations").update({ status: "revoked", last_error: err.message }).eq("id", integrationId);
    }
    throw err;
  }
}

async function gfetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new GoogleError(`Google API ${res.status}: ${text.slice(0, 300)}`, res.status);
  return (text ? JSON.parse(text) : {}) as T;
}

// --- Search Console --------------------------------------------------------

export async function listGscProperties(token: string): Promise<string[]> {
  const r = await gfetch<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(token, "https://www.googleapis.com/webmasters/v3/sites");
  return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
}

export interface GscRow {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function gscQuery(token: string, property: string, startDate: string, endDate: string): Promise<GscRow[]> {
  const rows: GscRow[] = [];
  for (let startRow = 0; startRow < 100_000; startRow += 25_000) {
    const r = await gfetch<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(
      token,
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      { method: "POST", body: JSON.stringify({ startDate, endDate, dimensions: ["date", "query", "page"], rowLimit: 25_000, startRow, dataState: "final" }) },
    );
    for (const x of r.rows ?? []) rows.push({ date: x.keys[0]!, query: x.keys[1]!, page: x.keys[2]!, clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position });
    if ((r.rows?.length ?? 0) < 25_000) break;
  }
  return rows;
}

export async function inspectUrl(token: string, property: string, url: string) {
  const r = await gfetch<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string; robotsTxtState?: string; pageFetchState?: string; googleCanonical?: string } } }>(
    token,
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    { method: "POST", body: JSON.stringify({ inspectionUrl: url, siteUrl: property }) },
  );
  return r.inspectionResult?.indexStatusResult ?? null;
}

export async function submitSitemap(token: string, property: string, sitemapUrl: string) {
  await gfetch(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: "PUT" });
}

// --- GA4 -------------------------------------------------------------------

export async function listGa4Properties(token: string): Promise<{ id: string; name: string }[]> {
  const r = await gfetch<{ accountSummaries?: { propertySummaries?: { property: string; displayName: string }[] }[] }>(token, "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
  return (r.accountSummaries ?? []).flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ id: p.property.replace("properties/", ""), name: p.displayName })));
}

export interface Ga4Day {
  date: string;
  sessions: number;
  users: number;
  organic_sessions: number;
  engaged_sessions: number;
  conversions: number;
}

export async function ga4Daily(token: string, propertyId: string, startDate: string, endDate: string): Promise<Ga4Day[]> {
  const r = await gfetch<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] }>(
    token,
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }, { name: "keyEvents" }],
        limit: 10000,
      }),
    },
  );
  const byDate = new Map<string, Ga4Day>();
  for (const row of r.rows ?? []) {
    const raw = row.dimensionValues[0]!.value; // YYYYMMDD
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const channel = row.dimensionValues[1]!.value;
    const [sessions, users, engaged, conv] = row.metricValues.map((m) => Math.round(Number(m.value)));
    const d = byDate.get(date) ?? { date, sessions: 0, users: 0, organic_sessions: 0, engaged_sessions: 0, conversions: 0 };
    d.sessions += sessions ?? 0;
    d.users += users ?? 0;
    d.engaged_sessions += engaged ?? 0;
    d.conversions += conv ?? 0;
    if (channel === "Organic Search") d.organic_sessions += sessions ?? 0;
    byDate.set(date, d);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Pick the Search Console property that matches a site's domain. */
export function matchGscProperty(properties: string[], domain: string): string | null {
  const bare = domain.replace(/^www\./, "");
  return (
    properties.find((p) => p === `sc-domain:${bare}`) ??
    properties.find((p) => p.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") === bare) ??
    null
  );
}
