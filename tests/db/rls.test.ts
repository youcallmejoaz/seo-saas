import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// Row-level security tests. Runs against the local Supabase database (`supabase start`)
// or the plain-Postgres stand-in from `pnpm db:local` (set DATABASE_URL accordingly).
// Every test runs inside a transaction that is rolled back.

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

const ids = {
  agency1: randomUUID(),
  agency2: randomUUID(),
  staff1: randomUUID(),
  staff2: randomUUID(),
  portalA: randomUUID(),
  clientA: randomUUID(),
  clientB: randomUUID(),
  clientC: randomUUID(), // agency 2
  siteA: randomUUID(),
  siteB: randomUUID(),
};

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

async function inTx(fn: (q: Q, as: (role: "anon" | "authenticated", userId?: string) => Promise<void>) => Promise<void>) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await seed(c.query.bind(c) as Q);
    const as = async (role: "anon" | "authenticated", userId?: string) => {
      await c.query("reset role");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role } : { role })]);
      await c.query(`set local role ${role}`);
    };
    await fn(c.query.bind(c) as Q, as);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

async function seed(q: Q) {
  for (const u of [ids.staff1, ids.staff2, ids.portalA]) await q(`insert into auth.users (id, email) values ($1, $2)`, [u, `${u}@t.test`]);
  await q(`insert into agencies (id, name, slug) values ($1,'A1',$3), ($2,'A2',$4)`, [ids.agency1, ids.agency2, `a1-${ids.agency1}`, `a2-${ids.agency2}`]);
  await q(`insert into memberships (agency_id, user_id, role) values ($1,$2,'owner'), ($3,$4,'owner')`, [ids.agency1, ids.staff1, ids.agency2, ids.staff2]);
  await q(`insert into clients (id, agency_id, name, status) values ($1,$4,'A','active'), ($2,$4,'B','active'), ($3,$5,'C','active')`, [ids.clientA, ids.clientB, ids.clientC, ids.agency1, ids.agency2]);
  await q(`insert into client_users (client_id, user_id) values ($1,$2)`, [ids.clientA, ids.portalA]);
  await q(`insert into sites (id, client_id, subdomain, status, instructions) values ($1,$3,$4,'published','secret notes'), ($2,$5,$6,'draft',null)`, [ids.siteA, ids.siteB, ids.clientA, `a-${ids.siteA.slice(0, 8)}`, ids.clientB, `b-${ids.siteB.slice(0, 8)}`]);
  await q(`insert into pages (site_id, client_id, slug, type, title, status) values ($1,$2,'','home','Home A','published'), ($1,$2,'draft-page','service','Draft A','draft'), ($3,$4,'','home','Home B','published')`, [ids.siteA, ids.clientA, ids.siteB, ids.clientB]);
  await q(`insert into gsc_daily (client_id, date, query, page, clicks, impressions, position) values ($1, current_date, 'q a', '/', 5, 50, 3), ($2, current_date, 'q b', '/', 7, 70, 4)`, [ids.clientA, ids.clientB]);
  await q(`insert into leads (client_id, site_id, name) values ($1,$2,'lead a')`, [ids.clientA, ids.siteA]);
  const run = await q(`insert into runs (agency_id, client_id, kind) values ($1,$2,'audit') returning id`, [ids.agency1, ids.clientA]);
  await q(`insert into ai_usage (agency_id, client_id, run_id, provider, model, purpose, cost_usd) values ($1,$2,$3,'gemini','m','t',0.5)`, [ids.agency1, ids.clientA, run.rows[0].id]);
  await q(`insert into change_sets (client_id, site_id, summary, risk, ops) values ($1,$2,'x','low','[]')`, [ids.clientA, ids.siteA]);
  const integ = await q(`insert into integrations (client_id, provider) values ($1,'google') returning id`, [ids.clientA]);
  await q(`insert into integration_secrets (integration_id, ciphertext) values ($1,'v1.secret')`, [integ.rows[0].id]);
}

/** Expect a statement to fail without poisoning the surrounding transaction. */
async function rejects(q: Q, sql: string, params: unknown[], pattern: RegExp) {
  await q("savepoint expect_fail");
  await expect(q(sql, params)).rejects.toThrow(pattern);
  await q("rollback to savepoint expect_fail");
}

const count = async (q: Q, sql: string, params: unknown[] = []) => Number((await q(`select count(*)::int as n from (${sql}) s`, params)).rows[0].n);

beforeAll(async () => {
  await pool.query("select 1");
});
afterAll(async () => {
  await pool.end();
});

