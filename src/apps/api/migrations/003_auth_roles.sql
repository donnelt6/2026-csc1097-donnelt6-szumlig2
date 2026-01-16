-- Update RLS policies for auth + role-based collaboration

alter table hub_members drop constraint if exists hub_members_role_check;
alter table hub_members add constraint hub_members_role_check check (role in ('owner', 'editor', 'viewer'));

-- Backfill owner memberships for existing hubs
insert into hub_members (hub_id, user_id, role, accepted_at)
select h.id, h.owner_id, 'owner', now()
from hubs h
where not exists (
  select 1 from hub_members m
  where m.hub_id = h.id and m.user_id = h.owner_id
);

drop policy if exists hubs_select on hubs;
drop policy if exists hubs_insert on hubs;
drop policy if exists hubs_update on hubs;
drop policy if exists hubs_delete on hubs;

drop policy if exists hub_members_select on hub_members;
drop policy if exists hub_members_insert on hub_members;
drop policy if exists hub_members_update on hub_members;
drop policy if exists hub_members_delete on hub_members;

drop policy if exists sources_select on sources;
drop policy if exists sources_insert on sources;
drop policy if exists sources_update on sources;
drop policy if exists sources_delete on sources;

drop policy if exists source_chunks_select on source_chunks;

drop policy if exists chat_sessions_select on chat_sessions;
drop policy if exists chat_sessions_insert on chat_sessions;

drop policy if exists messages_select on messages;
drop policy if exists messages_insert on messages;

-- hubs policies
create policy hubs_select on hubs
  for select using (
    auth.uid() = owner_id
    or exists (
      select 1 from hub_members m
      where m.hub_id = id and m.user_id = auth.uid()
    )
  );

create policy hubs_insert on hubs
  for insert with check (auth.uid() = owner_id);

create policy hubs_update on hubs
  for update using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy hubs_delete on hubs
  for delete using (auth.uid() = owner_id);

-- hub_members policies
create policy hub_members_select on hub_members
  for select using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or (
      accepted_at is not null
      and exists (
        select 1 from hub_members m
        where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
      )
    )
    or user_id = auth.uid()
  );

create policy hub_members_insert on hub_members
  for insert with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
  );

create policy hub_members_update on hub_members
  for update using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or user_id = auth.uid()
  ) with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or user_id = auth.uid()
  );

create policy hub_members_delete on hub_members
  for delete using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
  );

-- sources policies
create policy sources_select on sources
  for select using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
    )
  );

create policy sources_insert on sources
  for insert with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid()
        and m.accepted_at is not null and m.role in ('owner', 'editor')
    )
  );

create policy sources_update on sources
  for update using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid()
        and m.accepted_at is not null and m.role in ('owner', 'editor')
    )
  ) with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid()
        and m.accepted_at is not null and m.role in ('owner', 'editor')
    )
  );

create policy sources_delete on sources
  for delete using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid()
        and m.accepted_at is not null and m.role in ('owner', 'editor')
    )
  );

-- source_chunks policies (read-only for members; inserts handled by service role)
create policy source_chunks_select on source_chunks
  for select using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
    )
  );

-- chat_sessions policies
create policy chat_sessions_select on chat_sessions
  for select using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
    )
  );

create policy chat_sessions_insert on chat_sessions
  for insert with check (
    auth.uid() = created_by
    and exists (
      select 1 from hub_members m
      where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
    )
  );

-- messages policies
create policy messages_select on messages
  for select using (
    exists (
      select 1
      from chat_sessions s
      join hubs h on h.id = s.hub_id
      where s.id = session_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = h.id and m.user_id = auth.uid() and m.accepted_at is not null
        )
      )
    )
  );

create policy messages_insert on messages
  for insert with check (
    exists (
      select 1
      from chat_sessions s
      where s.id = session_id and s.created_by = auth.uid()
    )
  );

-- Guard against role changes by non-owners (invitee can only accept)
create or replace function prevent_member_role_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role <> old.role then
    if auth.role() = 'service_role' then
      return new;
    end if;
    if not exists (
      select 1 from hubs h where h.id = new.hub_id and h.owner_id = auth.uid()
    ) then
      raise exception 'Only hub owners can change member roles.';
    end if;
  end if;
  if new.hub_id <> old.hub_id or new.user_id <> old.user_id then
    raise exception 'Cannot change membership identity.';
  end if;
  return new;
end;
$$;

drop trigger if exists hub_members_role_guard on hub_members;
create trigger hub_members_role_guard
before update on hub_members
for each row execute function prevent_member_role_change();

-- storage policies (optional direct access)
drop policy if exists sources_objects_select on storage.objects;
drop policy if exists sources_objects_insert on storage.objects;

create policy sources_objects_select on storage.objects
  for select using (
    bucket_id = 'sources'
    and exists (
      select 1 from hub_members m
      where m.hub_id::text = split_part(name, '/', 1)
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

create policy sources_objects_insert on storage.objects
  for insert with check (
    bucket_id = 'sources'
    and exists (
      select 1 from hub_members m
      where m.hub_id::text = split_part(name, '/', 1)
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner', 'editor')
    )
  );
