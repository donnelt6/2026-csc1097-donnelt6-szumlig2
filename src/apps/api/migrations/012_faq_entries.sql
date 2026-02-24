-- FAQ entries with citations and pin/edit support.

create table if not exists faq_entries (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references hubs(id) on delete cascade,
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  source_ids uuid[] not null default '{}'::uuid[],
  confidence numeric(4, 3) not null default 0,
  is_pinned boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  generation_batch_id uuid
);

create index if not exists faq_entries_hub_archived_idx
  on faq_entries (hub_id, archived_at);

create index if not exists faq_entries_hub_pinned_idx
  on faq_entries (hub_id, is_pinned);

create index if not exists faq_entries_hub_created_idx
  on faq_entries (hub_id, created_at desc);

alter table faq_entries enable row level security;

create policy faq_entries_select on faq_entries
  for select using (
    is_hub_member(hub_id)
  );

create policy faq_entries_insert on faq_entries
  for insert with check (
    is_hub_editor(hub_id)
  );

create policy faq_entries_update on faq_entries
  for update using (
    is_hub_editor(hub_id)
  ) with check (
    is_hub_editor(hub_id)
  );

create policy faq_entries_delete on faq_entries
  for delete using (
    is_hub_editor(hub_id)
  );
