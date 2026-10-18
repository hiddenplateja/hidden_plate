-- Dashboard webhook now uses the default sb_secret key in the apikey header.
begin;
do $$
declare args text[]; api_key text; secret_id uuid;
begin
  select string_to_array(encode(tgargs,'escape'),'\000') into args
    from pg_trigger where tgname='notifications_send_push'
      and tgrelid='public.notifications'::regclass and not tgisinternal;
  api_key := (args[3]::jsonb)->>'apikey';
  if api_key is null or api_key not like 'sb_secret_%' then
    raise exception 'Configure the webhook with Add secret key first.';
  end if;
  select id into secret_id from vault.secrets where name='push_sender_apikey';
  if secret_id is null then
    perform vault.create_secret(api_key,'push_sender_apikey','Server-only push sender secret API key');
  else
    perform vault.update_secret(secret_id,api_key);
  end if;
  delete from vault.secrets where name='push_sender_authorization';
end; $$;
create or replace function public.retry_notification_push()
returns bigint language plpgsql security definer set search_path=public as $$
declare request_id bigint;
begin
  if not exists(select 1 from public.push_deliveries where status in ('pending','processing','failed')
    and attempts < 5 and (lease_until is null or lease_until < now())) then return null; end if;
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='push_sender_url'),
    headers := jsonb_build_object('Content-Type','application/json','apikey',
      (select decrypted_secret from vault.decrypted_secrets where name='push_sender_apikey')),
    body := '{"retry":true}'::jsonb, timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end; $$;
revoke all on function public.retry_notification_push() from public,anon,authenticated;
grant execute on function public.retry_notification_push() to service_role;
commit;
