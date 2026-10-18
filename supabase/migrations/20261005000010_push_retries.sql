-- Apply after creating the notifications_send_push webhook in the Dashboard.
-- Import its existing credentials within Postgres: no secret is copied into
-- source control, the app, or query results.
begin;
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare args text[]; auth_header text; api_key text; endpoint text;
begin
  select string_to_array(encode(tgargs,'escape'),'\000') into args
    from pg_trigger where tgname='notifications_send_push'
      and tgrelid='public.notifications'::regclass and not tgisinternal;
  endpoint := args[1];
  auth_header := (args[3]::jsonb)->>'Authorization';
  api_key := (args[3]::jsonb)->>'apikey';
  if endpoint is null or endpoint not like 'https://%.supabase.co/functions/v1/send-push'
    or (coalesce(auth_header,'') not like 'Bearer %' and coalesce(api_key,'') not like 'sb_secret_%') then
    raise exception 'Create the authenticated send-push webhook first.';
  end if;
  if api_key like 'sb_secret_%' and not exists(select 1 from vault.secrets where name='push_sender_apikey') then
    perform vault.create_secret(api_key,'push_sender_apikey','Server-only push sender secret API key');
  elsif auth_header like 'Bearer %' and not exists(select 1 from vault.secrets where name='push_sender_authorization') then
    perform vault.create_secret(auth_header,'push_sender_authorization','Server-only push sender authentication');
  end if;
  if not exists(select 1 from vault.secrets where name='push_sender_url') then
    perform vault.create_secret(endpoint,'push_sender_url','Push Edge Function URL');
  end if;
end; $$;

create or replace function public.retry_notification_push()
returns bigint language plpgsql security definer set search_path=public as $$
declare request_id bigint;
begin
  if not exists(select 1 from public.push_deliveries where status in ('pending','processing','failed')
    and attempts < 5 and (lease_until is null or lease_until < now())) then return null; end if;
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='push_sender_url'),
    headers := jsonb_build_object('Content-Type','application/json') ||
      case when exists(select 1 from vault.secrets where name='push_sender_apikey') then
        jsonb_build_object('apikey',(select decrypted_secret from vault.decrypted_secrets where name='push_sender_apikey'))
      else jsonb_build_object('Authorization',(select decrypted_secret from vault.decrypted_secrets where name='push_sender_authorization')) end,
    body := '{"retry":true}'::jsonb, timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end; $$;
revoke all on function public.retry_notification_push() from public,anon,authenticated;
grant execute on function public.retry_notification_push() to service_role;
create index if not exists push_deliveries_due_idx on public.push_deliveries(status,lease_until,created_at)
  where attempts < 5;
select cron.schedule('hidden-plate-push-retries','* * * * *','select public.retry_notification_push();');
commit;
