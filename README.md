# RankPilot: AI website generator + autonomous SEO platform

A multi-tenant SaaS for agencies:

1. **Onboard** a client with a few facts (name, services, locations).
2. **Generate** a complete, SEO-structured website with AI: service pages, location pages, internal linking, schema.org data and lead forms. Deploy it instantly on a subdomain or a custom domain.
3. **Run SEO autonomously.** AI agents research keywords and competitors, plan campaigns, edit the site and measure the results. Low-risk changes apply automatically; anything bigger waits in an approval queue.
4. **Report.** Each client gets a private dashboard (traffic, rankings, enquiries, work done, monthly summaries).
5. **Control everything in plain English** from one agency workspace, e.g. *"Improve Brum Plumbing's rankings for boiler repair in Solihull"* or *"Which clients improved this month?"*

Stack: **Next.js 15 · Supabase (Postgres + Auth + RLS) · Google Gemini (behind a swappable provider) · Inngest (durable jobs) · Tailwind**.

![RankPilot walkthrough: onboard a client, AI builds the site, publish, approve an AI change, ask the AI](portfolio/video/rankpilot-demo-720.gif)

More screenshots and an MP4 version are in [`portfolio/`](portfolio/README.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design, trade-offs, scaling notes and roadmap.

---

## Quick start (local, about 10 minutes)

Requirements: Node 22, pnpm 10, Docker (for local Supabase).

```bash
pnpm install
pnpm supabase start                 # local Postgres + Auth + REST; prints keys
cp .env.example .env.local          # paste the anon + service_role keys it printed
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.local
pnpm seed                           # demo agency, 2 clients, generated sites, 90 days of data
pnpm dev                            # http://localhost:3000
pnpm inngest:dev                    # second terminal: background job runner (http://localhost:8288)
```

Sign in at http://localhost:3000/login:

| Who | Email | Password |
|---|---|---|
| Agency owner | `owner@demo.test` | `demo-password-123` |
| Agency staff (member) | `staff@demo.test` | `demo-password-123` |
| Client portal | `client@brumplumbing.test` | `demo-password-123` |

Generated sites: http://brum-plumbing-co.localhost:3000 (or `/sites/sub~brum-plumbing-co`).

> If Docker image pulls from `public.ecr.aws` are blocked on your network, run
> `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io pnpm supabase start`.

### Using Gemini for real

Without `GEMINI_API_KEY` (or with `AI_MOCK=1`) every AI call returns deterministic mock output, so the whole product works offline and costs nothing. To use the real model:

1. Get a free key at https://aistudio.google.com/apikey.
2. Put it in `.env.local` as `GEMINI_API_KEY=...` and set `AI_MOCK=0`. In a hosted environment, use its secrets manager rather than a file.
3. Run `pnpm ai:check`. It lists the models your key can use, confirms `LLM_MODEL_PLANNER` and `LLM_MODEL_FAST` exist, and makes one tiny structured-output call. It never prints the key.

Free-tier keys have low per-minute limits. The platform throttles concurrent AI jobs, retries rate-limit (429) errors with backoff, and enforces a per-client daily request cap.

### Connecting Google Search Console + GA4

Create an OAuth client ("Web application") in Google Cloud. Enable the *Search Console API*, *Google Analytics Data API* and *Google Analytics Admin API*. Then:

1. Add the redirect URI `<NEXT_PUBLIC_APP_URL>/api/google/oauth/callback`.
2. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. In the app: **Client → Settings → Connect Google**.

The matching Search Console property is picked automatically when possible. Data syncs daily, or on demand with **Sync now**.

---

## Using the platform

| Where | What |
|---|---|
| **Overview** | Portfolio KPIs, biggest movers, items that need you, recent AI activity |
| **AI command** | Natural-language control across one or all clients; every step is logged |
| **Clients → Onboard** | Creates the client and generates their website in the background |
| **Client → Website** | Preview, publish, edit with AI, connect a domain, change history with rollback |
| **Client → SEO campaign** | Start a goal-driven campaign; see the plan, tasks, status and measured impact |
| **Client → Keywords / Audits / Leads** | Rankings, research (estimates labelled), competitors, technical audits, enquiries |
| **Client → Settings** | AI autonomy policy, AI budget and caps, Google connection, portal users, pause/offboard |
| **Approvals** | Changes above a client's auto-apply policy, with diff-level detail |
| **Activity / Failures / AI usage** | Full run history, failed work with retry, token and cost tracking |
| **Client portal** (`/portal`) | The client's own traffic, rankings, enquiries, completed and upcoming work, monthly summaries |

### What runs automatically (Inngest)

| Schedule | Job |
|---|---|
| Every 30 min | Dispatch due SEO tasks |
| Daily 05:15 | Sync Search Console + GA4 and derive keyword rank snapshots |
| Daily 02:30 | Expire proposals left unreviewed for 14 days |
| Mon 03:00 | Technical audit for every active client; DataForSEO SERP checks if configured |
| Tue 07:00 | Opportunity scan, which queues improvement tasks |
| 1st of month | AI-written monthly client report |
| +14 / +28 days after each applied change | Impact measurement against Search Console |

Paused and offboarded clients are skipped everywhere.

---

## Scripts

| Command | |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm inngest:dev` | Local Inngest dev server (job runner + UI on :8288) |
| `pnpm seed` | (Re)create the demo agency and data |
| `pnpm ai:check` | Verify the Gemini key, model names and structured output |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm test` | Unit tests (mock AI, no services needed) |
| `pnpm test:db` | Row-level-security tests (`DATABASE_URL`, defaults to local Supabase) |
| `pnpm db:local` | Plain Postgres 16 stand-in for `test:db` when Docker isn't available |
| `pnpm e2e` | Playwright smoke test (needs local Supabase, `pnpm dev`, `pnpm inngest:dev`; reseeds first) |

## Testing

- **Unit** (`tests/unit`): change engine (apply, validation, redirects), autonomy policy, SEO lint, opportunity scanner, impact measurement, Gemini schema conversion, encryption, host routing, cost metering, crawler checks, the agent loop (against a fake provider), and the full site generator in mock mode.
- **Database** (`tests/db/rls.test.ts`): tenant isolation between agencies; portal users limited to their own client; internals hidden from clients; offboarding revokes access; secrets and privileged functions locked down; anonymous visitors see only published content.
- **End to end** (`e2e/smoke.spec.ts`): public site and SEO essentials, real subdomain routing, lead capture, approving a change, onboarding through to publish, a campaign that auto-applies low-risk work, natural-language commands, and portal isolation.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, RLS tests against Postgres, and a production build.

## Deploying

1. **Supabase project:** run `pnpm supabase link` then `pnpm supabase db push` to apply the migrations.
2. **Vercel project**, with all env vars set:
   - Point `app.<domain>` at the project.
   - Add a wildcard domain `*.<sites-domain>` and set `ROOT_DOMAIN=<sites-domain>`.
   - Client custom domains are added through the Vercel API (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`).
3. **Inngest Cloud:** connect the Vercel integration, or set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`. Functions are served from `/api/inngest`.
4. **Google OAuth:** add the production redirect URI.
5. **Stripe (optional):** point a webhook at `/api/stripe/webhook` and put `client_id` in subscription metadata.