describe("tenant isolation", () => {
  it("agency staff only see their own agency's clients and data", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.staff1);
      expect(await count(q, `select id from clients where id = any($1)`, [[ids.clientA, ids.clientB, ids.clientC]])).toBe(2);
      expect(await count(q, `select 1 from gsc_daily where client_id = any($1)`, [[ids.clientA, ids.clientB]])).toBe(2);
      await as("authenticated", ids.staff2);
      expect(await count(q, `select id from clients where id = any($1)`, [[ids.clientA, ids.clientB, ids.clientC]])).toBe(1);
      expect(await count(q, `select 1 from pages where client_id = any($1)`, [[ids.clientA, ids.clientB]])).toBe(0);
      expect(await count(q, `select 1 from runs where agency_id = $1`, [ids.agency1])).toBe(0);
    }));

  it("portal users see only their own client, and no operational internals", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.portalA);
      expect(await count(q, `select id from clients where id = any($1)`, [[ids.clientA, ids.clientB, ids.clientC]])).toBe(1);
      expect(await count(q, `select 1 from gsc_daily where client_id = any($1)`, [[ids.clientA, ids.clientB]])).toBe(1);
      expect(await count(q, `select 1 from leads where client_id = $1`, [ids.clientA])).toBe(1);
      expect(await count(q, `select 1 from pages where client_id = $1`, [ids.clientB])).toBe(0);
      // Staff-only tables
      expect(await count(q, `select 1 from change_sets`)).toBe(0);
      expect(await count(q, `select 1 from ai_usage`)).toBe(0);
      expect(await count(q, `select 1 from runs`)).toBe(0);
      expect(await count(q, `select 1 from integrations`)).toBe(0);
      // Reporting functions respect RLS too.
      expect((await q(`select * from client_gsc_daily($1, current_date - 1, current_date)`, [ids.clientB])).rowCount).toBe(0);
      expect((await q(`select * from client_gsc_daily($1, current_date - 1, current_date)`, [ids.clientA])).rowCount).toBe(1);
    }));

  it("portal users cannot write", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.portalA);
      const upd = await q(`update pages set title = 'hacked' where client_id = $1`, [ids.clientA]);
      expect(upd.rowCount).toBe(0);
      await rejects(q, `insert into tasks (client_id, kind, title) values ($1, 'other', 'x')`, [ids.clientA], /row-level security/);
    }));

  it("offboarding a client revokes portal access", () =>
    inTx(async (q, as) => {
      await q(`update clients set status = 'offboarded' where id = $1`, [ids.clientA]);
      await as("authenticated", ids.portalA);
      expect(await count(q, `select id from clients where id = $1`, [ids.clientA])).toBe(0);
      expect(await count(q, `select 1 from gsc_daily where client_id = $1`, [ids.clientA])).toBe(0);
    }));

  it("staff can create a client and read it back in the same statement", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.staff1);
      const r = await q(`insert into clients (agency_id, name) values ($1, 'New') returning id`, [ids.agency1]);
      expect(r.rowCount).toBe(1);
      await rejects(q, `insert into clients (agency_id, name) values ($1, 'Sneaky') returning id`, [ids.agency2], /row-level security/);
    }));

  it("staff cannot move a client into another agency", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.staff1);
      await rejects(q, `update clients set agency_id = $1 where id = $2`, [ids.agency2, ids.clientA], /row-level security/);
    }));
});

describe("secrets and privileged functions", () => {
  it("encrypted tokens are invisible to every signed-in user", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.staff1);
      expect(await count(q, `select 1 from integration_secrets`)).toBe(0);
    }));

  it("change-set and usage functions are service-role only", () =>
    inTx(async (q, as) => {
      await as("authenticated", ids.staff1);
      await rejects(q, `select apply_change_set(gen_random_uuid(), '[]', '[]', '[]', '{}')`, [], /permission denied/);
      await rejects(q, `select increment_run_usage(gen_random_uuid(), 1, 1, 0)`, [], /permission denied/);
    }));
});

describe("public site access", () => {
  it("anonymous visitors see only published sites and pages, without internal columns", () =>
    inTx(async (q, as) => {
      await as("anon");
      expect(await count(q, `select id from sites where id = any($1)`, [[ids.siteA, ids.siteB]])).toBe(1);
      expect(await count(q, `select id from pages where site_id = $1`, [ids.siteA])).toBe(1);
      expect(await count(q, `select id from pages where site_id = $1`, [ids.siteB])).toBe(0);
      await rejects(q, `select instructions from sites`, [], /permission denied/);
      expect(await count(q, `select 1 from clients`)).toBe(0);
      expect(await count(q, `select 1 from leads`)).toBe(0);
    }));
});
