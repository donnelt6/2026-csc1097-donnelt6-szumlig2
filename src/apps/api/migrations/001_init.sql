-- Caddie schema + RLS
create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists hubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists hub_members (
  hub_id uuid not null references hubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer',
  invited_at timestamptz default now(),
  accepted_at timestamptz,
  primary key (hub_id, user_id)
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references hubs(id) on delete cascade,
  type text not null default 'file',
  original_name text not null,
  storage_path text,
  status text not null default 'queued',
  failure_reason text,
  ingestion_metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  hub_id uuid not null references hubs(id) on delete cascade,
  chunk_index int not null,
  text text not null,
  embedding vector(1536),
  token_count int,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references hubs(id) on delete cascade,
  scope text not null default 'hub',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  citations jsonb,
  token_usage jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hubs_owner_idx on hubs (owner_id);
create index if not exists hub_members_user_idx on hub_members (user_id);
create index if not exists sources_hub_idx on sources (hub_id);
create index if not exists source_chunks_hub_idx on source_chunks (hub_id);
create index if not exists source_chunks_source_idx on source_chunks (source_id);
create index if not exists messages_session_idx on messages (session_id);

-- Vector index for retrieval (adjust lists based on data size)
create index if not exists source_chunks_embedding_idx
  on source_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table hubs enable row level security;
alter table hub_members enable row level security;
alter table sources enable row level security;
alter table source_chunks enable row level security;
alter table chat_sessions enable row level security;
alter table messages enable row level security;

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
      where h.id = hub_id and (h.owner_id = auth.uid() or auth.uid() = user_id)
    )
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
  ) with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and h.owner_id = auth.uid()
    )
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
      where h.id = hub_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = hub_id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy sources_insert on sources
  for insert with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = hub_id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy sources_update on sources
  for update using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = hub_id and m.user_id = auth.uid()
        )
      )
    )
  ) with check (
    exists (
      select 1 from hubs h
      where h.id = hub_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = hub_id and m.user_id = auth.uid()
        )
      )
    )
  );

-- source_chunks policies (read-only for members; inserts handled by service role)
create policy source_chunks_select on source_chunks
  for select using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = hub_id and m.user_id = auth.uid()
        )
      )
    )
  );

-- chat_sessions policies
create policy chat_sessions_select on chat_sessions
  for select using (
    exists (
      select 1 from hubs h
      where h.id = hub_id and (
        h.owner_id = auth.uid()
        or exists (
          select 1 from hub_members m
          where m.hub_id = hub_id and m.user_id = auth.uid()
        )
      )
    )
  );

create policy chat_sessions_insert on chat_sessions
  for insert with check (auth.uid() = created_by);

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
          where m.hub_id = h.id and m.user_id = auth.uid()
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
