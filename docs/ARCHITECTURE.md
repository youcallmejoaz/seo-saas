# Architecture

## Goals that shaped the design

- **AI does the work; humans set the limits.** Agents must *execute* (edit sites, create pages), not just suggest. Every change must still be safe, explainable, reversible and scoped by a per-client policy.
- **Hundreds of clients without a large team.** No per-site builds or servers, tenant isolation enforced by the database, background work that is durable and retryable, and AI cost that is metered and capped.
- **Business owners can read it.** Client dashboards use plain language and show only that client's data.

## System overview

```
                 ┌──────────────────────── Next.js app (Vercel) ─────────────────────────┐
 agency staff ──►│ /agency  workspace, command console, approvals, activity             │
 client users ──►│ /portal  client dashboard (RLS-scoped)                               │
 site visitors ─►│ middleware: host → /sites/<host>  multi-tenant site renderer         │
                 │ /api/inngest  durable functions │ /api/leads │ /api/google │ /api/stripe│
                 └───────────────┬─────────────────────────┬──────────────────────────────┘
                                 │                         │
                    Supabase Postgres (RLS)          Inngest (events, crons, retries,
                    Auth · reporting SQL functions   concurrency/throttling)
                                 │                         │
                                 └──────► agents (src/lib/agents) ◄──── LLMProvider
                                                │                        (Gemini today)
                     Google Search Console · GA4 · PageSpeed · DataForSEO (opt.) · Vercel Domains
```

## Key decisions

### 1. Sites are structured data, not generated code

Pages are stored as typed blocks (`src/lib/site/schema.ts`: hero, rich text, services grid, FAQ, areas served, CTA, contact form…), validated with Zod. One Next.js route renders every client site, selected by hostname (`src/middleware.ts`, `src/lib/hosts.ts`).

- **Safety:** the model never writes HTML or JavaScript. Inline links use `[text](/path)` and are rendered as React text, so model output cannot inject markup.
- **Instant, cheap deploys:** an edit is a database write plus cache revalidation. There is no build pipeline per client, and 500 sites cost the same to host as 5.
- **Agents can reason about it:** pages expose slugs, target keywords, block ids and word counts, which makes precise edits ("link X from Y", "add an FAQ to Z") reliable.
- **SEO is built in, not optional:** canonical tags, robots and sitemap, JSON-LD (LocalBusiness, Service, FAQPage, BreadcrumbList), one H1 per page, mobile-first layout, and 301s on slug changes.

*Trade-off:* the design vocabulary is bounded by the block library. Extending it means adding a block type and a renderer component, which is deliberate: every new capability is reviewed once instead of generated thousands of times.

### 2. Every edit is a change set, applied under a policy

Agents (and humans using natural language) submit **ops** (`src/lib/site/changes.ts`): `set_meta`, `add_internal_link`, `update_block`, `create_page`, `change_slug`, … Each op is:

1. **Validated:** a dry run against the live site. Change sets are all-or-nothing, and the resulting pages must still pass the page schema.
2. **Classified** by kind and risk: meta, alt text and links are low; content and new drafts are medium; publishing, slug changes and noindex are high.
3. **Decided** by the client's **autonomy policy** (`src/lib/agents/policy.ts`): auto-apply, require approval, or blocked (client paused or offboarded).
4. **Applied atomically** in Postgres (`apply_change_set`). It snapshots `page_versions`, checks versions optimistically, writes redirects, and stores the `before` state so **rollback** is one click (`rollback_change_set`).

This is what lets the AI *execute* without being dangerous.

### 3. Agents: small, tool-using, logged

`src/lib/ai/index.ts` provides three primitives on top of a provider-neutral `LLMProvider`:

- `generateJson`: structured output with Zod validation and one automatic repair attempt.
- `generateText`: optionally grounded in Google Search.
- `runAgent`: a tool-calling loop. Arguments are Zod-validated before any tool runs, tool errors go back to the model, a step cap applies, and every call and result is written to `run_events`.

The agents themselves:

| Agent | File | Model tier | Tools / outputs |
|---|---|---|---|
| Site builder | `site-builder.ts` | planner (plan) + fast (pages) | sitemap plan → per-page blocks → deterministic linking → meta repair |
| Site editor | `site-editor.ts` | planner | list/get pages, lint, `propose_changes` |
| Campaign planner | `seo-planner.ts` | planner | keyword research, competitor analysis, GSC, audit → task plan |
| Task executor | `seo-executor.ts` | fast / planner | site tools + page search performance, keyword data, competitors |
| Orchestrator | `orchestrator.ts` | planner | list/compare clients, metrics, create client+site, edit, campaign, audit, fix issues, scan, approvals |
| Reports | `reports.ts` | fast | plain-English monthly summary from real numbers |

**Deterministic where possible.** Opportunity detection (low CTR for a position, striking-distance queries, coverage gaps, orphans), internal-link structure, SEO lint, technical checks and impact measurement are plain code. They are cheaper, testable and never hallucinate. The model is used where judgement and writing are needed.

**Why not LangGraph or a framework?** The workflows are short tool loops inside durable steps. Inngest already provides state, retries, scheduling and human-in-the-loop, and a ~150-line loop keeps full control over approvals, logging and cost. A framework can be added later if multi-agent graphs become necessary.

