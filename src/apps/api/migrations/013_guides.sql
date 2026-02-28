-- Guide entries, steps, and per-user progress.

create table if not exists guide_entries (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references hubs(id) on delete cascade,
  title text not null,
  topic text,
  summary text,
  source_ids uuid[] not null default '{}'::uuid[],
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  generation_batch_id uuid
);

create table if not exists guide_steps (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references guide_entries(id) on delete cascade,
  step_index int not null,
  title text,
  instruction text not null,
  citations jsonb not null default '[]'::jsonb,
  confidence numeric(4, 3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists guide_step_progress (
  id uuid primary key default gen_random_uuid(),
  guide_step_id uuid not null references guide_steps(id) on delete cascade,
  guide_id uuid not null references guide_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_complete boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (guide_step_id, user_id)
);

create index if not exists guide_entries_hub_archived_idx
  on guide_entries (hub_id, archived_at);

create index if not exists guide_entries_hub_created_idx
  on guide_entries (hub_id, created_at desc);

create index if not exists guide_steps_guide_idx
  on guide_steps (guide_id, step_index);

create index if not exists guide_step_progress_user_idx
  on guide_step_progress (guide_id, user_id);

alter table guide_entries enable row level security;
alter table guide_steps enable row level security;
alter table guide_step_progress enable row level security;

create policy guide_entries_select on guide_entries
  for select using (
    is_hub_member(hub_id)
  );

create policy guide_entries_insert on guide_entries
  for insert with check (
    is_hub_editor(hub_id)
  );

create policy guide_entries_update on guide_entries
  for update using (
    is_hub_editor(hub_id)
  ) with check (
    is_hub_editor(hub_id)
  );

create policy guide_entries_delete on guide_entries
  for delete using (
    is_hub_editor(hub_id)
  );

create policy guide_steps_select on guide_steps
  for select using (
    is_hub_member((select hub_id from guide_entries where guide_entries.id = guide_steps.guide_id))
  );

create policy guide_steps_insert on guide_steps
  for insert with check (
    is_hub_editor((select hub_id from guide_entries where guide_entries.id = guide_steps.guide_id))
  );

create policy guide_steps_update on guide_steps
  for update using (
    is_hub_editor((select hub_id from guide_entries where guide_entries.id = guide_steps.guide_id))
  ) with check (
    is_hub_editor((select hub_id from guide_entries where guide_entries.id = guide_steps.guide_id))
  );

create policy guide_steps_delete on guide_steps
  for delete using (
    is_hub_editor((select hub_id from guide_entries where guide_entries.id = guide_steps.guide_id))
  );

create policy guide_step_progress_select on guide_step_progress
  for select using (
    is_hub_member((select hub_id from guide_entries where guide_entries.id = guide_step_progress.guide_id))
  );

create policy guide_step_progress_insert on guide_step_progress
  for insert with check (
    auth.uid() = user_id
    and is_hub_member((select hub_id from guide_entries where guide_entries.id = guide_step_progress.guide_id))
  );

create policy guide_step_progress_update on guide_step_progress
  for update using (
    auth.uid() = user_id
    and is_hub_member((select hub_id from guide_entries where guide_entries.id = guide_step_progress.guide_id))
  ) with check (
    auth.uid() = user_id
    and is_hub_member((select hub_id from guide_entries where guide_entries.id = guide_step_progress.guide_id))
  );
