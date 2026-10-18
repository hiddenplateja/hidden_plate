begin;
create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  push_token_id uuid not null references public.push_tokens(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','accepted','failed','skipped')),
  attempts integer not null default 0,
  lease_until timestamptz,
  ticket_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique(notification_id,push_token_id)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon,authenticated;
grant all on public.push_deliveries to service_role;

create or replace function public.queue_notification_push()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.push_deliveries(notification_id,push_token_id)
    select new.id,id from public.push_tokens where user_id=new.user_id
    on conflict do nothing;
  return null;
end; $$;
revoke all on function public.queue_notification_push() from public,anon,authenticated;
drop trigger if exists notifications_queue_push on public.notifications;
create trigger notifications_queue_push after insert on public.notifications
  for each row execute function public.queue_notification_push();

create or replace function public.claim_notification_push(target_notification uuid default null)
returns table(delivery_id uuid, notification_id uuid, push_token_id uuid, token text)
language sql security definer set search_path=public as $$
  with candidates as (
    select d.id from public.push_deliveries d
    where (target_notification is null or d.notification_id=target_notification)
      and d.status in ('pending','processing','failed') and d.attempts < 5
      and (d.lease_until is null or d.lease_until < now())
    order by d.created_at,d.id limit 10 for update skip locked
  ), claimed as (
    update public.push_deliveries d set status='processing',attempts=attempts+1,
      lease_until=now()+interval '2 minutes'
    from candidates c where d.id=c.id returning d.*
  ) select c.id,c.notification_id,c.push_token_id,t.token
    from claimed c join public.push_tokens t on t.id=c.push_token_id
    join public.notifications n on n.id=c.notification_id and n.user_id=t.user_id;
$$;
revoke all on function public.claim_notification_push(uuid) from public,anon,authenticated;
grant execute on function public.claim_notification_push(uuid) to service_role;
commit;
