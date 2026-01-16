-- Fix recursive RLS between hubs and hub_members

drop policy if exists hub_members_select on hub_members;
drop policy if exists hub_members_insert on hub_members;
drop policy if exists hub_members_update on hub_members;
drop policy if exists hub_members_delete on hub_members;

create policy hub_members_select on hub_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_members.hub_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'owner'
    )
    or (
      accepted_at is not null
      and exists (
        select 1 from hub_members m
        where m.hub_id = hub_members.hub_id
          and m.user_id = auth.uid()
          and m.accepted_at is not null
      )
    )
  );

create policy hub_members_insert on hub_members
  for insert with check (
    exists (
      select 1 from hub_members m
      where m.hub_id = hub_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'owner'
    )
  );

create policy hub_members_update on hub_members
  for update using (
    exists (
      select 1 from hub_members m
      where m.hub_id = hub_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'owner'
    )
    or user_id = auth.uid()
  ) with check (
    exists (
      select 1 from hub_members m
      where m.hub_id = hub_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'owner'
    )
    or user_id = auth.uid()
  );

create policy hub_members_delete on hub_members
  for delete using (
    exists (
      select 1 from hub_members m
      where m.hub_id = hub_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'owner'
    )
  );
