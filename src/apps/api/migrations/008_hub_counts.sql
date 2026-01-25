-- Add denormalized count columns to hubs table and triggers to keep them updated

-- Add count columns
alter table hubs add column if not exists members_count integer not null default 0;
alter table hubs add column if not exists sources_count integer not null default 0;

-- Initialize counts for existing hubs
update hubs h
set members_count = (
  select count(*)
  from hub_members m
  where m.hub_id = h.id and m.accepted_at is not null
);

update hubs h
set sources_count = (
  select count(*)
  from sources s
  where s.hub_id = h.id
);

-- Trigger function to update members_count
create or replace function update_hub_members_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.accepted_at is not null then
    update hubs set members_count = members_count + 1 where id = new.hub_id;
  elsif tg_op = 'UPDATE' then
    if old.accepted_at is null and new.accepted_at is not null then
      update hubs set members_count = members_count + 1 where id = new.hub_id;
    elsif old.accepted_at is not null and new.accepted_at is null then
      update hubs set members_count = members_count - 1 where id = old.hub_id;
    end if;
  elsif tg_op = 'DELETE' and old.accepted_at is not null then
    update hubs set members_count = members_count - 1 where id = old.hub_id;
  end if;
  return coalesce(new, old);
end;
$$;

-- Create trigger for hub_members
drop trigger if exists hub_members_count_trigger on hub_members;
create trigger hub_members_count_trigger
after insert or update or delete on hub_members
for each row execute function update_hub_members_count();

-- Trigger function to update sources_count
create or replace function update_hub_sources_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update hubs set sources_count = sources_count + 1 where id = new.hub_id;
    return new;
  elsif tg_op = 'DELETE' then
    update hubs set sources_count = sources_count - 1 where id = old.hub_id;
    return old;
  end if;
  return null;
end;
$$;

-- Create trigger for sources
drop trigger if exists hub_sources_count_trigger on sources;
create trigger hub_sources_count_trigger
after insert or delete on sources
for each row execute function update_hub_sources_count();
