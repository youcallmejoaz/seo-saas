// Row shapes for the tables in supabase/migrations. Kept by hand (rather than generated)
// so the project builds without a running Supabase instance.

export type ClientStatus = "onboarding" | "active" | "paused" | "offboarded";
export type Risk = "low" | "medium" | "high";

export interface AutonomyPolicy {
  /** Change kinds that may be applied without human approval. */
  auto_apply: ChangeKind[];
  /** Highest risk tier that may be auto-applied. */
  max_auto_risk: Risk | "none";
}

export type ChangeKind =
  | "meta"
  | "alt_text"
  | "internal_links"
  | "schema"
  | "content_update"
  | "content_rewrite"
  | "new_page"
  | "slug_change"
  | "archive_page";

export interface Agency {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface Client {
  id: string;
  agency_id: string;
  name: string;
  industry: string | null;
  primary_location: string | null;
  contact_email: string | null;
  phone: string | null;
  status: ClientStatus;
  autonomy_policy: AutonomyPolicy;
  monthly_ai_budget_usd: number;
  daily_ai_request_cap: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  offboarded_at: string | null;
}

export interface BusinessInfo {
  name: string;
  industry?: string;
  services: string[];
  locations: string[];
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
  usp?: string[];
  tone?: string;
}

export interface Theme {
  primary?: string;
  accent?: string;
  font?: "sans" | "serif";
  logoText?: string;
}

export interface Site {
  id: string;
  client_id: string;
  subdomain: string;
  custom_domain: string | null;
  domain_verified: boolean;
  status: "draft" | "generating" | "published" | "failed" | "archived";
  theme: Theme;
  business: BusinessInfo;
  instructions: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PageType = "home" | "service" | "location" | "service_location" | "blog" | "about" | "contact" | "other";

export interface PageRow {
  id: string;
  site_id: string;
  client_id: string;
  slug: string;
  type: PageType;
  title: string;
  meta_description: string;
  h1: string;
  blocks: unknown[];
  target_keyword: string | null;
  status: "draft" | "published" | "archived";
  noindex: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export type RunKind =
  | "command"
  | "site_generate"
  | "site_edit"
  | "campaign_plan"
  | "task_execute"
  | "task_measure"
  | "audit"
  | "sync"
  | "scan"
  | "report";

export type RunStatus = "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled";

export interface Run {
  id: string;
  agency_id: string;
  client_id: string | null;
  parent_run_id: string | null;
  kind: RunKind;
  prompt: string | null;
  input: Record<string, unknown>;
  status: RunStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunEvent {
  id: number;
  run_id: string;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  type: "step" | "status" | "message" | "tool_call" | "tool_result" | "llm" | "error";
  message: string;
  data: unknown;
}

export type TaskKind =
  | "meta_optimize"
  | "content_expand"
  | "new_service_page"
  | "new_location_page"
  | "new_blog_post"
  | "internal_links"
  | "schema_markup"
  | "alt_text"
  | "technical_fix"
  | "audit"
  | "keyword_research"
  | "competitor_analysis"
  | "other";

export type TaskStatus = "planned" | "running" | "awaiting_approval" | "done" | "failed" | "skipped" | "cancelled";

export interface Task {
  id: string;
  client_id: string;
  campaign_id: string | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  risk: Risk;
  status: TaskStatus;
  priority: number;
  scheduled_for: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  change_set_id: string | null;
  measured_impact: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Campaign {
  id: string;
  client_id: string;
  name: string;
  goal: string;
  target_keywords: string[];
  target_location: string | null;
  status: "planning" | "active" | "paused" | "completed" | "failed";
  plan: Record<string, unknown> | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeSetRow {
  id: string;
  client_id: string;
  site_id: string;
  task_id: string | null;
  run_id: string | null;
  summary: string;
  rationale: string | null;
  risk: Risk;
  status: "proposed" | "approved" | "rejected" | "applied" | "rolled_back" | "failed";
  ops: unknown[];
  before: unknown;
  decided_by: string | null;
  decided_at: string | null;
  applied_at: string | null;
  rolled_back_at: string | null;
  error: string | null;
  created_at: string;
}

export interface Keyword {
  id: string;
  client_id: string;
  keyword: string;
  location: string;
  search_volume: number | null;
  difficulty: number | null;
  intent: string | null;
  source: "gsc" | "ai_estimate" | "dataforseo" | "manual";
  is_estimate: boolean;
  tracked: boolean;
  target_page_id: string | null;
}

export interface Lead {
  id: string;
  client_id: string;
  site_id: string;
  page_path: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string;
  created_at: string;
}
