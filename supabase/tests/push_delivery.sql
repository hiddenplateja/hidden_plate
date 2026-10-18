begin;
do $$
declare recipient uuid := gen_random_uuid(); token_id uuid; notification uuid; n integer;
begin
  insert into auth.users(id,email,raw_user_meta_data)
    values(recipient,recipient::text || '@example.invalid','{"display_name":"Push Test"}');
  insert into public.push_tokens(user_id,token,platform)
    values(recipient,'ExponentPushToken[rollback_only]','android') returning id into token_id;
  insert into public.notifications(user_id,type,title,body,data)
    values(recipient,'follow','Test','Rollback-only test','{}') returning id into notification;
  if (select count(*) from public.push_deliveries where notification_id=notification) <> 1 then
    raise exception 'Push not queued';
  end if;
  select count(*) into n from public.claim_notification_push(notification);
  if n <> 1 then raise exception 'Expected one claimed delivery'; end if;
  select count(*) into n from public.claim_notification_push(notification);
  if n <> 0 then raise exception 'Active lease was claimed twice'; end if;
  update public.push_deliveries set lease_until=now()-interval '1 minute' where notification_id=notification;
  select count(*) into n from public.claim_notification_push(notification);
  if n <> 1 then raise exception 'Expired lease did not retry'; end if;
  update public.push_deliveries set attempts=5,lease_until=null,status='failed' where notification_id=notification;
  select count(*) into n from public.claim_notification_push(notification);
  if n <> 0 then raise exception 'Attempt cap failed'; end if;
  update public.push_deliveries set attempts=1,status='accepted' where notification_id=notification;
  select count(*) into n from public.claim_notification_push(notification);
  if n <> 0 then raise exception 'Accepted delivery was claimed again'; end if;
  if has_table_privilege('authenticated','public.push_deliveries','SELECT')
    or has_function_privilege('authenticated','public.claim_notification_push(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.retry_notification_push()','EXECUTE') then
    raise exception 'App user can access push delivery internals';
  end if;
end; $$;
rollback;
select 'PASS: queue, lease, retry, attempt cap, accepted dedupe, server-only permissions. Fixtures rolled back.' as result;
