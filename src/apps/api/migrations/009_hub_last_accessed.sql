-- Add last_accessed_at tracking to hub_members table
alter table hub_members
  add column if not exists last_accessed_at timestamptz;

-- Create index for efficient querying of recently accessed hubs
create index if not exists idx_hub_members_last_accessed
  on hub_members(user_id, last_accessed_at desc);

-- Initialize existing records with accepted_at as starting point
update hub_members
  set last_accessed_at = accepted_at
  where last_accessed_at is null
    and accepted_at is not null;
