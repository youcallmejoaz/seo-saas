-- Row-level security. Every tenant table is gated by these helpers:
--   is_agency_member(agency)   -> caller is staff of that agency
--   is_client_staff(client)    -> caller is staff of the agency owning the client
--   can_access_client(client)  -> staff OR a portal user bound to that client
-- Background jobs use the service role, which bypasses RLS.

create or replace function public.is_agency_member(p_agency uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.agency_id = p_agency and m.user_id = auth.uid()
  );
$$;

create or replace function public.agency_role(p_agency uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
  where m.agency_id = p_agency and m.user_id = auth.uid();
$$;

create or replace function public.is_client_staff(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
    join public.memberships m on m.agency_id = c.agency_id
    where c.id = p_client and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_access_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_client_staff(p_client) or exists (
    select 1 from public.client_users cu
    join public.clients c on c.id = cu.client_id
    where cu.client_id = p_client and cu.user_id = auth.uid() and c.status <> 'offboarded'
  );
$$;

grant execute on function public.is_agency_member(uuid), public.agency_role(uuid),
  public.is_client_staff(uuid), public.can_access_client(uuid) to authenticated;

-- Enable RLS everywhere.
do $$
declare t text;
begin
  foreach t in array array[
    'agencies', 'profiles', 'memberships', 'clients', 'client_users', 'subscriptions',
    'sites', 'pages', 'redirects', 'page_versions', 'runs', 'run_events', 'campaigns', 'change_sets',
    'tasks', 'ai_usage', 'keywords', 'rank_snapshots', 'gsc_daily', 'ga4_daily', 'audits',
    'audit_issues', 'competitors', 'leads', 'integrations', 'integration_secrets', 'reports'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- agencies
create policy agencies_select on public.agencies for select to authenticated
  using (public.is_agency_member(id) or exists (
    select 1 from public.client_users cu join public.clients c on c.id = cu.client_id
    where cu.user_id = auth.uid() and c.agency_id = agencies.id));
create policy agencies_update on public.agencies for update to authenticated
  using (public.agency_role(id) in ('owner', 'admin'));

-- profiles: yourself, or anyone in an agency you staff
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.memberships m1 join public.memberships m2 on m1.agency_id = m2.agency_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id) or exists (
    select 1 from public.memberships m join public.clients c on c.agency_id = m.agency_id
    join public.client_users cu on cu.client_id = c.id
    where m.user_id = auth.uid() and cu.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid());

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_agency_member(agency_id));
create policy memberships_write on public.memberships for all to authenticated
  using (public.agency_role(agency_id) in ('owner', 'admin'))
  with check (public.agency_role(agency_id) in ('owner', 'admin'));

-- clients
create policy clients_select on public.clients for select to authenticated
  using (public.can_access_client(id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_agency_member(agency_id));
create policy clients_update on public.clients for update to authenticated
  using (public.is_agency_member(agency_id)) with check (public.is_agency_member(agency_id));
create policy clients_delete on public.clients for delete to authenticated
  using (public.agency_role(agency_id) in ('owner', 'admin'));

-- client_users: staff manage; portal users can see their own row
create policy client_users_select on public.client_users for select to authenticated
  using (user_id = auth.uid() or public.is_client_staff(client_id));
create policy client_users_write on public.client_users for all to authenticated
  using (public.is_client_staff(client_id)) with check (public.is_client_staff(client_id));

-- Tables readable by portal users, writable by staff.
do $$
declare t text;
begin
  foreach t in array array[
    'sites', 'pages', 'redirects', 'campaigns', 'tasks', 'keywords', 'rank_snapshots', 'gsc_daily',
    'ga4_daily', 'audits', 'audit_issues', 'competitors', 'leads', 'reports', 'subscriptions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_access_client(client_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_client_staff(client_id)) with check (public.is_client_staff(client_id))',
      t || '_staff_write', t);
  end loop;
end $$;

-- Staff-only tables (operational detail, costs, credentials metadata).
do $$
declare t text;
begin
  foreach t in array array['page_versions', 'change_sets', 'integrations'] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_client_staff(client_id)) with check (public.is_client_staff(client_id))',
      t || '_staff', t);
  end loop;
end $$;

create policy runs_staff on public.runs for all to authenticated
  using (public.is_agency_member(agency_id)) with check (public.is_agency_member(agency_id));
create policy run_events_staff on public.run_events for select to authenticated
  using (public.is_agency_member(agency_id));
create policy ai_usage_staff on public.ai_usage for select to authenticated
  using (public.is_agency_member(agency_id));

-- Public (anonymous) read of published sites, used by the multi-tenant renderer.
create policy sites_public on public.sites for select to anon
  using (status = 'published');
create policy pages_public on public.pages for select to anon
  using (status = 'published' and exists (
    select 1 from public.sites s where s.id = pages.site_id and s.status = 'published'));

create policy redirects_public on public.redirects for select to anon
  using (exists (select 1 from public.sites s where s.id = redirects.site_id and s.status = 'published'));

-- integration_secrets: intentionally no policies (service role only).

-- Live run logs in the command console.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.run_events;
  end if;
end $$;

-- Anonymous visitors only need the public-facing columns of a site.
revoke select on public.sites from anon;
grant select (id, client_id, subdomain, custom_domain, status, theme, business, published_at)
  on public.sites to anon;
