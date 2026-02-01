alter table hub_members add column if not exists is_favourite boolean not null default false;

create index if not exists idx_hub_members_favourite
  on hub_members(user_id, is_favourite)
  where is_favourite = true;

comment on column hub_members.is_favourite is 'User-specific flag indicating if this hub is favourited';
