alter table chat_sessions
  add column if not exists title text not null default 'New Chat',
  add column if not exists source_ids uuid[] not null default '{}'::uuid[],
  add column if not exists last_message_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

update chat_sessions
set
  title = coalesce(title, 'New Chat'),
  source_ids = coalesce(source_ids, '{}'::uuid[]),
  last_message_at = coalesce(last_message_at, created_at)
where
  title is null
  or source_ids is null
  or last_message_at is null;

create index if not exists chat_sessions_hub_user_last_message_idx
  on chat_sessions (hub_id, created_by, last_message_at desc)
  where deleted_at is null;

create index if not exists chat_sessions_user_deleted_last_message_idx
  on chat_sessions (created_by, deleted_at, last_message_at desc);

create or replace function create_chat_session_with_messages(
  p_hub_id uuid,
  p_created_by uuid,
  p_title text,
  p_scope text,
  p_source_ids uuid[],
  p_user_content text,
  p_assistant_content text,
  p_assistant_citations jsonb default '[]'::jsonb,
  p_assistant_token_usage jsonb default null
)
returns table (
  session_id uuid,
  session_title text,
  session_created_at timestamptz,
  assistant_message_id uuid,
  assistant_created_at timestamptz
)
language plpgsql
as $$
declare
  v_session_id uuid;
  v_session_title text;
  v_session_created_at timestamptz;
  v_assistant_message_id uuid;
  v_assistant_created_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'create_chat_session_with_messages is restricted to service_role';
  end if;

  insert into chat_sessions (hub_id, title, scope, source_ids, created_by)
  values (
    p_hub_id,
    coalesce(nullif(trim(p_title), ''), 'New Chat'),
    p_scope,
    coalesce(p_source_ids, '{}'::uuid[]),
    p_created_by
  )
  returning id, title, created_at
  into v_session_id, v_session_title, v_session_created_at;

  insert into messages (session_id, role, content)
  values (v_session_id, 'user', p_user_content);

  insert into messages (session_id, role, content, citations, token_usage)
  values (
    v_session_id,
    'assistant',
    p_assistant_content,
    coalesce(p_assistant_citations, '[]'::jsonb),
    p_assistant_token_usage
  )
  returning id, created_at
  into v_assistant_message_id, v_assistant_created_at;

  update chat_sessions
  set last_message_at = v_assistant_created_at
  where id = v_session_id;

  return query
  select
    v_session_id,
    v_session_title,
    v_session_created_at,
    v_assistant_message_id,
    v_assistant_created_at;
end;
$$;

revoke execute on function create_chat_session_with_messages(
  uuid,
  uuid,
  text,
  text,
  uuid[],
  text,
  text,
  jsonb,
  jsonb
) from anon, authenticated;

grant execute on function create_chat_session_with_messages(
  uuid,
  uuid,
  text,
  text,
  uuid[],
  text,
  text,
  jsonb,
  jsonb
) to service_role;

drop policy if exists chat_sessions_select on chat_sessions;
drop policy if exists chat_sessions_insert on chat_sessions;
drop policy if exists messages_select on messages;
drop policy if exists messages_insert on messages;

create policy chat_sessions_select on chat_sessions
  for select using (
    created_by = auth.uid()
    and (
      exists (
        select 1 from hubs h
        where h.id = hub_id and h.owner_id = auth.uid()
      )
      or exists (
        select 1 from hub_members m
        where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
      )
    )
  );

create policy chat_sessions_insert on chat_sessions
  for insert with check (
    auth.uid() = created_by
    and (
      exists (
        select 1 from hubs h
        where h.id = hub_id and h.owner_id = auth.uid()
      )
      or exists (
        select 1 from hub_members m
        where m.hub_id = hub_id and m.user_id = auth.uid() and m.accepted_at is not null
      )
    )
  );

create policy messages_select on messages
  for select using (
    exists (
      select 1
      from chat_sessions s
      where s.id = session_id
        and s.created_by = auth.uid()
        and (
          exists (
            select 1 from hubs h
            where h.id = s.hub_id and h.owner_id = auth.uid()
          )
          or exists (
            select 1 from hub_members m
            where m.hub_id = s.hub_id and m.user_id = auth.uid() and m.accepted_at is not null
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
