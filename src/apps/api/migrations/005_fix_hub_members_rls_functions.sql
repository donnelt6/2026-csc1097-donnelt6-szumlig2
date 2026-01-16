-- Avoid recursive RLS in hub_members policies with security definer helpers.

create or replace function is_hub_owner(_hub_id uuid)
returns boolean
language sql
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from hubs h
    where h.id = _hub_id
      and h.owner_id = auth.uid()
  );
$$;

create or replace function is_hub_member(_hub_id uuid)
returns boolean
language sql
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from hub_members m
    where m.hub_id = _hub_id
      and m.user_id = auth.uid()
      and m.accepted_at is not null
  );
$$;

drop policy if exists hub_members_select on hub_members;
drop policy if exists hub_members_insert on hub_members;
drop policy if exists hub_members_update on hub_members;
drop policy if exists hub_members_delete on hub_members;

create policy hub_members_select on hub_members
  for select using (
    user_id = auth.uid()
    or is_hub_owner(hub_id)
    or (accepted_at is not null and is_hub_member(hub_id))
  );

create policy hub_members_insert on hub_members
  for insert with check (
    is_hub_owner(hub_id)
  );

create policy hub_members_update on hub_members
  for update using (
    is_hub_owner(hub_id)
    or user_id = auth.uid()
  ) with check (
    is_hub_owner(hub_id)
    or user_id = auth.uid()
  );

create policy hub_members_delete on hub_members
  for delete using (
    is_hub_owner(hub_id)
  );
