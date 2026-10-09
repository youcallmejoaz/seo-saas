-- Atomic counters used by background jobs (service role).
create or replace function public.increment_run_usage(p_run uuid, p_in bigint, p_out bigint, p_cost numeric)
returns void language sql security definer set search_path = public as $$
  update public.runs
  set tokens_in = tokens_in + p_in, tokens_out = tokens_out + p_out, cost_usd = cost_usd + p_cost
  where id = p_run;
$$;
revoke execute on function public.increment_run_usage(uuid, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.increment_run_usage(uuid, bigint, bigint, numeric) to service_role;

-- Apply a validated change set atomically. The app computes the new page states (see
-- src/lib/site/changes.ts); this function snapshots, writes and records them in one
-- transaction, with an optimistic version check so concurrent edits are never lost.
create or replace function public.apply_change_set(
  p_change_set uuid, p_updates jsonb, p_creates jsonb, p_redirects jsonb, p_before jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  cs public.change_sets%rowtype;
  u jsonb;
  c jsonb;
  r jsonb;
begin
  select * into cs from public.change_sets where id = p_change_set for update;
  if not found then raise exception 'change set % not found', p_change_set; end if;
  if cs.status not in ('proposed', 'approved') then
    raise exception 'change set % is already %', p_change_set, cs.status;
  end if;

  for u in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    insert into public.page_versions (page_id, client_id, version, snapshot, change_set_id)
    select p.id, p.client_id, p.version, to_jsonb(p.*), p_change_set
    from public.pages p where p.id = (u ->> 'id')::uuid and p.site_id = cs.site_id;

    update public.pages set
      slug = u ->> 'slug',
      type = u ->> 'type',
      title = u ->> 'title',
      meta_description = u ->> 'meta_description',
      h1 = u ->> 'h1',
      target_keyword = u ->> 'target_keyword',
      blocks = u -> 'blocks',
      status = u ->> 'status',
      noindex = (u ->> 'noindex')::boolean,
      version = (u ->> 'version')::integer
    where id = (u ->> 'id')::uuid
      and site_id = cs.site_id
      and version = (u ->> 'version')::integer - 1;
    if not found then
      raise exception 'page % was modified by someone else; re-run the change', u ->> 'id';
    end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p_creates, '[]'::jsonb)) loop
    insert into public.pages (id, site_id, client_id, slug, type, title, meta_description, h1, target_keyword, blocks, status, noindex, version)
    values ((c ->> 'id')::uuid, cs.site_id, cs.client_id, c ->> 'slug', c ->> 'type', c ->> 'title',
            c ->> 'meta_description', c ->> 'h1', c ->> 'target_keyword', c -> 'blocks', c ->> 'status',
            coalesce((c ->> 'noindex')::boolean, false), 1);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_redirects, '[]'::jsonb)) loop
    insert into public.redirects (site_id, client_id, from_path, to_path)
    values (cs.site_id, cs.client_id, r ->> 'from', r ->> 'to')
    on conflict (site_id, from_path) do update set to_path = excluded.to_path;
    -- Collapse chains: anything that pointed at the old path now points at the new one.
    update public.redirects set to_path = r ->> 'to'
    where site_id = cs.site_id and to_path = r ->> 'from';
  end loop;

  update public.change_sets
  set status = 'applied', applied_at = now(), before = p_before, error = null
  where id = p_change_set;
end;
$$;

-- Undo an applied change set from its stored `before` snapshot.
create or replace function public.rollback_change_set(p_change_set uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cs public.change_sets%rowtype;
  snap jsonb;
begin
  select * into cs from public.change_sets where id = p_change_set for update;
  if not found or cs.status <> 'applied' then
    raise exception 'only applied change sets can be rolled back';
  end if;

  for snap in select * from jsonb_array_elements(coalesce(cs.before -> 'pages', '[]'::jsonb)) loop
    insert into public.page_versions (page_id, client_id, version, snapshot, change_set_id)
    select p.id, p.client_id, p.version, to_jsonb(p.*), p_change_set
    from public.pages p where p.id = (snap ->> 'id')::uuid;

    update public.pages set
      slug = snap ->> 'slug',
      type = snap ->> 'type',
      title = snap ->> 'title',
      meta_description = snap ->> 'meta_description',
      h1 = snap ->> 'h1',
      target_keyword = snap ->> 'target_keyword',
      blocks = snap -> 'blocks',
      status = snap ->> 'status',
      noindex = (snap ->> 'noindex')::boolean,
      version = version + 1
    where id = (snap ->> 'id')::uuid and site_id = cs.site_id;
  end loop;

  -- Pages this change created are archived rather than deleted, keeping their history.
  update public.pages set status = 'archived', version = version + 1
  where site_id = cs.site_id
    and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(cs.before -> 'created', '[]'::jsonb)) x);

  delete from public.redirects
  where site_id = cs.site_id
    and from_path in (select x #>> '{}' from jsonb_array_elements(coalesce(cs.before -> 'redirects', '[]'::jsonb)) x);

  update public.change_sets set status = 'rolled_back', rolled_back_at = now() where id = p_change_set;
end;
$$;

revoke execute on function public.apply_change_set(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.rollback_change_set(uuid) from public, anon, authenticated;
grant execute on function public.apply_change_set(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.rollback_change_set(uuid) to service_role;
