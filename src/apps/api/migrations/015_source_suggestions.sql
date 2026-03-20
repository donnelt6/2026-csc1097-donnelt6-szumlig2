alter table hubs
  add column if not exists last_source_suggestion_scan_at timestamptz,
  add column if not exists last_source_suggestion_generated_at timestamptz;

create table if not exists source_suggestions (
  id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references hubs(id) on delete cascade,
  type text not null,
  status text not null default 'pending',
  url text not null,
  canonical_url text,
  video_id text,
  title text,
  description text,
  rationale text,
  confidence numeric(4, 3) not null,
  seed_source_ids uuid[] not null default '{}'::uuid[],
  search_metadata jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  accepted_source_id uuid references sources(id) on delete set null
);

create unique index if not exists source_suggestions_hub_canonical_url_idx
  on source_suggestions (hub_id, canonical_url)
  where canonical_url is not null;

create unique index if not exists source_suggestions_hub_video_id_idx
  on source_suggestions (hub_id, video_id)
  where video_id is not null;

create index if not exists source_suggestions_hub_status_idx
  on source_suggestions (hub_id, status, created_at desc);

create index if not exists source_suggestions_hub_created_idx
  on source_suggestions (hub_id, created_at desc);

alter table source_suggestions enable row level security;

create policy source_suggestions_select on source_suggestions
  for select using (
    is_hub_member(hub_id)
  );

create policy source_suggestions_update on source_suggestions
  for update using (
    is_hub_editor(hub_id)
  ) with check (
    is_hub_editor(hub_id)
  );
