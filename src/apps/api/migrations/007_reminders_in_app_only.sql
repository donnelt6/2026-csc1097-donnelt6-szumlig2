-- Restrict reminder notifications to in-app only.
-- Initially was going to implement email notifications, but decided to keep it simple and only send in-app notifications for now(easier to implement and test than adding email functionality at the same time). Potential stretch goal is to implement email notifications.

alter table hubs alter column reminder_policy
  set default '{"lead_hours":24,"channels":["in_app"]}'::jsonb;

update hubs
set reminder_policy = jsonb_set(
  coalesce(reminder_policy, '{}'::jsonb),
  '{channels}',
  '["in_app"]'::jsonb,
  true
);
