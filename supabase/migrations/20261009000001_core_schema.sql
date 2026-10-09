-- Core schema for the AI website + SEO platform.
-- Tenancy: agencies -> clients -> sites/pages. Agency staff hold `memberships`;
-- client users hold `client_users` rows bound to exactly one client.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null,
  industry text,
  primary_location text,
  contact_email text,
  phone text,
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'paused', 'offboarded')),
  -- Which change kinds the AI may apply without a human. See src/lib/agents/policy.ts.
  autonomy_policy jsonb not null default '{"auto_apply": ["meta", "alt_text", "internal_links", "schema"], "max_auto_risk": "low"}'::jsonb,
  monthly_ai_budget_usd numeric(10, 2) not null default 25,
  daily_ai_request_cap integer not null default 200,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  offboarded_at timestamptz
);
create index clients_agency_idx on public.clients (agency_id);

create table public.client_users (
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index client_users_user_idx on public.client_users (user_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan text not null default 'standard',
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'none')),
  mrr_cents integer not null default 0,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sites & pages (structured content rendered by src/app/sites)
-- ---------------------------------------------------------------------------

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  subdomain text not null unique check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  custom_domain text unique,
  domain_verified boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'generating', 'published', 'failed', 'archived')),
  theme jsonb not null default '{}'::jsonb,
  business jsonb not null default '{}'::jsonb,
  instructions text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sites_client_idx on public.sites (client_id);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  slug text not null default '' check (slug ~ '^([a-z0-9]+(-[a-z0-9]+)*)(/[a-z0-9]+(-[a-z0-9]+)*)*$' or slug = ''),
  type text not null default 'service'
    check (type in ('home', 'service', 'location', 'service_location', 'blog', 'about', 'contact', 'other')),
  title text not null,
  meta_description text not null default '',
  h1 text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  target_keyword text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  noindex boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug)
);
create index pages_client_idx on public.pages (client_id);

-- 301s created when the AI (or a human) changes a page slug.
create table public.redirects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  from_path text not null,
  to_path text not null,
  created_at timestamptz not null default now(),
  unique (site_id, from_path)
);

-- ---------------------------------------------------------------------------
-- Agent operations
-- ---------------------------------------------------------------------------

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  parent_run_id uuid references public.runs (id) on delete set null,
  kind text not null check (kind in (
    'command', 'site_generate', 'site_edit', 'campaign_plan', 'task_execute',
    'task_measure', 'audit', 'sync', 'scan', 'report')),
  prompt text,
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
  output jsonb,
  error text,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index runs_agency_created_idx on public.runs (agency_id, created_at desc);
create index runs_client_idx on public.runs (client_id, created_at desc);
create index runs_status_idx on public.runs (status) where status in ('failed', 'awaiting_approval', 'running');

create table public.run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  ts timestamptz not null default now(),
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  type text not null default 'step'
    check (type in ('step', 'status', 'message', 'tool_call', 'tool_result', 'llm', 'error')),
  message text not null,
  data jsonb
);
create index run_events_run_idx on public.run_events (run_id, id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  goal text not null,
  target_keywords text[] not null default '{}',
  target_location text,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'paused', 'completed', 'failed')),
  plan jsonb,
  run_id uuid references public.runs (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_client_idx on public.campaigns (client_id);

create table public.change_sets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  task_id uuid,
  run_id uuid references public.runs (id) on delete set null,
  summary text not null,
  rationale text,
  risk text not null check (risk in ('low', 'medium', 'high')),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'applied', 'rolled_back', 'failed')),
  ops jsonb not null,
  before jsonb,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index change_sets_client_idx on public.change_sets (client_id, created_at desc);
