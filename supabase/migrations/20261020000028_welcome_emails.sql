begin;
create table public.welcome_email_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into public.welcome_email_settings(id,enabled)values(true,false);
-- Only a signed Auth hook may ask the server to classify a notification. Keep
-- its decision across webhook retries; no tokens/passwords/email bodies stored.
create table public.auth_email_password_events(
 event_id text primary key,user_id uuid not null references public.profiles(id)on delete cascade,
 payload_sha256 text not null,suppressed boolean not null,created_at timestamptz not null default now()
);
create table public.welcome_email_jobs(
 user_id uuid primary key references public.profiles(id)on delete cascade,
 state text not null default 'pending'check(state in('pending','processing','sent','failed','skipped')),
 created_at timestamptz not null default now(),attempts integer not null default 0 check(attempts between 0 and 5),
 lease_id uuid,lease_until timestamptz,sent_at timestamptz
);
alter table public.welcome_email_settings enable row level security;
alter table public.welcome_email_jobs enable row level security;
alter table public.auth_email_password_events enable row level security;
revoke all on public.welcome_email_settings,public.welcome_email_jobs,public.auth_email_password_events from public,anon,authenticated;
grant select,insert,update,delete on public.welcome_email_settings,public.welcome_email_jobs,public.auth_email_password_events to service_role;
create function public.classify_signup_password_email(delivery_id text,target_user uuid,payload_sha256 text)returns boolean
language plpgsql security definer set search_path='' as $$
declare saved public.auth_email_password_events;decision boolean;begin
 if target_user is null or delivery_id is null or delivery_id !~ '^[a-zA-Z0-9_.:-]{1,200}$'or payload_sha256 is null or payload_sha256 !~ '^[a-f0-9]{64}$'then raise exception 'Invalid email event.';end if;
 perform pg_advisory_xact_lock(hashtextextended(delivery_id,20028));
 select * into saved from public.auth_email_password_events where event_id=delivery_id;
 if found then
  if saved.user_id<>target_user or saved.payload_sha256<>classify_signup_password_email.payload_sha256 then raise exception 'Email event mismatch.';end if;
  return saved.suppressed;
 end if;
 if not exists(select 1 from public.profiles where id=target_user)then raise exception 'Account not found.';end if;
 decision:=exists(select 1 from public.auth_signup_pending where user_id=target_user);
 insert into public.auth_email_password_events(event_id,user_id,payload_sha256,suppressed)values(delivery_id,target_user,payload_sha256,decision);
 return decision;
end $$;

create function public.dispatch_welcome_emails()returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text;api_key text;request_id bigint;begin
 if not exists(select 1 from public.welcome_email_settings where id and enabled)or not exists(
  select 1 from public.welcome_email_jobs where state in('pending','processing','failed')and attempts<5
  and created_at>now()-interval '23 hours'and(lease_until is null or lease_until<now()))then return null;end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='push_sender_url';
 select decrypted_secret into api_key from vault.decrypted_secrets where name='push_sender_apikey';
 if endpoint is null or endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/send-push$'or api_key is null then return null;end if;
 select net.http_post(url:=regexp_replace(endpoint,'/send-push$','/send-welcome-email'),
  headers:=jsonb_build_object('Content-Type','application/json','apikey',api_key),body:='{}'::jsonb,timeout_milliseconds:=10000)into request_id;
 return request_id;
end $$;
create function public.queue_signup_welcome()returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Cascaded account deletion is not signup completion. Check the surviving
 -- active profile too; rolled-back signup completion rolls back this job.
 if pg_trigger_depth()=1 and exists(select 1 from public.profiles where id=old.user_id and not is_banned)
  and exists(select 1 from auth.users where id=old.user_id and email_confirmed_at is not null)then
  insert into public.welcome_email_jobs(user_id)values(old.user_id)on conflict(user_id)do nothing;
  -- An email transport outage must not roll back a completed registration.
  -- Keep the private job for a later dispatch/retry instead.
  begin perform public.dispatch_welcome_emails();exception when others then null;end;
 end if;return old;
end $$;
create trigger signup_completed_welcome after delete on public.auth_signup_pending for each row execute function public.queue_signup_welcome();

create function public.claim_welcome_emails()returns table(user_id uuid,lease_id uuid)language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.welcome_email_settings where id and enabled)then return;end if;
 return query with selected as(select j.user_id from public.welcome_email_jobs j
  where j.state in('pending','processing','failed')and j.attempts<5 and j.created_at>now()-interval '23 hours'
  and(j.lease_until is null or j.lease_until<now())order by j.created_at,j.user_id limit 10 for update skip locked)
 update public.welcome_email_jobs j set state='processing',attempts=j.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 from selected s where j.user_id=s.user_id returning j.user_id,j.lease_id;
end $$;
create function public.finish_welcome_email(target_user uuid,expected_lease uuid,outcome text)returns void language plpgsql security definer set search_path='' as $$
begin
 if outcome is null or outcome not in('sent','failed','skipped')then raise exception 'Invalid delivery outcome.';end if;
 update public.welcome_email_jobs set state=outcome,sent_at=case when outcome='sent'then now()else null end,
  lease_until=case when outcome='failed'then now()+interval '2 minutes'else null end,lease_id=null
 where user_id=target_user and state='processing'and lease_id=expected_lease;
 if not found then raise exception 'Delivery lease expired.';end if;
end $$;
revoke all on function public.dispatch_welcome_emails(),public.queue_signup_welcome(),public.claim_welcome_emails(),public.finish_welcome_email(uuid,uuid,text),public.classify_signup_password_email(text,uuid,text)from public,anon,authenticated;
grant execute on function public.dispatch_welcome_emails(),public.claim_welcome_emails(),public.finish_welcome_email(uuid,uuid,text),public.classify_signup_password_email(text,uuid,text)to service_role;
notify pgrst,'reload schema';
commit;
