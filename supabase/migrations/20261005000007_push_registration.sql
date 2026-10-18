create or replace function public.register_push_token(push_token text, device_platform text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and not is_banned) then raise exception 'Sign in to register notifications.'; end if;
  if push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or device_platform not in ('ios','android') then raise exception 'Invalid push token or platform.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(push_token,0));
  delete from push_tokens where token=push_token;
  insert into push_tokens(user_id,token,platform) values(auth.uid(),push_token,device_platform);
end; $$;
revoke all on function public.register_push_token(text,text) from public,anon;
grant execute on function public.register_push_token(text,text) to authenticated;
