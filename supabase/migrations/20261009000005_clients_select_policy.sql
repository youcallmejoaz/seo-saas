-- INSERT ... RETURNING on clients evaluates the SELECT policy against the new row.
-- can_access_client(id) looks the client up by id, which the new row is not yet visible
-- to, so staff could not read back a client they had just created. Check the row's own
-- agency first.
drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.is_agency_member(agency_id) or public.can_access_client(id));
