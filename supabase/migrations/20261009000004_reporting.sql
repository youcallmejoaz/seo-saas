-- Reporting aggregates. SECURITY INVOKER (the default), so RLS on the underlying tables
-- still decides what the caller can see: client users only ever aggregate their own data.

create or replace function public.client_gsc_daily(p_client uuid, p_from date, p_to date)
returns table (date date, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
language sql stable as $$
  select g.date, sum(g.clicks), sum(g.impressions),
         case when sum(g.impressions) > 0 then round(sum(g.clicks)::numeric / sum(g.impressions), 4) else 0 end,
         case when sum(g.impressions) > 0 then round(sum(g.position * g.impressions) / sum(g.impressions), 2) else null end
  from public.gsc_daily g
  where g.client_id = p_client and g.date between p_from and p_to
  group by g.date order by g.date;
$$;

create or replace function public.client_top_queries(p_client uuid, p_from date, p_to date, p_limit int default 20)
returns table (query text, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
language sql stable as $$
  select g.query, sum(g.clicks), sum(g.impressions),
         case when sum(g.impressions) > 0 then round(sum(g.clicks)::numeric / sum(g.impressions), 4) else 0 end,
         round(sum(g.position * g.impressions) / nullif(sum(g.impressions), 0), 2)
  from public.gsc_daily g
  where g.client_id = p_client and g.date between p_from and p_to
  group by g.query order by sum(g.clicks) desc, sum(g.impressions) desc limit p_limit;
$$;

create or replace function public.client_top_pages(p_client uuid, p_from date, p_to date, p_limit int default 20)
returns table (page text, clicks bigint, impressions bigint, ctr numeric, avg_position numeric)
language sql stable as $$
  select g.page, sum(g.clicks), sum(g.impressions),
         case when sum(g.impressions) > 0 then round(sum(g.clicks)::numeric / sum(g.impressions), 4) else 0 end,
         round(sum(g.position * g.impressions) / nullif(sum(g.impressions), 0), 2)
  from public.gsc_daily g
  where g.client_id = p_client and g.date between p_from and p_to
  group by g.page order by sum(g.clicks) desc, sum(g.impressions) desc limit p_limit;
$$;

-- Latest position per tracked keyword vs. the latest position at least p_days ago.
create or replace function public.client_rank_movements(p_client uuid, p_days int default 28)
returns table (keyword_id uuid, keyword text, location text, search_volume int, is_estimate boolean,
               current_position numeric, previous_position numeric, change numeric, url text)
language sql stable as $$
  select k.id, k.keyword, k.location, k.search_volume, k.is_estimate,
         cur.position, prev.position,
         case when cur.position is not null and prev.position is not null then prev.position - cur.position end,
         cur.url
  from public.keywords k
  left join lateral (
    select r.position, r.url from public.rank_snapshots r
    where r.keyword_id = k.id order by r.date desc limit 1) cur on true
  left join lateral (
    select r.position from public.rank_snapshots r
    where r.keyword_id = k.id and r.date <= current_date - p_days order by r.date desc limit 1) prev on true
  where k.client_id = p_client and k.tracked
  order by cur.position nulls last;
$$;

-- One row per client for the agency portfolio view.
create or replace function public.agency_portfolio(p_agency uuid, p_days int default 28)
returns table (
  client_id uuid, name text, status text, site_status text, subdomain text,
  clicks bigint, clicks_prev bigint, impressions bigint, impressions_prev bigint,
  leads bigint, leads_prev bigint, tasks_done bigint, pending_approvals bigint, failed_tasks bigint,
  ai_cost_month numeric, subscription_status text, mrr_cents int)
language sql stable as $$
  select c.id, c.name, c.status, s.status, s.subdomain,
    coalesce((select sum(g.clicks) from public.gsc_daily g where g.client_id = c.id and g.date > current_date - p_days), 0),
    coalesce((select sum(g.clicks) from public.gsc_daily g where g.client_id = c.id and g.date > current_date - 2 * p_days and g.date <= current_date - p_days), 0),
    coalesce((select sum(g.impressions) from public.gsc_daily g where g.client_id = c.id and g.date > current_date - p_days), 0),
    coalesce((select sum(g.impressions) from public.gsc_daily g where g.client_id = c.id and g.date > current_date - 2 * p_days and g.date <= current_date - p_days), 0),
    (select count(*) from public.leads l where l.client_id = c.id and l.created_at > now() - make_interval(days => p_days)),
    (select count(*) from public.leads l where l.client_id = c.id and l.created_at > now() - make_interval(days => 2 * p_days) and l.created_at <= now() - make_interval(days => p_days)),
    (select count(*) from public.tasks t where t.client_id = c.id and t.status = 'done' and t.completed_at > now() - make_interval(days => p_days)),
    (select count(*) from public.change_sets cs where cs.client_id = c.id and cs.status = 'proposed'),
    (select count(*) from public.tasks t where t.client_id = c.id and t.status = 'failed'),
    coalesce((select sum(u.cost_usd) from public.ai_usage u where u.client_id = c.id and u.created_at >= date_trunc('month', now())), 0),
    sub.status, coalesce(sub.mrr_cents, 0)
  from public.clients c
  left join lateral (select * from public.sites s where s.client_id = c.id and s.status <> 'archived' order by s.created_at limit 1) s on true
  left join public.subscriptions sub on sub.client_id = c.id
  where c.agency_id = p_agency
  order by c.status = 'offboarded', c.name;
$$;

create or replace function public.agency_usage_daily(p_agency uuid, p_days int default 30)
returns table (day date, requests bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql stable as $$
  select date_trunc('day', u.created_at)::date, sum(u.requests), sum(u.input_tokens), sum(u.output_tokens), sum(u.cost_usd)
  from public.ai_usage u
  where u.agency_id = p_agency and u.created_at > now() - make_interval(days => p_days)
  group by 1 order by 1;
$$;

grant execute on function public.client_gsc_daily(uuid, date, date), public.client_top_queries(uuid, date, date, int),
  public.client_top_pages(uuid, date, date, int), public.client_rank_movements(uuid, int),
  public.agency_portfolio(uuid, int), public.agency_usage_daily(uuid, int) to authenticated, service_role;
