-- Reminder candidates, reminders, notifications, and policies.

alter table hubs add column if not exists reminder_policy jsonb
  default '{"lead_hours":24,"channels":["in_app"]}'::jsonb;

create or replace function is_hub_editor(_hub_id uuid)
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
      and m.role in ('owner', 'editor')
  );
$$;

create table if not exists reminder_candidates (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references hubs(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  detected_by text not null default 'nlp',
  snippet text not null,
  snippet_hash text not null,
  due_at timestamptz not null,
  timezone text not null,
  title_suggestion text,
  confidence numeric(4, 3) not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create unique index if not exists reminder_candidates_dedupe_idx
  on reminder_candidates (source_id, due_at, snippet_hash);

create index if not exists reminder_candidates_hub_status_idx
  on reminder_candidates (hub_id, status, created_at desc);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hub_id uuid not null references hubs(id) on delete cascade,
  source_id uuid references sources(id) on delete set null,
  due_at timestamptz not null,
  timezone text not null,
  message text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz
);

create index if not exists reminders_user_idx on reminders (user_id);
create index if not exists reminders_hub_idx on reminders (hub_id);
create index if not exists reminders_due_idx on reminders (due_at);
create index if not exists reminders_status_idx on reminders (status);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null references reminders(id) on delete cascade,
  channel text not null,
  status text not null default 'queued',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  provider_id text,
  error text,
  idempotency_key text not null
);

create unique index if not exists notifications_idempotency_idx
  on notifications (idempotency_key);

create index if not exists notifications_user_idx on notifications (user_id);
create index if not exists notifications_status_idx on notifications (status);
create index if not exists notifications_scheduled_idx on notifications (scheduled_for);

create table if not exists reminder_feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references reminder_candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  edited_due_at timestamptz,
  edited_message text,
  created_at timestamptz not null default now()
);

create index if not exists reminder_feedback_user_idx on reminder_feedback (user_id);
create index if not exists reminder_feedback_candidate_idx on reminder_feedback (candidate_id);

alter table reminder_candidates enable row level security;
alter table reminders enable row level security;
alter table notifications enable row level security;
alter table reminder_feedback enable row level security;

-- reminder_candidates policies
create policy reminder_candidates_select on reminder_candidates
  for select using (
    is_hub_member(hub_id)
  );

create policy reminder_candidates_insert on reminder_candidates
  for insert with check (
    is_hub_editor(hub_id)
  );

create policy reminder_candidates_update on reminder_candidates
  for update using (
    is_hub_member(hub_id)
  ) with check (
    is_hub_member(hub_id)
  );

-- reminders policies
create policy reminders_select on reminders
  for select using (
    user_id = auth.uid() and is_hub_member(hub_id)
  );

create policy reminders_insert on reminders
  for insert with check (
    user_id = auth.uid() and is_hub_member(hub_id)
  );

create policy reminders_update on reminders
  for update using (
    user_id = auth.uid() and is_hub_member(hub_id)
  ) with check (
    user_id = auth.uid() and is_hub_member(hub_id)
  );

create policy reminders_delete on reminders
  for delete using (
    user_id = auth.uid() and is_hub_member(hub_id)
  );

-- notifications policies
create policy notifications_select on notifications
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from reminders r
      where r.id = reminder_id and r.user_id = auth.uid()
    )
  );

-- reminder_feedback policies
create policy reminder_feedback_select on reminder_feedback
  for select using (
    user_id = auth.uid()
  );

create policy reminder_feedback_insert on reminder_feedback
  for insert with check (
    user_id = auth.uid()
  );