### 4. Gemini today, swappable tomorrow

`src/lib/ai/gemini.ts` implements the provider with `@google/genai`:

- structured output (`responseJsonSchema`, sanitised by `json-schema.ts` to Gemini's supported subset)
- function calling (thought signatures preserved across turns)
- Google Search grounding for competitor and keyword discovery
- retries with exponential backoff on 429 and 5xx (honouring the server's `retryDelay`)

The two model tiers come from env vars. Moving to Claude or another model means implementing `LLMProvider` (`generate`, `conversation`); no agent code changes. Mock mode (`AI_MOCK=1`) gives deterministic, schema-valid output for CI, demos and offline development.

### 5. Durable background work (Inngest)

Every long or scheduled operation is an Inngest function (`src/inngest/functions`):

- **Memoised steps:** each page of a site generation is its own retryable step, so a failure on page 14 doesn't redo pages 1–13.
- **Concurrency:** one task at a time per client (keeps edits sequential), one generation per site, and a global cap on AI-heavy jobs to stay inside provider rate limits.
- **Approvals are events** (`change/decided`), not sleeping functions, so the queue scales and stale proposals expire on a cron.
- **Failure handling:** budget overruns are non-retriable. Other failures retry, then surface in **Failures** with a manual retry.

### 6. Multi-tenancy and security

- **Postgres RLS on every table** (`supabase/migrations/*_rls.sql`), using helpers `is_agency_member`, `is_client_staff` and `can_access_client`.
  - Portal users see only their own client and never see change sets, runs, AI costs or integrations.
  - Reporting SQL functions run as `SECURITY INVOKER`, so aggregates obey the same rules.
  - Tests in `tests/db/rls.test.ts`.
- **Service role only in server code** (`adminClient()`), always with explicit tenant filters. The public renderer uses the anon key, which can read only published sites and pages, and only public columns.
- **OAuth tokens** are encrypted with AES-256-GCM in `integration_secrets`, a table with RLS and no policies, so only the service role can read it. OAuth `state` is HMAC-signed and bound to the user.
- **AI cost controls:** usage is metered per call in `ai_usage`. Per-client monthly budget and daily request cap are checked **before** every model call, and a step cap applies per agent run.
- **Prompt-injection posture:** model output only reaches the world through validated ops under policy. Crawled competitor pages and Search Console data are treated as data, and tools are scoped to the run's agency.

## Data model (abridged)

`agencies` → `memberships` (staff) · `clients` → `client_users` (portal) · `subscriptions`
`sites` → `pages` → `page_versions` · `redirects` · `leads`
`campaigns` → `tasks` → `change_sets` · `runs` → `run_events` · `ai_usage`
`keywords` → `rank_snapshots` · `gsc_daily` · `ga4_daily` · `audits` → `audit_issues` · `competitors` · `reports`
`integrations` → `integration_secrets`

## What is real vs. stubbed

| Area | Status |
|---|---|
| Site generation, rendering, editing, approvals, rollback, leads | Real; covered by e2e tests |
| Gemini provider | Real; verify with `pnpm ai:check` and your key. Tests use mocks. |
| Search Console, GA4, URL Inspection, PageSpeed, sitemap submission | Implemented against the REST APIs; needs your OAuth client to exercise |
| Keyword volumes | Search Console data plus AI estimates, **labelled as estimates**. Real volumes and SERP ranks need DataForSEO. |
| Custom domains | Vercel Domains API when configured; otherwise DNS instructions for manual setup |
| Billing | Subscription status sync via Stripe webhook; checkout and invoicing are not built |

## Scaling notes

- **Rendering:** cached per site with tag invalidation on every change; works on Vercel's edge/CDN. Wildcard DNS means no per-client infrastructure.
- **Database:**
  - Search Console data is the big table (date × query × page). It is indexed by client and date, and dashboards use SQL aggregates rather than shipping rows.
  - Past roughly 10M rows, partition `gsc_daily` by month and add rollup tables.
- **Jobs:** crons fan out per client as events, and Inngest concurrency keys keep per-client work serial while clients run in parallel.
- **AI throughput:** the free tier is the bottleneck (single-digit requests per minute). With a paid key, raise `LLM_CONCURRENCY` in `src/inngest/functions/shared.ts` and set `AI_PRICES_JSON` so budgets are enforced in dollars.

## Roadmap (suggested next phases)

1. **Production hardening:**
   - Sentry and structured logs
   - per-agency rate limits on lead forms
   - email notifications for approvals and failures
   - audit trail for staff actions
2. **Content depth:**
   - image generation or stock integration with alt text
   - blog and content calendar
   - more block types (pricing, galleries, team)
   - theme presets per industry
3. **SEO intelligence:**
   - Google Business Profile management
   - backlink monitoring
   - local rank grids
   - experiment tracking (A/B titles), feeding results back into the planner
4. **Commercial:**
   - Stripe checkout and plans
   - white-label portal (agency branding and domain)
   - client approval of changes from the portal
5. **Evaluation:** a fixed eval set of business briefs and SEO tasks to compare models and prompts, measure quality per dollar, and catch regressions before switching providers.