create index change_sets_pending_idx on public.change_sets (status) where status = 'proposed';

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  kind text not null check (kind in (
    'meta_optimize', 'content_expand', 'new_service_page', 'new_location_page', 'new_blog_post',
    'internal_links', 'schema_markup', 'alt_text', 'technical_fix', 'audit', 'keyword_research',
    'competitor_analysis', 'other')),
  title text not null,
  description text,
  risk text not null default 'low' check (risk in ('low', 'medium', 'high')),
  status text not null default 'planned'
    check (status in ('planned', 'running', 'awaiting_approval', 'done', 'failed', 'skipped', 'cancelled')),
  priority integer not null default 50,
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  change_set_id uuid references public.change_sets (id) on delete set null,
  measured_impact jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index tasks_client_status_idx on public.tasks (client_id, status, scheduled_for);
alter table public.change_sets
  add constraint change_sets_task_fk foreign key (task_id) references public.tasks (id) on delete set null;

create table public.page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  change_set_id uuid references public.change_sets (id) on delete set null,
  created_at timestamptz not null default now()
);
create index page_versions_page_idx on public.page_versions (page_id, version desc);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  provider text not null,
  model text not null,
  purpose text not null,
  requests integer not null default 1,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_client_created_idx on public.ai_usage (client_id, created_at);
create index ai_usage_agency_created_idx on public.ai_usage (agency_id, created_at);

-- ---------------------------------------------------------------------------
-- SEO data
-- ---------------------------------------------------------------------------

create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  keyword text not null,
  location text not null default '',
  search_volume integer,
  difficulty integer check (difficulty between 0 and 100),
  intent text check (intent in ('informational', 'commercial', 'transactional', 'navigational', 'local')),
  source text not null default 'ai_estimate' check (source in ('gsc', 'ai_estimate', 'dataforseo', 'manual')),
  is_estimate boolean not null default true,
  tracked boolean not null default false,
  target_page_id uuid references public.pages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (client_id, keyword, location)
);

create table public.rank_snapshots (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  date date not null,
  position numeric(6, 2),
  url text,
  source text not null default 'gsc' check (source in ('gsc', 'dataforseo')),
  unique (keyword_id, date, source)
);
create index rank_snapshots_client_date_idx on public.rank_snapshots (client_id, date);

create table public.gsc_daily (
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  query text not null,
  page text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric(8, 6) not null default 0,
  position numeric(6, 2) not null default 0,
  primary key (client_id, date, query, page)
);

create table public.ga4_daily (
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  sessions integer not null default 0,
  users integer not null default 0,
  organic_sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  conversions integer not null default 0,
  primary key (client_id, date)
);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  run_id uuid references public.runs (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  score integer,
  pages_crawled integer not null default 0,
  summary jsonb,
  pagespeed jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index audits_client_idx on public.audits (client_id, started_at desc);

create table public.audit_issues (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  page_url text not null,
  page_id uuid references public.pages (id) on delete set null,
  check_id text not null,
  severity text not null check (severity in ('critical', 'warning', 'notice')),
  message text not null,
  details jsonb,
  auto_fixable boolean not null default false,
  resolved_at timestamptz
);
create index audit_issues_audit_idx on public.audit_issues (audit_id);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  keyword text not null,
  url text not null,
  domain text not null,
  position integer,
  analysis jsonb,
  found_at timestamptz not null default now()
);
create index competitors_client_idx on public.competitors (client_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  page_path text,
  name text,
  email text,
  phone text,
  message text,
  source text not null default 'organic',
  meta jsonb,
  created_at timestamptz not null default now()
);
create index leads_client_created_idx on public.leads (client_id, created_at desc);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  provider text not null check (provider in ('google')),
  account_email text,
  scopes text[] not null default '{}',
  gsc_property text,
  ga4_property_id text,
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  last_error text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (client_id, provider)
);

-- Encrypted OAuth tokens. RLS enabled with NO policies: only the service role can read it.
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary_md text not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, period_start)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger sites_touch before update on public.sites
  for each row execute function public.touch_updated_at();
create trigger pages_touch before update on public.pages
  for each row execute function public.touch_updated_at();
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
